// =============================================================================
// employees.page.js
// Bootstrap script for employees.html. Admin-only page. Talks to Supabase
// ONLY through employeeService.js, roles.js, and session.js.
// =============================================================================

import { initProtectedPage, logout } from '../session.js';
import { requireRole } from '../roles.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifyError, notifySuccess } from '../notifications.js';
import { setButtonLoading, showAlert, hideAlert, clearAllFieldErrors, showFieldError } from '../ui.js';
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  reactivateEmployee
} from '../employeeService.js';

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

// ---- Module state -----------------------------------------------------------
let currentProfile = null;
let currentPage = 1;
let totalCount = 0;
let searchDebounceHandle = null;
let modalMode = 'add'; // 'add' | 'edit'
let editingEmployeeId = null;

// ---- Helpers ------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '–';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(fullName, email) {
  const source = (fullName || '').trim();
  if (source) {
    const parts = source.split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
}

// ---- Sidebar profile summary --------------------------------------------------------
function renderSidebarProfile(profile) {
  document.getElementById('sidebar-avatar-initials').textContent = getInitials(profile.full_name, profile.email);
  document.getElementById('sidebar-user-name').textContent = profile.full_name || profile.email;
  document.getElementById('sidebar-user-role').textContent = profile.role;
  applyRoleVisibility(profile.role);
}

