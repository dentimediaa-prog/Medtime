// =============================================================================
// reports.page.js
// Bootstrap script for reports.html. Admin-only page. Talks to Supabase
// ONLY through reportService.js, roles.js, and session.js. Every report
// type and every chart is computed here from the same raw rows fetched by
// reportService — no per-report queries, no charting library (charts.js
// hasn't been built yet, so these are minimal inline SVG helpers).
// =============================================================================

import { initProtectedPage, logout } from '../session.js';
import { requireRole } from '../roles.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifyError, notifySuccess } from '../notifications.js';
import { showAlert, hideAlert, setButtonLoading } from '../ui.js';
import {
  getFilterOptions,
  getReportSettings,
  getAttendanceInRange,
  getLeaveInRange,
  getAbsentEmployees
} from '../reportService.js';

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
let cachedAttendance = [];
let cachedLeave = [];
let cachedSettings = { work_hours_per_day: 8, overtime_threshold: 8 };
let cachedAbsent = [];
let currentFilters = { startDate: '', endDate: '', employeeId: '', department: '', role: '' };
let lastTable = { title: '', columns: [], rows: [] }; // drives export/print

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

function shortDateLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function todayLocalISO() {
  return new Date().toLocaleDateString('en-CA');
}

function daysAgoLocalISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

function buildDateRangeArray(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return dates;
  const cursor = new Date(start);
  let guard = 0;
  while (cursor <= end && guard < 730) {
    dates.push(cursor.toLocaleDateString('en-CA'));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return dates;
}

function employeeLabel(profile) {
  return profile?.full_name || profile?.email || 'Unknown';
}

// ---- Boot: default date range + filter dropdowns ---------------------------------
function setDefaultDates() {
  document.getElementById('report-start-date').value = daysAgoLocalISO(29);
  document.getElementById('report-end-date').value = todayLocalISO();
}

async function populateFilterDropdowns() {
  const { data, error } = await getFilterOptions();
  if (error) {
    notifyError("Couldn't load filter options.");
    return;
  }

  const employeeSelect = document.getElementById('report-employee-filter');
  data.employees.forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.full_name || emp.email;
    employeeSelect.appendChild(opt);
  });

  const departmentSelect = document.getElementById('report-department-filter');
  data.departments.forEach((dept) => {
    const opt = document.createElement('option');
    opt.value = dept;
    opt.textContent = dept;
    departmentSelect.appendChild(opt);
  });
}

// ---- Inline SVG charts (no external library, no separate charts.js yet) -------------
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

