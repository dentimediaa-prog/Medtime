// =============================================================================
// employee-analytics.page.js
// Bootstrap script for employee-analytics.html?id=<uuid>. Admin-only page.
// Talks to Supabase ONLY through employeeAnalyticsService.js, roles.js, and
// session.js. Every stat, chart, and monthly row is computed here from the
// same raw fetches — one query per table, no duplicated queries.
// =============================================================================

import { initProtectedPage, logout } from '../session.js';
import { requireRole } from '../roles.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifyError, notifySuccess } from '../notifications.js';
import { showAlert } from '../ui.js';
import {
  getEmployeeProfile,
  getEmployeeAttendance,
  getEmployeeLeave,
  getEmployeePayroll,
  getAnalyticsSettings
} from '../employeeAnalyticsService.js';

const PAGE_SIZE = 10;

// ---- Theme -----------------------------------------------------------------
initTheme();
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => toggleTheme());

// ---- Mobile sidebar toggle ---------------------------------------------------
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
document.getElementById('menu-toggle-btn')?.addEventListener('click', () => {
  sidebar?.classList.add('is-open');
  sidebarBackdrop?.classList.add('is-open');
});
sidebarBackdrop?.addEventListener('click', () => {
  sidebar?.classList.remove('is-open');
  sidebarBackdrop?.classList.remove('is-open');
});

// ---- Logout -------------------------------------------------------------------
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await logout();
});

function applyRoleVisibility(role) {
  const isAdminUser = role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.hidden = !isAdminUser;
  });
}

function renderSidebarProfile(profile) {
  const source = (profile.full_name || '').trim();
  const initials = source
    ? (source.split(/\s+/).length > 1
        ? source.split(/\s+/)[0][0] + source.split(/\s+/).slice(-1)[0][0]
        : source.slice(0, 2)
      ).toUpperCase()
    : (profile.email || '?').slice(0, 2).toUpperCase();

  document.getElementById('sidebar-avatar-initials').textContent = initials;
  document.getElementById('sidebar-user-name').textContent = profile.full_name || profile.email;
  document.getElementById('sidebar-user-role').textContent = profile.role;
  applyRoleVisibility(profile.role);
}

// ---- Module state -----------------------------------------------------------
let cachedEmployee = null;
let cachedAttendance = [];
let cachedLeave = [];
let cachedPayroll = [];
let cachedSettings = { work_hours_per_day: 8, overtime_threshold: 8 };
let monthlyStats = []; // ascending chronological
let filteredAttendance = [];
let currentPage = 1;
let searchDebounceHandle = null;

// ---- Formatting helpers -------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return '–';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMonthLabel(monthKey) {
  const date = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return monthKey;
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function daysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.max(Math.round((end - start) / 86400000) + 1, 0);
}

