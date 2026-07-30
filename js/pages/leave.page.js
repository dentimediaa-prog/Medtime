// =============================================================================
// leave.page.js
// Bootstrap script for leave.html. Talks to Supabase ONLY through
// leaveService.js, roles.js, and session.js — no direct queries here.
// =============================================================================

import { initProtectedPage, logout } from '../session.js';
import { getCurrentProfile } from '../roles.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifyError, notifySuccess, notifyInfo } from '../notifications.js';
import { setButtonLoading, showAlert, hideAlert, clearAllFieldErrors, showFieldError } from '../ui.js';
import {
  getMyLeaveRequests,
  getLeaveBalance,
  submitLeaveRequest,
  cancelLeaveRequest,
  getAllLeaveRequests,
  getEmployeeOptions,
  approveLeaveRequest,
  rejectLeaveRequest,
  subscribeToMyLeaveRequests,
  subscribeToAllLeaveRequests
} from '../leaveService.js';

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

// ---- Role-based visibility -----------------------------------------------------
function applyRoleVisibility(role) {
  const isAdminUser = role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.hidden = !isAdminUser;
  });
}

// ---- Module state -----------------------------------------------------------
let currentProfile = null;
let isAdmin = false;
let pendingRejectRequestId = null;
let employeeOptionsLoaded = false;

// ---- Formatting helpers -------------------------------------------------------
const LEAVE_TYPE_LABELS = { annual: 'Annual', sick: 'Sick', unpaid: 'Unpaid', other: 'Other' };
const STATUS_BADGE_CLASS = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };

