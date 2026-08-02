// =============================================================================
// payroll.page.js
// Bootstrap script for payroll.html. Admin-only page. Talks to Supabase
// ONLY through payrollService.js, roles.js, and session.js — plus a
// read-only reuse of reportService.js's getFilterOptions() (not modified).
// =============================================================================

import { initProtectedPage, logout } from '../session.js';
import { requireRole } from '../roles.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifyError, notifySuccess, notifyInfo } from '../notifications.js';
import { setButtonLoading, showAlert, hideAlert } from '../ui.js';
import { getFilterOptions } from '../reportService.js';
import {
  getPayrollSettings,
  getEmployeesWithRates,
  updateHourlyRate,
  generatePayrollForFilters,
  getPayrollHistory,
  updatePayrollRecord,
  updatePayrollStatus
} from '../payrollService.js';

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
let lastHistoryTable = { columns: [], rows: [] }; // drives CSV/Excel export
let editingRecordId = null;

// ---- Formatting helpers -------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatPeriodLabel(periodStart) {
  const date = new Date(`${periodStart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return periodStart;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function getPeriodBounds(year, monthIndex) {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  const toISO = (d) => d.toLocaleDateString('en-CA');
  return { periodStart: toISO(start), periodEnd: toISO(end) };
}

function employeeLabel(profile) {
  return profile?.full_name || profile?.email || 'Unknown';
}

// ---- Setup: year select + filter dropdowns ----------------------------------
function populateYearSelect() {
  const select = document.getElementById('payroll-year-select');
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= currentYear - 4; y -= 1) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    select.appendChild(opt);
  }
  select.value = String(currentYear);
  document.getElementById('payroll-month-select').value = String(new Date().getMonth());
}

async function populateFilterDropdowns() {
  const { data, error } = await getFilterOptions();
  if (error) {
    notifyError("Couldn't load filter options.");
    return;
  }

  const employeeSelect = document.getElementById('payroll-employee-filter');
  data.employees.forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.full_name || emp.email;
    employeeSelect.appendChild(opt);
  });

  const departmentSelect = document.getElementById('payroll-department-filter');
  data.departments.forEach((dept) => {
    const opt = document.createElement('option');
    opt.value = dept;
    opt.textContent = dept;
    departmentSelect.appendChild(opt);
  });
}

// ---- Hourly rates panel -------------------------------------------------------
async function loadRates() {
  const { data, error } = await getEmployeesWithRates();
  const listEl = document.getElementById('rates-list');
  const emptyEl = document.getElementById('rates-empty');

  if (error) {
    notifyError("Couldn't load employee rates.");
    return;
  }

  if (!data || data.length === 0) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  listEl.innerHTML = data
    .map(
      (emp) => `
      <div class="rates-row">
        <div class="rates-name">
          <div class="full-name">${escapeHtml(emp.full_name || emp.email)}</div>
          <div class="dept">${escapeHtml(emp.department || 'No department')}</div>
        </div>
        <input class="input rate-input" type="number" step="0.01" min="0" value="${Number(emp.hourly_rate || 0).toFixed(2)}" data-rate-id="${emp.id}" />
        <button class="btn btn-secondary btn-sm" data-save-rate-id="${emp.id}">Save rate</button>
      </div>`
    )
    .join('');

  listEl.querySelectorAll('[data-save-rate-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveRateId;
      const input = listEl.querySelector(`[data-rate-id="${id}"]`);
      setButtonLoading(btn, true, 'Saving…');
      const { error: saveError } = await updateHourlyRate(id, input.value);
      setButtonLoading(btn, false);
      if (saveError) {
        notifyError(saveError.message);
        return;
      }
      notifySuccess('Hourly rate saved.');
    });
  });
}

// ---- Payroll history ----------------------------------------------------------
function readFilters() {
  const year = Number(document.getElementById('payroll-year-select').value);
  const month = Number(document.getElementById('payroll-month-select').value);
  const { periodStart, periodEnd } = getPeriodBounds(year, month);
  return {
    periodStart,
    periodEnd,
    employeeId: document.getElementById('payroll-employee-filter').value,
    department: document.getElementById('payroll-department-filter').value
  };
}

function renderHistoryTable(records) {
  const tableWrap = document.getElementById('payroll-history-table-wrap');
  const emptyState = document.getElementById('payroll-history-empty');
  const tbody = document.getElementById('payroll-history-table-body');

  if (!records || records.length === 0) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    lastHistoryTable = { columns: [], rows: [] };
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  const columns = [
    'Employee', 'Period', 'Basic', 'Overtime', 'Leave Deduction', 'Bonus', 'Penalty',
    'Gross', 'Tax', 'Insurance', 'Net', 'Status'
  ];
  lastHistoryTable = {
    columns,
    rows: records.map((r) => [
      employeeLabel(r.profiles),
      formatPeriodLabel(r.period_start),
      Number(r.basic_salary).toFixed(2),
      Number(r.overtime_pay).toFixed(2),
      Number(r.leave_deduction).toFixed(2),
      Number(r.bonus).toFixed(2),
      Number(r.penalty).toFixed(2),
      Number(r.gross_pay).toFixed(2),
      Number(r.tax).toFixed(2),
      Number(r.insurance).toFixed(2),
      Number(r.net_pay).toFixed(2),
      r.status
    ])
  };

  tbody.innerHTML = records
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(employeeLabel(r.profiles))}</td>
        <td>${escapeHtml(formatPeriodLabel(r.period_start))}</td>
        <td>${money(r.basic_salary)}</td>
        <td>${money(r.overtime_pay)}</td>
        <td>${money(r.leave_deduction)}</td>
        <td>${money(r.bonus)}</td>
        <td>${money(r.penalty)}</td>
        <td>${money(r.gross_pay)}</td>
        <td>${money(r.tax)}</td>
        <td>${money(r.insurance)}</td>
        <td><strong>${money(r.net_pay)}</strong></td>
        <td>
          <select class="status-select" data-status-id="${r.id}">
            <option value="draft" ${r.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="paid" ${r.status === 'paid' ? 'selected' : ''}>Paid</option>
          </select>
        </td>
        <td>
          <div class="payroll-actions-cell">
            <button class="btn btn-secondary btn-sm" data-edit-id="${r.id}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-print-id="${r.id}">Print</button>
          </div>
        </td>
      </tr>`
    )
    .join('');

  tbody.querySelectorAll('[data-status-id]').forEach((select) => {
    select.addEventListener('change', () => handleStatusChange(select.dataset.statusId, select.value, select));
  });
  tbody.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(records.find((r) => r.id === btn.dataset.editId)));
  });
  tbody.querySelectorAll('[data-print-id]').forEach((btn) => {
    btn.addEventListener('click', () => printPayslip(records.find((r) => r.id === btn.dataset.printId)));
  });
}