function averageTimeOfDay(isoTimestamps) {
  if (!isoTimestamps.length) return null;
  const totalMinutes = isoTimestamps.reduce((sum, iso) => {
    const d = new Date(iso);
    return sum + d.getHours() * 60 + d.getMinutes();
  }, 0);
  const avgMinutes = Math.round(totalMinutes / isoTimestamps.length);
  const h = Math.floor(avgMinutes / 60) % 24;
  const m = avgMinutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function getInitials(fullName, email) {
  const source = (fullName || '').trim();
  if (source) {
    const parts = source.split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
}

// ---- Section 1: Employee Information ------------------------------------------
function renderEmployeeInfo(emp) {
  document.getElementById('emp-avatar-initials').textContent = getInitials(emp.full_name, emp.email);
  document.getElementById('emp-full-name').textContent = emp.full_name || emp.email;
  document.getElementById('emp-email').textContent = emp.email;
  document.getElementById('emp-department').textContent = emp.department || '–';
  document.getElementById('emp-job-title').textContent = emp.job_title || '–';
  document.getElementById('emp-hire-date').textContent = formatDateLabel(emp.hire_date);

  const roleBadge = document.getElementById('emp-role-badge');
  roleBadge.textContent = emp.role;
  roleBadge.className = `badge ${emp.role === 'admin' ? 'badge-success' : 'badge-neutral'}`;

  const statusBadge = document.getElementById('emp-status-badge');
  statusBadge.textContent = emp.is_active ? 'Active' : 'Inactive';
  statusBadge.className = `badge ${emp.is_active ? 'badge-success' : 'badge-danger'}`;

  document.getElementById('print-analytics-title').textContent = `Employee Analytics — ${emp.full_name || emp.email}`;
}

// ---- Section 2: Summary Cards ----------------------------------------------------
function renderSummaryCards() {
  const threshold = Number(cachedSettings.overtime_threshold) || 8;
  const standardHours = Number(cachedSettings.work_hours_per_day) || 8;

  let totalWorkedHours = 0;
  let overtimeHours = 0;
  let lateArrivals = 0;
  let earlyCheckouts = 0;
  let completedDays = 0;
  const clockIns = [];
  const clockOuts = [];

  cachedAttendance.forEach((r) => {
    if (r.clock_in) clockIns.push(r.clock_in);
    if (r.status === 'late') lateArrivals += 1;
    if (r.clock_out) {
      const hours = Number(r.total_hours || 0);
      totalWorkedHours += hours;
      overtimeHours += Math.max(hours - threshold, 0);
      completedDays += 1;
      clockOuts.push(r.clock_out);
      if (hours < standardHours) earlyCheckouts += 1;
    }
  });

  const approvedLeaves = cachedLeave.filter((r) => r.status === 'approved');
  const pendingLeaves = cachedLeave.filter((r) => r.status === 'pending');
  const totalLeaveDays = approvedLeaves.reduce((sum, r) => sum + daysInclusive(r.start_date, r.end_date), 0);

  document.getElementById('stat-total-worked-hours').textContent = `${totalWorkedHours.toFixed(1)}h`;
  document.getElementById('stat-total-attendance-days').textContent = String(cachedAttendance.length);
  document.getElementById('stat-total-leave-days').textContent = String(totalLeaveDays);
  document.getElementById('stat-approved-leaves').textContent = String(approvedLeaves.length);
  document.getElementById('stat-pending-leaves').textContent = String(pendingLeaves.length);
  document.getElementById('stat-overtime-hours').textContent = `${overtimeHours.toFixed(1)}h`;
  document.getElementById('stat-late-arrivals').textContent = String(lateArrivals);
  document.getElementById('stat-early-checkouts').textContent = String(earlyCheckouts);
  document.getElementById('stat-avg-daily-hours').textContent = completedDays ? `${(totalWorkedHours / completedDays).toFixed(1)}h` : '–';
  document.getElementById('stat-avg-clockin').textContent = averageTimeOfDay(clockIns) || '–';
  document.getElementById('stat-avg-clockout').textContent = averageTimeOfDay(clockOuts) || '–';
}

// ---- Monthly stats (shared by Section 3 charts + Section 7 table) ----------------
function buildMonthlyStats() {
  const map = new Map();
  const ensure = (key) => {
    if (!map.has(key)) map.set(key, { month: key, workedHours: 0, attendanceDays: 0, leaveDays: 0, overtimeHours: 0, salary: 0 });
    return map.get(key);
  };
  const threshold = Number(cachedSettings.overtime_threshold) || 8;

  cachedAttendance.forEach((r) => {
    const g = ensure(r.date.slice(0, 7));
    g.attendanceDays += 1;
    if (r.clock_out) {
      const hours = Number(r.total_hours || 0);
      g.workedHours += hours;
      g.overtimeHours += Math.max(hours - threshold, 0);
    }
  });

  cachedLeave
    .filter((r) => r.status === 'approved')
    .forEach((r) => {
      const cursor = new Date(`${r.start_date}T00:00:00`);
      const end = new Date(`${r.end_date}T00:00:00`);
      let guard = 0;
      while (cursor <= end && guard < 366) {
        ensure(cursor.toLocaleDateString('en-CA').slice(0, 7)).leaveDays += 1;
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
      }
    });

  cachedPayroll.forEach((r) => {
    ensure(r.period_start.slice(0, 7)).salary += Number(r.net_pay || 0);
  });

  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ---- Section 3: Charts (inline SVG, no external library) -------------------------
function svgLineChart(points) {
  if (!points.length) return '';
  const width = 480;
  const height = 150;
  const paddingTop = 10;
  const paddingBottom = 20;
  const innerHeight = height - paddingTop - paddingBottom;
  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * stepX : width / 2;
    const y = paddingTop + innerHeight - (p.value / max) * innerHeight;
    return { x, y };
  });

  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const dots = coords
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.5" style="fill:var(--color-accent)"></circle>`)
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    <polyline points="${polyline}" fill="none" style="stroke:var(--color-accent)" stroke-width="2"/>
    ${dots}
    <text x="0" y="${height - 4}" font-size="10" style="fill:var(--color-text-tertiary)">${escapeHtml(points[0].label)}</text>
    <text x="${width}" y="${height - 4}" font-size="10" text-anchor="end" style="fill:var(--color-text-tertiary)">${escapeHtml(points[points.length - 1].label)}</text>
  </svg>`;
}

function svgBarChart(points) {
  if (!points.length) return '';
  const width = 480;
  const height = 150;
  const paddingBottom = 20;
  const innerHeight = height - paddingBottom;
  const max = Math.max(...points.map((p) => p.value), 1);
  const barWidth = width / points.length;

  const bars = points
    .map((p, i) => {
      const barHeight = (p.value / max) * (innerHeight - 10);
      const x = i * barWidth + barWidth * 0.15;
      const y = innerHeight - barHeight;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barWidth * 0.7).toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" style="fill:var(--color-accent)"></rect>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
    ${bars}
    <text x="0" y="${height - 4}" font-size="10" style="fill:var(--color-text-tertiary)">${escapeHtml(points[0].label)}</text>
    <text x="${width}" y="${height - 4}" font-size="10" text-anchor="end" style="fill:var(--color-text-tertiary)">${escapeHtml(points[points.length - 1].label)}</text>
  </svg>`;
}

function renderCharts() {
  const hoursPoints = monthlyStats.map((m) => ({ label: formatMonthLabel(m.month), value: m.workedHours }));
  const hoursEl = document.getElementById('chart-monthly-hours');
  hoursEl.innerHTML = hoursPoints.some((p) => p.value > 0) ? svgBarChart(hoursPoints) : '<div class="chart-empty">No worked hours yet.</div>';

  const attendancePoints = monthlyStats.map((m) => ({ label: formatMonthLabel(m.month), value: m.attendanceDays }));
  const attEl = document.getElementById('chart-attendance-trend');
  attEl.innerHTML = attendancePoints.some((p) => p.value > 0) ? svgLineChart(attendancePoints) : '<div class="chart-empty">No attendance data yet.</div>';

  const leavePoints = monthlyStats.map((m) => ({ label: formatMonthLabel(m.month), value: m.leaveDays }));
  const leaveEl = document.getElementById('chart-leave-trend');
  leaveEl.innerHTML = leavePoints.some((p) => p.value > 0) ? svgLineChart(leavePoints) : '<div class="chart-empty">No leave data yet.</div>';

  const overtimePoints = monthlyStats.map((m) => ({ label: formatMonthLabel(m.month), value: m.overtimeHours }));
  const overtimeEl = document.getElementById('chart-overtime-trend');
  overtimeEl.innerHTML = overtimePoints.some((p) => p.value > 0) ? svgLineChart(overtimePoints) : '<div class="chart-empty">No overtime recorded.</div>';
}

// ---- Section 4: Attendance History (search + pagination) -------------------------
function attendanceRowToCells(r) {
  const breakMin = (r.breaks || []).reduce((sum, b) => sum + (Number(b.duration_minutes) || 0), 0);
  return {
    date: formatDateLabel(r.date),
    clockIn: formatTime(r.clock_in),
    clockOut: formatTime(r.clock_out),
    breakMin: Math.round(breakMin),
    hours: r.clock_out ? Number(r.total_hours).toFixed(2) : 'In progress',
    status: r.status
  };
}

function applyAttendanceSearch() {
  const term = document.getElementById('attendance-search-input').value.trim().toLowerCase();
  if (!term) {
    filteredAttendance = cachedAttendance;
  } else {
    filteredAttendance = cachedAttendance.filter((r) => {
      const cells = attendanceRowToCells(r);
      return `${cells.date} ${cells.status}`.toLowerCase().includes(term);
    });
  }
  currentPage = 1;
  renderAttendanceTable();
}

function renderAttendanceTable() {
  const tableWrap = document.getElementById('attendance-history-table-wrap');
  const emptyState = document.getElementById('attendance-history-empty');
  const tbody = document.getElementById('attendance-history-table-body');

  if (!filteredAttendance.length) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    document.getElementById('attendance-pagination-info').textContent = 'No records';
    document.getElementById('attendance-prev-btn').disabled = true;
    document.getElementById('attendance-next-btn').disabled = true;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  const totalPages = Math.max(Math.ceil(filteredAttendance.length / PAGE_SIZE), 1);
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredAttendance.slice(start, start + PAGE_SIZE);

  const statusBadgeClass = { present: 'badge-success', late: 'badge-warning', absent: 'badge-danger', on_leave: 'badge-neutral' };

  tbody.innerHTML = pageRows
    .map((r) => {
      const c = attendanceRowToCells(r);
      const badgeClass = statusBadgeClass[c.status] || 'badge-neutral';
      return `
        <tr>
          <td>${escapeHtml(c.date)}</td>
          <td class="mono">${escapeHtml(c.clockIn)}</td>
          <td class="mono">${escapeHtml(c.clockOut)}</td>
          <td>${c.breakMin} min</td>
          <td class="mono">${escapeHtml(c.hours)}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(c.status)}</span></td>
        </tr>`;
    })
    .join('');

  document.getElementById('attendance-pagination-info').textContent = `Page ${currentPage} of ${totalPages} · ${filteredAttendance.length} record${filteredAttendance.length === 1 ? '' : 's'}`;
  document.getElementById('attendance-prev-btn').disabled = currentPage <= 1;
  document.getElementById('attendance-next-btn').disabled = currentPage >= totalPages;
}

document.getElementById('attendance-search-input')?.addEventListener('input', () => {
  clearTimeout(searchDebounceHandle);
  searchDebounceHandle = setTimeout(applyAttendanceSearch, 300);
});
document.getElementById('attendance-prev-btn')?.addEventListener('click', () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  renderAttendanceTable();
});
document.getElementById('attendance-next-btn')?.addEventListener('click', () => {
  const totalPages = Math.max(Math.ceil(filteredAttendance.length / PAGE_SIZE), 1);
  if (currentPage >= totalPages) return;
  currentPage += 1;
  renderAttendanceTable();
});