function svgBarChart(items) {
  if (!items.length) return '';
  const width = 480;
  const rowHeight = 26;
  const height = items.length * rowHeight + 10;
  const labelWidth = 110;
  const barAreaWidth = width - labelWidth - 55;
  const max = Math.max(...items.map((i) => i.value), 1);

  const bars = items
    .map((item, i) => {
      const y = i * rowHeight + 6;
      const barWidth = Math.max((item.value / max) * barAreaWidth, 2);
      const label = item.label.length > 16 ? `${item.label.slice(0, 15)}…` : item.label;
      return `
        <text x="0" y="${y + 13}" font-size="11" style="fill:var(--color-text-secondary)">${escapeHtml(label)}</text>
        <rect x="${labelWidth}" y="${y}" width="${barWidth.toFixed(1)}" height="16" rx="3" style="fill:var(--color-accent)"></rect>
        <text x="${(labelWidth + barWidth + 6).toFixed(1)}" y="${y + 13}" font-size="11" style="fill:var(--color-text-primary)">${item.value.toFixed(1)}h</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${bars}</svg>`;
}

function renderCharts() {
  const dates = buildDateRangeArray(currentFilters.startDate, currentFilters.endDate);

  // Attendance trend: employees present per day (one attendance row per user/day).
  const attendanceByDate = {};
  cachedAttendance.forEach((r) => {
    attendanceByDate[r.date] = (attendanceByDate[r.date] || 0) + 1;
  });
  const attendancePoints = dates.map((d) => ({ label: shortDateLabel(d), value: attendanceByDate[d] || 0 }));
  const attendanceEl = document.getElementById('chart-attendance-trend');
  attendanceEl.innerHTML = attendancePoints.some((p) => p.value > 0)
    ? svgLineChart(attendancePoints)
    : '<div class="chart-empty">No attendance data in this range.</div>';

  // Leave trend: approved leave overlapping each day.
  const approvedLeave = cachedLeave.filter((r) => r.status === 'approved');
  const leavePoints = dates.map((d) => ({
    label: shortDateLabel(d),
    value: approvedLeave.filter((r) => r.start_date <= d && r.end_date >= d).length
  }));
  const leaveEl = document.getElementById('chart-leave-trend');
  leaveEl.innerHTML = leavePoints.some((p) => p.value > 0)
    ? svgLineChart(leavePoints)
    : '<div class="chart-empty">No approved leave in this range.</div>';

  // Worked hours by employee (top 10, completed shifts only).
  const hoursByEmployee = {};
  cachedAttendance.forEach((r) => {
    if (!r.clock_out) return;
    const label = employeeLabel(r.profiles);
    hoursByEmployee[label] = (hoursByEmployee[label] || 0) + Number(r.total_hours || 0);
  });
  const hoursItems = Object.entries(hoursByEmployee)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const hoursEl = document.getElementById('chart-worked-hours');
  hoursEl.innerHTML = hoursItems.length
    ? svgBarChart(hoursItems)
    : '<div class="chart-empty">No completed shifts in this range.</div>';
}

// ---- Report computations (all client-side, from cached raw rows) -------------------
function computeDaily() {
  const columns = ['Date', 'Employee', 'Department', 'Clock In', 'Clock Out', 'Break (min)', 'Total Hours', 'Status'];
  const rows = cachedAttendance.map((r) => {
    const breakMin = (r.breaks || []).reduce((sum, b) => sum + (Number(b.duration_minutes) || 0), 0);
    return [
      formatDateLabel(r.date),
      employeeLabel(r.profiles),
      r.profiles?.department || '–',
      formatTime(r.clock_in),
      formatTime(r.clock_out),
      String(Math.round(breakMin)),
      r.clock_out ? Number(r.total_hours).toFixed(2) : 'In progress',
      r.status
    ];
  });
  return { title: 'Daily Attendance', columns, rows };
}

function isoWeekStart(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const day = date.getDay() === 0 ? 7 : date.getDay(); // Mon=1..Sun=7
  date.setDate(date.getDate() - (day - 1));
  return date.toLocaleDateString('en-CA');
}

function computePeriodSummary(groupKeyFn, periodLabel) {
  const groups = new Map();
  cachedAttendance.forEach((r) => {
    const period = groupKeyFn(r.date);
    const key = `${r.user_id}|${period}`;
    if (!groups.has(key)) {
      groups.set(key, { employee: employeeLabel(r.profiles), department: r.profiles?.department || '–', period, days: 0, hours: 0 });
    }
    const g = groups.get(key);
    g.days += 1;
    if (r.clock_out) g.hours += Number(r.total_hours || 0);
  });

  const columns = ['Employee', 'Department', periodLabel, 'Days Present', 'Total Hours'];
  const rows = Array.from(groups.values())
    .sort((a, b) => (a.period === b.period ? a.employee.localeCompare(b.employee) : a.period.localeCompare(b.period)))
    .map((g) => [g.employee, g.department, g.period, String(g.days), g.hours.toFixed(2)]);

  return { columns, rows };
}

function computeWeekly() {
  const { columns, rows } = computePeriodSummary((date) => `Week of ${formatDateLabel(isoWeekStart(date))}`, 'Week');
  return { title: 'Weekly Attendance', columns, rows };
}

function computeMonthly() {
  const { columns, rows } = computePeriodSummary((date) => date.slice(0, 7), 'Month');
  return { title: 'Monthly Attendance', columns, rows };
}

function computeEmployeeSummary() {
  const groups = new Map();
  cachedAttendance.forEach((r) => {
    if (!groups.has(r.user_id)) {
      groups.set(r.user_id, { employee: employeeLabel(r.profiles), department: r.profiles?.department || '–', days: 0, hours: 0, late: 0 });
    }
    const g = groups.get(r.user_id);
    g.days += 1;
    if (r.clock_out) g.hours += Number(r.total_hours || 0);
    if (r.status === 'late') g.late += 1;
  });

  const columns = ['Employee', 'Department', 'Days Present', 'Total Hours', 'Avg Hours/Day', 'Late Days'];
  const rows = Array.from(groups.values())
    .sort((a, b) => a.employee.localeCompare(b.employee))
    .map((g) => [
      g.employee,
      g.department,
      String(g.days),
      g.hours.toFixed(2),
      g.days ? (g.hours / g.days).toFixed(2) : '0.00',
      String(g.late)
    ]);

  return { title: 'Employee Attendance Summary', columns, rows };
}

function computeWorkedHours() {
  const groups = new Map();
  cachedAttendance.forEach((r) => {
    if (!r.clock_out) return;
    if (!groups.has(r.user_id)) {
      groups.set(r.user_id, { employee: employeeLabel(r.profiles), department: r.profiles?.department || '–', days: 0, hours: 0 });
    }
    const g = groups.get(r.user_id);
    g.days += 1;
    g.hours += Number(r.total_hours || 0);
  });

  const columns = ['Employee', 'Department', 'Days Worked', 'Total Hours', 'Avg Hours/Day'];
  const rows = Array.from(groups.values())
    .sort((a, b) => b.hours - a.hours)
    .map((g) => [g.employee, g.department, String(g.days), g.hours.toFixed(2), g.days ? (g.hours / g.days).toFixed(2) : '0.00']);

  return { title: 'Worked Hours Summary', columns, rows };
}

function computeOvertime() {
  const threshold = Number(cachedSettings.overtime_threshold) || 8;
  const groups = new Map();
  cachedAttendance.forEach((r) => {
    if (!r.clock_out) return;
    const overtime = Math.max(Number(r.total_hours || 0) - threshold, 0);
    if (overtime <= 0) return;
    if (!groups.has(r.user_id)) {
      groups.set(r.user_id, { employee: employeeLabel(r.profiles), department: r.profiles?.department || '–', overtimeHours: 0, overtimeDays: 0 });
    }
    const g = groups.get(r.user_id);
    g.overtimeHours += overtime;
    g.overtimeDays += 1;
  });

  const columns = ['Employee', 'Department', 'Overtime Days', 'Total Overtime Hours'];
  const rows = Array.from(groups.values())
    .sort((a, b) => b.overtimeHours - a.overtimeHours)
    .map((g) => [g.employee, g.department, String(g.overtimeDays), g.overtimeHours.toFixed(2)]);

  return { title: `Overtime Summary (threshold: ${threshold}h/day)`, columns, rows };
}

function computeLateArrivals() {
  const columns = ['Date', 'Employee', 'Department', 'Clock In', 'Status'];
  const rows = cachedAttendance
    .filter((r) => r.status === 'late')
    .map((r) => [formatDateLabel(r.date), employeeLabel(r.profiles), r.profiles?.department || '–', formatTime(r.clock_in), r.status]);
  return { title: 'Late Arrivals', columns, rows };
}

function computeEarlyCheckouts() {
  const standardHours = Number(cachedSettings.work_hours_per_day) || 8;
  const columns = ['Date', 'Employee', 'Department', 'Clock Out', 'Hours Worked', 'Shortfall'];
  const rows = cachedAttendance
    .filter((r) => r.clock_out && Number(r.total_hours || 0) < standardHours)
    .map((r) => [
      formatDateLabel(r.date),
      employeeLabel(r.profiles),
      r.profiles?.department || '–',
      formatTime(r.clock_out),
      Number(r.total_hours).toFixed(2),
      (standardHours - Number(r.total_hours)).toFixed(2)
    ]);
  return { title: `Early Check-outs (standard day: ${standardHours}h)`, columns, rows };
}

function computeAbsent() {
  const columns = ['Employee', 'Email', 'Department', 'Role'];
  const rows = cachedAbsent.map((e) => [e.full_name || '–', e.email, e.department || '–', e.role]);
  return { title: `Absent Employees (as of ${formatDateLabel(currentFilters.startDate)})`, columns, rows };
}

function computeLeaveSummary() {
  const groups = new Map();
  cachedLeave.forEach((r) => {
    if (!groups.has(r.user_id)) {
      groups.set(r.user_id, { employee: employeeLabel(r.profiles), department: r.profiles?.department || '–', pending: 0, approved: 0, rejected: 0, approvedDays: 0 });
    }
    const g = groups.get(r.user_id);
    g[r.status] = (g[r.status] || 0) + 1;
    if (r.status === 'approved') {
      const start = new Date(`${r.start_date}T00:00:00`);
      const end = new Date(`${r.end_date}T00:00:00`);
      g.approvedDays += Math.max(Math.round((end - start) / 86400000) + 1, 0);
    }
  });

  const columns = ['Employee', 'Department', 'Pending', 'Approved', 'Rejected', 'Approved Days'];
  const rows = Array.from(groups.values())
    .sort((a, b) => a.employee.localeCompare(b.employee))
    .map((g) => [g.employee, g.department, String(g.pending), String(g.approved), String(g.rejected), String(g.approvedDays)]);

  return { title: 'Leave Summary', columns, rows };
}

const REPORT_COMPUTERS = {
  daily: computeDaily,
  weekly: computeWeekly,
  monthly: computeMonthly,
  'employee-summary': computeEmployeeSummary,
  'worked-hours': computeWorkedHours,
  overtime: computeOvertime,
  'late-arrivals': computeLateArrivals,
  'early-checkouts': computeEarlyCheckouts,
  absent: computeAbsent,
  'leave-summary': computeLeaveSummary
};

// ---- Table rendering + export ------------------------------------------------------
function renderReportTable(reportType) {
  const computer = REPORT_COMPUTERS[reportType] || computeDaily;
  const result = computer();
  lastTable = result;

  document.getElementById('report-table-title').textContent = result.title;
  document.getElementById('print-report-title').textContent = result.title;

  const emptyEl = document.getElementById('report-empty');
  const tableWrap = document.getElementById('report-table-wrap');
  const thead = document.getElementById('report-table-head');
  const tbody = document.getElementById('report-table-body');

  if (!result.rows.length) {
    tableWrap.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector('h3').textContent = 'No data for this report';
    emptyEl.querySelector('p').textContent = 'Try widening the date range or clearing a filter.';
    return;
  }

  emptyEl.hidden = true;
  tableWrap.hidden = false;

  thead.innerHTML = `<tr>${result.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  tbody.innerHTML = result.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
}

function tableToCsv() {
  const escapeCsv = (val) => {
    const str = String(val ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [lastTable.columns.map(escapeCsv).join(',')];
  lastTable.rows.forEach((row) => lines.push(row.map(escapeCsv).join(',')));
  return lines.join('\r\n');
}

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

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

document.getElementById('export-csv-btn')?.addEventListener('click', () => {
  if (!lastTable.rows.length) {
    notifyError('Generate a report with data first.');
    return;
  }
  downloadBlob(tableToCsv(), `${slugify(lastTable.title)}.csv`, 'text/csv;charset=utf-8;');
  notifySuccess('CSV exported.');
});

document.getElementById('export-excel-btn')?.addEventListener('click', () => {
  if (!lastTable.rows.length) {
    notifyError('Generate a report with data first.');
    return;
  }
  const headerRow = `<tr>${lastTable.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  const bodyRows = lastTable.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const html = `<html><head><meta charset="UTF-8"></head><body><table border="1">${headerRow}${bodyRows}</table></body></html>`;
  downloadBlob(html, `${slugify(lastTable.title)}.xls`, 'application/vnd.ms-excel');
  notifySuccess('Excel file exported.');
});

document.getElementById('print-report-btn')?.addEventListener('click', () => {
  if (!lastTable.rows.length) {
    notifyError('Generate a report with data first.');
    return;
  }
  window.print();
});

// ---- Generate report ------------------------------------------------------------
function readFilters() {
  return {
    startDate: document.getElementById('report-start-date').value,
    endDate: document.getElementById('report-end-date').value,
    employeeId: document.getElementById('report-employee-filter').value,
    department: document.getElementById('report-department-filter').value,
    role: document.getElementById('report-role-filter').value
  };
}

async function generateReport() {
  const filters = readFilters();

  if (!filters.startDate || !filters.endDate) {
    showAlert(document.getElementById('reports-alert'), 'Choose a start and end date.', 'danger');
    return;
  }
  if (new Date(filters.endDate) < new Date(filters.startDate)) {
    showAlert(document.getElementById('reports-alert'), 'End date must be on or after the start date.', 'danger');
    return;
  }
  hideAlert(document.getElementById('reports-alert'));

  currentFilters = filters;
  const reportType = document.getElementById('report-type-select').value;

  const generateBtn = document.getElementById('generate-report-btn');
  setButtonLoading(generateBtn, true, 'Generating…');

  const tasks = [
    getAttendanceInRange(filters),
    getLeaveInRange(filters),
    getReportSettings()
  ];
  if (reportType === 'absent') {
    tasks.push(getAbsentEmployees({ date: filters.startDate, department: filters.department, role: filters.role }));
  }

  const results = await Promise.all(tasks);
  const [attendanceResult, leaveResult, settingsResult, absentResult] = results;

  setButtonLoading(generateBtn, false);

  if (attendanceResult.error || leaveResult.error || settingsResult.error || (absentResult && absentResult.error)) {
    showAlert(document.getElementById('reports-alert'), "Couldn't load report data. Please try again.", 'danger');
    notifyError("Couldn't load report data.");
    return;
  }

  cachedAttendance = attendanceResult.data || [];
  cachedLeave = leaveResult.data || [];
  cachedSettings = settingsResult.data || cachedSettings;
  cachedAbsent = absentResult ? absentResult.data || [] : [];

  renderCharts();
  renderReportTable(reportType);
  notifySuccess('Report generated.');
}

document.getElementById('generate-report-btn')?.addEventListener('click', generateReport);
document.getElementById('report-type-select')?.addEventListener('change', () => {
  // Re-render from already-cached data when just switching report type,
  // unless "Absent Employees" is chosen and hasn't been fetched yet.
  const reportType = document.getElementById('report-type-select').value;
  if (reportType === 'absent' && cachedAbsent.length === 0) {
    generateReport();
  } else {
    renderReportTable(reportType);
  }
});

// ---- Boot ------------------------------------------------------------------------
(async function boot() {
  const session = await initProtectedPage();
  if (!session) return; // already redirected to login

  const profile = await requireRole('admin');
  if (!profile) return; // requireRole already redirected non-admins away

  renderSidebarProfile(profile);
  setDefaultDates();
  await populateFilterDropdowns();
  await generateReport();
})();