async function loadHistory() {
  const filters = readFilters();
  const { data, error } = await getPayrollHistory(filters);

  if (error) {
    showAlert(document.getElementById('payroll-alert'), "Couldn't load payroll history.", 'danger');
    notifyError("Couldn't load payroll history.");
    return;
  }

  hideAlert(document.getElementById('payroll-alert'));
  renderHistoryTable(data);
}

document.getElementById('payroll-month-select')?.addEventListener('change', loadHistory);
document.getElementById('payroll-year-select')?.addEventListener('change', loadHistory);
document.getElementById('payroll-employee-filter')?.addEventListener('change', loadHistory);
document.getElementById('payroll-department-filter')?.addEventListener('change', loadHistory);

// ---- Generate payroll -----------------------------------------------------------
document.getElementById('generate-payroll-btn')?.addEventListener('click', async () => {
  const filters = readFilters();
  const btn = document.getElementById('generate-payroll-btn');
  setButtonLoading(btn, true, 'Generating…');

  const { data: results, error } = await generatePayrollForFilters(filters);

  setButtonLoading(btn, false);

  if (error) {
    showAlert(document.getElementById('payroll-alert'), "Couldn't generate payroll.", 'danger');
    notifyError("Couldn't generate payroll.");
    return;
  }

  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.filter((r) => r.error).length;

  if (failed > 0) {
    notifyError(`Generated ${succeeded} record(s), ${failed} failed.`);
  } else if (succeeded === 0) {
    notifyInfo('No active employees matched these filters.');
  } else {
    notifySuccess(`Generated payroll for ${succeeded} employee${succeeded === 1 ? '' : 's'}.`);
  }

  await loadHistory();
});

// ---- Status change --------------------------------------------------------------
async function handleStatusChange(id, status, selectEl) {
  selectEl.disabled = true;
  const { error } = await updatePayrollStatus(id, status);
  selectEl.disabled = false;

  if (error) {
    notifyError(error.message);
    await loadHistory();
    return;
  }
  notifySuccess('Status updated.');
}

// ---- Edit breakdown modal ---------------------------------------------------------
const editModalOverlay = document.getElementById('payroll-edit-modal-overlay');