// ---- Section 5: Leave History ------------------------------------------------------
const LEAVE_TYPE_LABELS = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal' };
const LEAVE_STATUS_BADGE = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };

function renderLeaveTable() {
  const tableWrap = document.getElementById('leave-history-table-wrap');
  const emptyState = document.getElementById('leave-history-empty');
  const tbody = document.getElementById('leave-history-table-body');

  if (!cachedLeave.length) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  tbody.innerHTML = cachedLeave
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(LEAVE_TYPE_LABELS[r.leave_type] || r.leave_type)}</td>
        <td>${escapeHtml(formatDateLabel(r.start_date))} – ${escapeHtml(formatDateLabel(r.end_date))}</td>
        <td>${escapeHtml(r.reason)}</td>
        <td><span class="badge ${LEAVE_STATUS_BADGE[r.status] || 'badge-neutral'}">${escapeHtml(r.status)}</span></td>
      </tr>`
    )
    .join('');
}

// ---- Section 6: Payroll History ------------------------------------------------------
function renderPayrollTable() {
  const tableWrap = document.getElementById('payroll-history-table-wrap');
  const emptyState = document.getElementById('payroll-history-empty');
  const tbody = document.getElementById('payroll-history-table-body');

  if (!cachedPayroll.length) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  tbody.innerHTML = cachedPayroll
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(formatMonthLabel(r.period_start.slice(0, 7)))}</td>
        <td>${money(r.basic_salary)}</td>
        <td>${money(r.overtime_pay)}</td>
        <td>${money(r.bonus)}</td>
        <td>${money(r.penalty)}</td>
        <td>${money(r.tax)}</td>
        <td>${money(r.insurance)}</td>
        <td><strong>${money(r.net_pay)}</strong></td>
      </tr>`
    )
    .join('');
}