// ---- Table rendering ------------------------------------------------------------
function renderTable(employees) {
  const tableWrap = document.getElementById('employees-table-wrap');
  const emptyState = document.getElementById('employees-empty');
  const tbody = document.getElementById('employees-table-body');

  if (!employees || employees.length === 0) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  tbody.innerHTML = employees
    .map((emp) => {
      const roleBadgeClass = emp.role === 'admin' ? 'badge-success' : 'badge-neutral';
      const statusBadgeClass = emp.is_active ? 'badge-success' : 'badge-danger';
      const statusText = emp.is_active ? 'Active' : 'Inactive';
      const isSelf = emp.id === currentProfile.id;
      const toggleLabel = emp.is_active ? 'Deactivate' : 'Reactivate';
      const toggleClass = emp.is_active ? 'btn-danger' : 'btn-secondary';

      return `
        <tr>
          <td>
            <div class="employee-name-cell">
              <div class="avatar">${escapeHtml(getInitials(emp.full_name, emp.email))}</div>
              <div class="employee-name-text">
                <div class="full-name">${escapeHtml(emp.full_name || emp.email)}</div>
                <div class="email">${escapeHtml(emp.email)}</div>
              </div>
            </div>
          </td>
          <td><span class="badge ${roleBadgeClass}">${escapeHtml(emp.role)}</span></td>
          <td>${escapeHtml(emp.department || '–')}</td>
          <td><span class="badge ${statusBadgeClass}">${statusText}</span></td>
          <td>
            <div class="employees-actions-cell">
              <button class="btn btn-ghost btn-sm" data-view-id="${emp.id}">View</button>
              <button class="btn btn-secondary btn-sm" data-edit-id="${emp.id}">Edit</button>
              <button class="btn btn-sm ${toggleClass}" data-toggle-id="${emp.id}" data-toggle-active="${emp.is_active}" ${isSelf ? 'disabled title="You can\'t deactivate your own account."' : ''}>${toggleLabel}</button>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  tbody.querySelectorAll('[data-view-id]').forEach((btn) => {
    btn.addEventListener('click', () => openViewModal(employees.find((e) => e.id === btn.dataset.viewId)));
  });
  tbody.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(employees.find((e) => e.id === btn.dataset.editId)));
  });
  tbody.querySelectorAll('[data-toggle-id]').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => handleToggleActive(btn.dataset.toggleId, btn.dataset.toggleActive === 'true', btn));
  });
}

function renderPagination() {
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  document.getElementById('employees-pagination-info').textContent =
    totalCount === 0 ? 'No employees' : `Page ${currentPage} of ${totalPages} · ${totalCount} employee${totalCount === 1 ? '' : 's'}`;

  document.getElementById('employees-prev-btn').disabled = currentPage <= 1;
  document.getElementById('employees-next-btn').disabled = currentPage >= totalPages;
}

// ---- Data loading ---------------------------------------------------------------
async function loadEmployees() {
  const search = document.getElementById('employees-search-input').value;
  const role = document.getElementById('employees-role-filter').value;
  const status = document.getElementById('employees-status-filter').value;

  const { data, count, error } = await getEmployees({ search, role, status, page: currentPage, pageSize: PAGE_SIZE });

  if (error) {
    showAlert(document.getElementById('employees-alert'), "Couldn't load employees.", 'danger');
    notifyError("Couldn't load employees.");
    return;
  }

  hideAlert(document.getElementById('employees-alert'));
  totalCount = count || 0;
  renderTable(data);
  renderPagination();
}

// ---- Toolbar wiring ---------------------------------------------------------------
document.getElementById('employees-search-input')?.addEventListener('input', () => {
  clearTimeout(searchDebounceHandle);
  searchDebounceHandle = setTimeout(() => {
    currentPage = 1;
    loadEmployees();
  }, 300);
});

document.getElementById('employees-role-filter')?.addEventListener('change', () => {
  currentPage = 1;
  loadEmployees();
});
document.getElementById('employees-status-filter')?.addEventListener('change', () => {
  currentPage = 1;
  loadEmployees();
});

document.getElementById('employees-prev-btn')?.addEventListener('click', () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadEmployees();
});
document.getElementById('employees-next-btn')?.addEventListener('click', () => {
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  if (currentPage >= totalPages) return;
  currentPage += 1;
  loadEmployees();
});

// ---- View modal -------------------------------------------------------------------
const viewModalOverlay = document.getElementById('view-modal-overlay');

function openViewModal(emp) {
  if (!emp) return;
  document.getElementById('view-fullname').textContent = emp.full_name || '–';
  document.getElementById('view-email').textContent = emp.email;
  document.getElementById('view-role').textContent = emp.role;
  document.getElementById('view-department').textContent = emp.department || '–';
  document.getElementById('view-jobtitle').textContent = emp.job_title || '–';
  document.getElementById('view-phone').textContent = emp.phone || '–';
  document.getElementById('view-hiredate').textContent = formatDate(emp.hire_date);
  document.getElementById('view-status').textContent = emp.is_active ? 'Active' : 'Inactive';
  viewModalOverlay.hidden = false;
}
document.getElementById('view-modal-close-btn')?.addEventListener('click', () => {
  viewModalOverlay.hidden = true;
});
viewModalOverlay?.addEventListener('click', (e) => {
  if (e.target === viewModalOverlay) viewModalOverlay.hidden = true;
});

// ---- Add / Edit modal ---------------------------------------------------------------
const employeeModalOverlay = document.getElementById('employee-modal-overlay');
const employeeForm = document.getElementById('employee-form');

function resetEmployeeForm() {
  employeeForm.reset();
  clearAllFieldErrors(employeeForm);
  hideAlert(document.getElementById('employee-modal-alert'));
}

function openAddModal() {
  modalMode = 'add';
  editingEmployeeId = null;
  resetEmployeeForm();

  document.getElementById('employee-modal-title').textContent = 'Add employee';
  document.getElementById('employee-email').disabled = false;
  document.getElementById('employee-email-field').hidden = false;
  document.getElementById('employee-password-field').hidden = false;
  document.getElementById('employee-modal-submit-btn').textContent = 'Create employee';

  employeeModalOverlay.hidden = false;
}

function openEditModal(emp) {
  if (!emp) return;
  modalMode = 'edit';
  editingEmployeeId = emp.id;
  resetEmployeeForm();

  document.getElementById('employee-modal-title').textContent = 'Edit employee';
  document.getElementById('employee-email').value = emp.email;
  document.getElementById('employee-email').disabled = true;
  document.getElementById('employee-password-field').hidden = true;
  document.getElementById('employee-fullname').value = emp.full_name || '';
  document.getElementById('employee-role-select').value = emp.role;
  document.getElementById('employee-department').value = emp.department || '';
  document.getElementById('employee-jobtitle').value = emp.job_title || '';
  document.getElementById('employee-phone').value = emp.phone || '';
  document.getElementById('employee-hiredate').value = emp.hire_date || '';
  document.getElementById('employee-modal-submit-btn').textContent = 'Save changes';

  employeeModalOverlay.hidden = false;
}

function closeEmployeeModal() {
  employeeModalOverlay.hidden = true;
  editingEmployeeId = null;
}

document.getElementById('employees-add-btn')?.addEventListener('click', openAddModal);
document.getElementById('employee-modal-cancel-btn')?.addEventListener('click', closeEmployeeModal);
employeeModalOverlay?.addEventListener('click', (e) => {
  if (e.target === employeeModalOverlay) closeEmployeeModal();
});

document.getElementById('employee-modal-submit-btn')?.addEventListener('click', async () => {
  clearAllFieldErrors(employeeForm);
  hideAlert(document.getElementById('employee-modal-alert'));

  const fullName = document.getElementById('employee-fullname').value;
  const role = document.getElementById('employee-role-select').value;
  const department = document.getElementById('employee-department').value;
  const jobTitle = document.getElementById('employee-jobtitle').value;
  const phone = document.getElementById('employee-phone').value;
  const hireDate = document.getElementById('employee-hiredate').value;

  let hasError = false;
  if (!fullName.trim()) {
    showFieldError(document.getElementById('employee-fullname-field'), 'Enter a full name.');
    hasError = true;
  }

  if (modalMode === 'add') {
    const email = document.getElementById('employee-email').value;
    const password = document.getElementById('employee-password').value;
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showFieldError(document.getElementById('employee-email-field'), 'Enter a valid email address.');
      hasError = true;
    }
    if (!password || password.length < 8) {
      showFieldError(document.getElementById('employee-password-field'), 'Use at least 8 characters.');
      hasError = true;
    }
    if (hasError) return;

    const submitBtn = document.getElementById('employee-modal-submit-btn');
    setButtonLoading(submitBtn, true, 'Creating…');

    const { error } = await createEmployee({ email, password, fullName, role, department, jobTitle, phone, hireDate });

    setButtonLoading(submitBtn, false);

    if (error) {
      showAlert(document.getElementById('employee-modal-alert'), error.message, 'danger');
      return;
    }

    notifySuccess('Employee created.');
    closeEmployeeModal();
    currentPage = 1;
    await loadEmployees();
  } else {
    if (hasError) return;

    const submitBtn = document.getElementById('employee-modal-submit-btn');
    setButtonLoading(submitBtn, true, 'Saving…');

    const { error } = await updateEmployee(editingEmployeeId, { fullName, role, department, jobTitle, phone, hireDate });

    setButtonLoading(submitBtn, false);

    if (error) {
      showAlert(document.getElementById('employee-modal-alert'), error.message, 'danger');
      return;
    }

    notifySuccess('Employee updated.');
    closeEmployeeModal();
    await loadEmployees();
  }
});

// ---- Deactivate / Reactivate --------------------------------------------------------
async function handleToggleActive(id, isCurrentlyActive, btn) {
  setButtonLoading(btn, true, '…');
  const { error } = isCurrentlyActive ? await deactivateEmployee(id) : await reactivateEmployee(id);
  setButtonLoading(btn, false);

  if (error) {
    notifyError(error.message);
    return;
  }
  notifySuccess(isCurrentlyActive ? 'Employee deactivated.' : 'Employee reactivated.');
  await loadEmployees();
}

// ---- Boot ------------------------------------------------------------------------
(async function boot() {
  const session = await initProtectedPage();
  if (!session) return; // already redirected to login

  const profile = await requireRole('admin');
  if (!profile) return; // requireRole already redirected non-admins away

  currentProfile = profile;
  renderSidebarProfile(profile);

  await loadEmployees();
})();