function openEditModal(record) {
  if (!record) return;
  editingRecordId = record.id;
  hideAlert(document.getElementById('payroll-edit-alert'));

  document.getElementById('payroll-edit-bonus').value = Number(record.bonus).toFixed(2);
  document.getElementById('payroll-edit-penalty').value = Number(record.penalty).toFixed(2);
  document.getElementById('payroll-edit-tax').value = Number(record.tax).toFixed(2);
  document.getElementById('payroll-edit-insurance').value = Number(record.insurance).toFixed(2);

  document.getElementById('payroll-edit-summary').innerHTML = `
    <div class="payroll-summary-row"><span>${escapeHtml(employeeLabel(record.profiles))}</span><span>${escapeHtml(formatPeriodLabel(record.period_start))}</span></div>
    <div class="payroll-summary-row"><span>Basic salary</span><span>${money(record.basic_salary)}</span></div>
    <div class="payroll-summary-row"><span>Overtime</span><span>${money(record.overtime_pay)}</span></div>
    <div class="payroll-summary-row"><span>Leave deduction</span><span>${money(record.leave_deduction)}</span></div>
  `;

  editModalOverlay.hidden = false;
}

function closeEditModal() {
  editModalOverlay.hidden = true;
  editingRecordId = null;
}

document.getElementById('payroll-edit-cancel-btn')?.addEventListener('click', closeEditModal);
editModalOverlay?.addEventListener('click', (e) => {
  if (e.target === editModalOverlay) closeEditModal();
});

document.getElementById('payroll-edit-save-btn')?.addEventListener('click', async () => {
  if (!editingRecordId) return;
  hideAlert(document.getElementById('payroll-edit-alert'));

  const bonus = document.getElementById('payroll-edit-bonus').value;
  const penalty = document.getElementById('payroll-edit-penalty').value;
  const tax = document.getElementById('payroll-edit-tax').value;
  const insurance = document.getElementById('payroll-edit-insurance').value;

  const saveBtn = document.getElementById('payroll-edit-save-btn');
  setButtonLoading(saveBtn, true, 'Saving…');

  const { error } = await updatePayrollRecord(editingRecordId, { bonus, penalty, tax, insurance });

  setButtonLoading(saveBtn, false);

  if (error) {
    showAlert(document.getElementById('payroll-edit-alert'), error.message, 'danger');
    return;
  }

  notifySuccess('Payroll record updated.');
  closeEditModal();
  await loadHistory();
});

// ---- Print payslip ----------------------------------------------------------------
function printPayslip(record) {
  if (!record) return;

  document.getElementById('payslip-period').textContent = `Payslip · ${formatPeriodLabel(record.period_start)}`;
  document.getElementById('payslip-employee-name').textContent = employeeLabel(record.profiles);
  document.getElementById('payslip-employee-dept').textContent = record.profiles?.department || '';
  document.getElementById('payslip-basic').textContent = money(record.basic_salary);
  document.getElementById('payslip-overtime').textContent = money(record.overtime_pay);
  document.getElementById('payslip-bonus').textContent = money(record.bonus);
  document.getElementById('payslip-leave-deduction').textContent = `-${money(record.leave_deduction)}`;
  document.getElementById('payslip-penalty').textContent = `-${money(record.penalty)}`;
  document.getElementById('payslip-gross').textContent = money(record.gross_pay);
  document.getElementById('payslip-tax').textContent = `-${money(record.tax)}`;
  document.getElementById('payslip-insurance').textContent = `-${money(record.insurance)}`;
  document.getElementById('payslip-net').textContent = money(record.net_pay);
  document.getElementById('payslip-status').textContent = record.status;

  window.print();
}

// ---- Export CSV / Excel ------------------------------------------------------------
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

document.getElementById('export-csv-btn')?.addEventListener('click', () => {
  if (!lastHistoryTable.rows.length) {
    notifyError('No payroll records to export.');
    return;
  }
  const escapeCsv = (val) => {
    const str = String(val ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [lastHistoryTable.columns.map(escapeCsv).join(',')];
  lastHistoryTable.rows.forEach((row) => lines.push(row.map(escapeCsv).join(',')));
  downloadBlob(lines.join('\r\n'), 'payroll-history.csv', 'text/csv;charset=utf-8;');
  notifySuccess('CSV exported.');
});

document.getElementById('export-excel-btn')?.addEventListener('click', () => {
  if (!lastHistoryTable.rows.length) {
    notifyError('No payroll records to export.');
    return;
  }
  const headerRow = `<tr>${lastHistoryTable.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  const bodyRows = lastHistoryTable.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  const html = `<html><head><meta charset="UTF-8"></head><body><table border="1">${headerRow}${bodyRows}</table></body></html>`;
  downloadBlob(html, 'payroll-history.xls', 'application/vnd.ms-excel');
  notifySuccess('Excel file exported.');
});

// ---- Boot ------------------------------------------------------------------------
(async function boot() {
  const session = await initProtectedPage();
  if (!session) return; // already redirected to login

  const profile = await requireRole('admin');
  if (!profile) return; // requireRole already redirected non-admins away

  renderSidebarProfile(profile);
  populateYearSelect();
  await populateFilterDropdowns();
  await getPayrollSettings(); // touch once so settings errors surface early if misconfigured
  await loadRates();
  await loadHistory();
})();