// ---- Section 7: Monthly Statistics --------------------------------------------------
function renderMonthlyStatsTable() {
  const tableWrap = document.getElementById('monthly-stats-table-wrap');
  const emptyState = document.getElementById('monthly-stats-empty');
  const tbody = document.getElementById('monthly-stats-table-body');

  if (!monthlyStats.length) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  const descending = [...monthlyStats].reverse();

  tbody.innerHTML = descending
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(formatMonthLabel(m.month))}</td>
        <td>${m.workedHours.toFixed(1)}h</td>
        <td>${m.attendanceDays}</td>
        <td>${m.leaveDays}</td>
        <td>${m.overtimeHours.toFixed(1)}h</td>
        <td>${money(m.salary)}</td>
      </tr>`
    )
    .join('');
}

// ---- Section 8: Export ---------------------------------------------------------------
function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(val) {
  const str = String(val ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

document.getElementById('export-csv-btn')?.addEventListener('click', () => {
  if (!cachedAttendance.length) {
    notifyError('No attendance data to export.');
    return;
  }
  const columns = ['Date', 'Clock In', 'Clock Out', 'Break (min)', 'Worked Hours', 'Status'];
  const lines = [columns.map(escapeCsvCell).join(',')];
  cachedAttendance.forEach((r) => {
    const c = attendanceRowToCells(r);
    lines.push([c.date, c.clockIn, c.clockOut, c.breakMin, c.hours, c.status].map(escapeCsvCell).join(','));
  });
  downloadBlob(lines.join('\r\n'), `${slugify(cachedEmployee.full_name || cachedEmployee.email)}-attendance.csv`, 'text/csv;charset=utf-8;');
  notifySuccess('CSV exported.');
});

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlRow(cells) {
  return `<Row>${cells.map((c) => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`).join('')}</Row>`;
}

function buildExcelWorkbook(sheets) {
  const worksheets = sheets
    .map(
      (sheet) => `
    <Worksheet ss:Name="${escapeXml(sheet.name)}">
      <Table>
        ${sheet.rows.map(xmlRow).join('\n')}
      </Table>
    </Worksheet>`
    )
    .join('\n');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheets}
</Workbook>`;
}

document.getElementById('export-excel-btn')?.addEventListener('click', () => {
  const employeeInfoRows = [
    ['Field', 'Value'],
    ['Full name', cachedEmployee.full_name || ''],
    ['Email', cachedEmployee.email || ''],
    ['Department', cachedEmployee.department || ''],
    ['Job title', cachedEmployee.job_title || ''],
    ['Role', cachedEmployee.role || ''],
    ['Status', cachedEmployee.is_active ? 'Active' : 'Inactive'],
    ['Hire date', formatDateLabel(cachedEmployee.hire_date)]
  ];

  const attendanceRows = [
    ['Date', 'Clock In', 'Clock Out', 'Break (min)', 'Worked Hours', 'Status'],
    ...cachedAttendance.map((r) => {
      const c = attendanceRowToCells(r);
      return [c.date, c.clockIn, c.clockOut, String(c.breakMin), c.hours, c.status];
    })
  ];

  const leaveRows = [
    ['Type', 'Start Date', 'End Date', 'Reason', 'Status'],
    ...cachedLeave.map((r) => [
      LEAVE_TYPE_LABELS[r.leave_type] || r.leave_type,
      formatDateLabel(r.start_date),
      formatDateLabel(r.end_date),
      r.reason || '',
      r.status
    ])
  ];

  const payrollRows = [
    ['Month', 'Basic Salary', 'Overtime', 'Bonus', 'Penalty', 'Tax', 'Insurance', 'Net Salary'],
    ...cachedPayroll.map((r) => [
      formatMonthLabel(r.period_start.slice(0, 7)),
      Number(r.basic_salary).toFixed(2),
      Number(r.overtime_pay).toFixed(2),
      Number(r.bonus).toFixed(2),
      Number(r.penalty).toFixed(2),
      Number(r.tax).toFixed(2),
      Number(r.insurance).toFixed(2),
      Number(r.net_pay).toFixed(2)
    ])
  ];

  const monthlySummaryRows = [
    ['Month', 'Worked Hours', 'Attendance Days', 'Leave Days', 'Overtime Hours', 'Salary'],
    ...[...monthlyStats].reverse().map((m) => [
      formatMonthLabel(m.month),
      m.workedHours.toFixed(2),
      String(m.attendanceDays),
      String(m.leaveDays),
      m.overtimeHours.toFixed(2),
      m.salary.toFixed(2)
    ])
  ];

  const workbook = buildExcelWorkbook([
    { name: 'Employee Info', rows: employeeInfoRows },
    { name: 'Attendance', rows: attendanceRows },
    { name: 'Leaves', rows: leaveRows },
    { name: 'Payroll', rows: payrollRows },
    { name: 'Monthly Summary', rows: monthlySummaryRows }
  ]);

  downloadBlob(workbook, `${slugify(cachedEmployee.full_name || cachedEmployee.email)}-analytics.xls`, 'application/vnd.ms-excel');
  notifySuccess('Excel file exported (5 sheets).');
});

document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
  window.print();
});

// ---- Boot ------------------------------------------------------------------------
(async function boot() {
  const session = await initProtectedPage();
  if (!session) return; // already redirected to login

  const adminProfile = await requireRole('admin');
  if (!adminProfile) return; // requireRole already redirected non-admins away

  renderSidebarProfile(adminProfile);

  const employeeId = new URLSearchParams(window.location.search).get('id');
  if (!employeeId) {
    showAlert(document.getElementById('analytics-alert'), 'No employee specified. Open this page from an employee record.', 'danger');
    return;
  }

  const { data: employee, error: employeeError } = await getEmployeeProfile(employeeId);
  if (employeeError || !employee) {
    showAlert(document.getElementById('analytics-alert'), "This employee couldn't be found.", 'danger');
    return;
  }
  cachedEmployee = employee;

  const [attendanceResult, leaveResult, payrollResult, settingsResult] = await Promise.all([
    getEmployeeAttendance(employeeId),
    getEmployeeLeave(employeeId),
    getEmployeePayroll(employeeId),
    getAnalyticsSettings()
  ]);

  if (attendanceResult.error || leaveResult.error || payrollResult.error || settingsResult.error) {
    showAlert(document.getElementById('analytics-alert'), "Couldn't load this employee's data. Please try again.", 'danger');
    notifyError("Couldn't load employee analytics.");
    return;
  }

  cachedAttendance = attendanceResult.data || [];
  cachedLeave = leaveResult.data || [];
  cachedPayroll = payrollResult.data || [];
  cachedSettings = settingsResult.data || cachedSettings;
  filteredAttendance = cachedAttendance;
  monthlyStats = buildMonthlyStats();

  renderEmployeeInfo(cachedEmployee);
  renderSummaryCards();
  renderCharts();
  renderAttendanceTable();
  renderLeaveTable();
  renderPayrollTable();
  renderMonthlyStatsTable();

  document.getElementById('analytics-content').hidden = false;
})();