function formatDate(dateStr) {
  if (!dateStr) return '–';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateRange(start, end) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function formatDateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diff = Math.round((end - start) / 86400000) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ---- Employee: balance ---------------------------------------------------------
async function loadBalance() {
  const { data, error } = await getLeaveBalance(currentProfile.id);
  if (error) {
    notifyError("Couldn't load your leave balance.");
    return;
  }
  document.getElementById('leave-balance-entitlement').textContent = `${data.entitlement}`;
  document.getElementById('leave-balance-used').textContent = `${data.used}`;
  document.getElementById('leave-balance-remaining').textContent = `${data.remaining}`;
}

// ---- Employee: current request + history ----------------------------------------
function renderCurrentRequest(requests) {
  const emptyEl = document.getElementById('current-request-empty');
  const contentEl = document.getElementById('current-request-content');

  if (!requests || requests.length === 0) {
    emptyEl.hidden = false;
    contentEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  contentEl.hidden = false;

  const latest = requests[0];

  document.getElementById('current-request-type').textContent = `${LEAVE_TYPE_LABELS[latest.leave_type] || latest.leave_type} leave`;
  document.getElementById('current-request-dates').textContent = formatDateRange(latest.start_date, latest.end_date);

  const badgeEl = document.getElementById('current-request-status-badge');
  badgeEl.textContent = latest.status;
  badgeEl.className = `badge ${STATUS_BADGE_CLASS[latest.status] || 'badge-neutral'}`;

  const rejectionEl = document.getElementById('current-request-rejection');
  if (latest.status === 'rejected' && latest.rejection_reason) {
    rejectionEl.hidden = false;
    rejectionEl.textContent = `Rejection reason: ${latest.rejection_reason}`;
  } else {
    rejectionEl.hidden = true;
    rejectionEl.textContent = '';
  }

  const cancelBtn = document.getElementById('current-request-cancel-btn');
  cancelBtn.hidden = latest.status !== 'pending';
  cancelBtn.onclick = () => handleCancel(latest.id);
}

function renderMyHistory(requests) {
  const tableWrap = document.getElementById('my-history-table-wrap');
  const emptyState = document.getElementById('my-history-empty');
  const tbody = document.getElementById('my-history-table-body');

  if (!requests || requests.length === 0) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  tbody.innerHTML = requests
    .map((r) => {
      const notes = r.status === 'rejected' && r.rejection_reason ? escapeHtml(r.rejection_reason) : '–';
      const action =
        r.status === 'pending'
          ? `<button class="btn btn-danger btn-sm" data-cancel-id="${r.id}">Cancel</button>`
          : '–';
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(r.created_at))}</td>
          <td>${escapeHtml(LEAVE_TYPE_LABELS[r.leave_type] || r.leave_type)}</td>
          <td>${escapeHtml(formatDateRange(r.start_date, r.end_date))}</td>
          <td>${escapeHtml(r.reason)}</td>
          <td><span class="badge ${STATUS_BADGE_CLASS[r.status] || 'badge-neutral'}">${escapeHtml(r.status)}</span></td>
          <td>${notes}</td>
          <td>${action}</td>
        </tr>`;
    })
    .join('');

  tbody.querySelectorAll('[data-cancel-id]').forEach((btn) => {
    btn.addEventListener('click', () => handleCancel(btn.dataset.cancelId));
  });
}

async function loadMyRequests() {
  const { data, error } = await getMyLeaveRequests(currentProfile.id);
  if (error) {
    notifyError("Couldn't load your leave requests.");
    return;
  }
  renderCurrentRequest(data);
  renderMyHistory(data);
}

async function refreshEmployeeView() {
  await Promise.all([loadBalance(), loadMyRequests()]);
}

async function handleCancel(requestId) {
  const { error } = await cancelLeaveRequest(requestId);
  if (error) {
    notifyError(error.message);
    return;
  }
  notifySuccess('Leave request cancelled.');
  await refreshEmployeeView();
}

// ---- Employee: submit form -----------------------------------------------------
const leaveForm = document.getElementById('leave-form');
const startDateInput = document.getElementById('leave-start-date');
const endDateInput = document.getElementById('leave-end-date');
const daysPreviewEl = document.getElementById('leave-days-preview');

function updateDaysPreview() {
  const start = startDateInput.value;
  const end = endDateInput.value;
  if (!start || !end) {
    daysPreviewEl.textContent = '\u00A0';
    return;
  }
  if (new Date(end) < new Date(start)) {
    daysPreviewEl.textContent = 'End date must be on or after the start date.';
    return;
  }
  const days = daysInclusive(start, end);
  daysPreviewEl.textContent = `${days} day${days === 1 ? '' : 's'} requested`;
}
startDateInput?.addEventListener('change', updateDaysPreview);
endDateInput?.addEventListener('change', updateDaysPreview);

leaveForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAllFieldErrors(leaveForm);
  hideAlert(document.getElementById('leave-form-alert'));

  const leaveType = document.getElementById('leave-type-select').value;
  const startDate = startDateInput.value;
  const endDate = endDateInput.value;
  const reason = document.getElementById('leave-reason').value;

  let hasError = false;
  if (!leaveType) {
    showFieldError(document.getElementById('leave-type-field'), 'Choose a leave type.');
    hasError = true;
  }
  if (!startDate) {
    showFieldError(document.getElementById('leave-start-date-field'), 'Choose a start date.');
    hasError = true;
  }
  if (!endDate) {
    showFieldError(document.getElementById('leave-end-date-field'), 'Choose an end date.');
    hasError = true;
  }
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    showFieldError(document.getElementById('leave-end-date-field'), 'Must be on or after the start date.');
    hasError = true;
  }
  if (!reason.trim()) {
    showFieldError(document.getElementById('leave-reason-field'), 'Enter a reason.');
    hasError = true;
  }
  if (hasError) return;

  const submitBtn = document.getElementById('leave-submit-btn');
  setButtonLoading(submitBtn, true, 'Submitting…');

  const { error } = await submitLeaveRequest({
    userId: currentProfile.id,
    leaveType,
    startDate,
    endDate,
    reason
  });

  setButtonLoading(submitBtn, false);

  if (error) {
    showAlert(document.getElementById('leave-form-alert'), error.message, 'danger');
    return;
  }

  notifySuccess('Leave request submitted.');
  leaveForm.reset();
  daysPreviewEl.textContent = '\u00A0';
  await refreshEmployeeView();
});

// ---- Admin: filters + table -----------------------------------------------------
async function populateEmployeeFilter() {
  if (employeeOptionsLoaded) return;
  const { data, error } = await getEmployeeOptions();
  if (error) {
    notifyError("Couldn't load the employee list.");
    return;
  }
  const select = document.getElementById('admin-filter-employee');
  (data || []).forEach((emp) => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.full_name || emp.email;
    select.appendChild(opt);
  });
  employeeOptionsLoaded = true;
}

function renderAdminTable(requests) {
  const tableWrap = document.getElementById('admin-requests-table-wrap');
  const emptyState = document.getElementById('admin-requests-empty');
  const tbody = document.getElementById('admin-requests-table-body');

  if (!requests || requests.length === 0) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  tbody.innerHTML = requests
    .map((r) => {
      const employeeName = escapeHtml(r.requester?.full_name || r.requester?.email || 'Unknown');
      const notes = r.status === 'rejected' && r.rejection_reason ? escapeHtml(r.rejection_reason) : '–';
      const actions =
        r.status === 'pending'
          ? `<button class="btn btn-secondary btn-sm" data-approve-id="${r.id}">Approve</button>
             <button class="btn btn-danger btn-sm" data-reject-id="${r.id}">Reject</button>`
          : '–';
      return `
        <tr>
          <td>${employeeName}</td>
          <td>${escapeHtml(LEAVE_TYPE_LABELS[r.leave_type] || r.leave_type)}</td>
          <td>${escapeHtml(formatDateRange(r.start_date, r.end_date))}</td>
          <td>${escapeHtml(r.reason)}</td>
          <td>${escapeHtml(formatDateTime(r.created_at))}</td>
          <td><span class="badge ${STATUS_BADGE_CLASS[r.status] || 'badge-neutral'}">${escapeHtml(r.status)}</span></td>
          <td>${notes}</td>
          <td><div class="leave-actions-cell">${actions}</div></td>
        </tr>`;
    })
    .join('');

  tbody.querySelectorAll('[data-approve-id]').forEach((btn) => {
    btn.addEventListener('click', () => handleApprove(btn.dataset.approveId, btn));
  });
  tbody.querySelectorAll('[data-reject-id]').forEach((btn) => {
    btn.addEventListener('click', () => openRejectModal(btn.dataset.rejectId));
  });
}

async function loadAdminRequests() {
  const status = document.getElementById('admin-filter-status').value;
  const employeeId = document.getElementById('admin-filter-employee').value;
  const { data, error } = await getAllLeaveRequests({ status: status || undefined, employeeId: employeeId || undefined });
  if (error) {
    notifyError("Couldn't load leave requests.");
    return;
  }
  renderAdminTable(data);
}

document.getElementById('admin-filter-status')?.addEventListener('change', loadAdminRequests);
document.getElementById('admin-filter-employee')?.addEventListener('change', loadAdminRequests);
document.getElementById('admin-clear-filters-btn')?.addEventListener('click', () => {
  document.getElementById('admin-filter-status').value = '';
  document.getElementById('admin-filter-employee').value = '';
  loadAdminRequests();
});

async function handleApprove(requestId, btn) {
  setButtonLoading(btn, true, 'Approving…');
  const { error } = await approveLeaveRequest(requestId, currentProfile.id);
  setButtonLoading(btn, false, '');
  if (error) {
    notifyError(error.message);
    return;
  }
  notifySuccess('Leave request approved.');
  await loadAdminRequests();
}

// ---- Admin: reject modal -----------------------------------------------------------
const rejectModalOverlay = document.getElementById('reject-modal-overlay');
const rejectModalReason = document.getElementById('reject-modal-reason');

function openRejectModal(requestId) {
  pendingRejectRequestId = requestId;
  rejectModalReason.value = '';
  hideAlert(document.getElementById('reject-modal-alert'));
  rejectModalOverlay.hidden = false;
}

function closeRejectModal() {
  pendingRejectRequestId = null;
  rejectModalOverlay.hidden = true;
}

document.getElementById('reject-modal-cancel-btn')?.addEventListener('click', closeRejectModal);
rejectModalOverlay?.addEventListener('click', (e) => {
  if (e.target === rejectModalOverlay) closeRejectModal();
});

document.getElementById('reject-modal-confirm-btn')?.addEventListener('click', async () => {
  if (!pendingRejectRequestId) return;
  const confirmBtn = document.getElementById('reject-modal-confirm-btn');
  setButtonLoading(confirmBtn, true, 'Rejecting…');

  const { error } = await rejectLeaveRequest(pendingRejectRequestId, currentProfile.id, rejectModalReason.value);

  setButtonLoading(confirmBtn, false);

  if (error) {
    showAlert(document.getElementById('reject-modal-alert'), error.message, 'danger');
    return;
  }

  notifySuccess('Leave request rejected.');
  closeRejectModal();
  await loadAdminRequests();
});

// ---- Sidebar profile summary --------------------------------------------------------
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

// ---- Boot ------------------------------------------------------------------------
(async function boot() {
  const session = await initProtectedPage();
  if (!session) return; // already redirected to login

  const { data: profile, error } = await getCurrentProfile();
  if (error || !profile) {
    notifyError('Could not load your profile.');
    return;
  }

  currentProfile = profile;
  isAdmin = profile.role === 'admin';
  renderSidebarProfile(profile);

  await refreshEmployeeView();

  // Realtime: employee sees their own request updates without refreshing.
  subscribeToMyLeaveRequests(profile.id, () => {
    refreshEmployeeView();
  });

  if (isAdmin) {
    await populateEmployeeFilter();
    await loadAdminRequests();

    // Realtime: admin table stays current as requests come in / change.
    subscribeToAllLeaveRequests(() => {
      loadAdminRequests();
      notifyInfo('Leave requests updated.', 2500);
    });
  }
})();
