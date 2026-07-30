// =============================================================================
// dashboard.page.js
// Bootstrap script for dashboard.html. Only talks to Supabase through
// session.js / roles.js — never calls the supabase client directly.
// =============================================================================

import { initProtectedPage, logout } from '../session.js';
import { getCurrentProfile } from '../roles.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifyError } from '../notifications.js';
import { showAlert } from '../ui.js';

// ---- Theme -----------------------------------------------------------------
initTheme();
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
  toggleTheme();
});

// ---- Mobile sidebar toggle ---------------------------------------------------
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const menuToggleBtn = document.getElementById('menu-toggle-btn');

function openSidebar() {
  sidebar?.classList.add('is-open');
  sidebarBackdrop?.classList.add('is-open');
}
function closeSidebar() {
  sidebar?.classList.remove('is-open');
  sidebarBackdrop?.classList.remove('is-open');
}
menuToggleBtn?.addEventListener('click', openSidebar);
sidebarBackdrop?.addEventListener('click', closeSidebar);

// ---- Logout -------------------------------------------------------------------
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await logout();
});

// ---- Live clock -----------------------------------------------------------------
function tickClock() {
  const now = new Date();
  const timeEl = document.getElementById('dashboard-clock-time');
  const dateEl = document.getElementById('dashboard-clock-date');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
}
tickClock();
setInterval(tickClock, 1000);

// ---- Role-based visibility --------------------------------------------------------
function applyRoleVisibility(role) {
  const isAdminUser = role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.hidden = !isAdminUser;
  });
  document.querySelectorAll('[data-employee-only]').forEach((el) => {
    el.hidden = isAdminUser;
  });
}

// ---- Populate profile fields from the real Supabase row -----------------------------
function getInitials(fullName, email) {
  const source = (fullName || '').trim();
  if (source) {
    const parts = source.split(/\s+/);
    const initials = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
    return initials.toUpperCase();
  }
  return (email || '?').slice(0, 2).toUpperCase();
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function firstName(fullName) {
  const trimmed = (fullName || '').trim();
  return trimmed ? trimmed.split(/\s+/)[0] : 'there';
}

function renderProfile(profile) {
  const initials = getInitials(profile.full_name, profile.email);

  const greetingEl = document.getElementById('dashboard-greeting');
  if (greetingEl) greetingEl.textContent = `Welcome back, ${firstName(profile.full_name)}`;

  const avatarInitialsEl = document.getElementById('profile-avatar-initials');
  if (avatarInitialsEl) avatarInitialsEl.textContent = initials;

  const sidebarAvatarEl = document.getElementById('sidebar-avatar-initials');
  if (sidebarAvatarEl) sidebarAvatarEl.textContent = initials;

  const sidebarNameEl = document.getElementById('sidebar-user-name');
  if (sidebarNameEl) sidebarNameEl.textContent = profile.full_name || profile.email;

  const sidebarRoleEl = document.getElementById('sidebar-user-role');
  if (sidebarRoleEl) sidebarRoleEl.textContent = profile.role;

  const fullNameEl = document.getElementById('profile-full-name');
  if (fullNameEl) fullNameEl.textContent = profile.full_name || profile.email;

  const roleBadgeEl = document.getElementById('profile-role-badge');
  if (roleBadgeEl) {
    roleBadgeEl.textContent = profile.role;
    roleBadgeEl.className = `badge ${profile.role === 'admin' ? 'badge-success' : 'badge-neutral'}`;
  }

  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.textContent = profile.email;

  const departmentEl = document.getElementById('profile-department');
  if (departmentEl) departmentEl.textContent = profile.department || 'Not set';

  const jobTitleEl = document.getElementById('profile-job-title');
  if (jobTitleEl) jobTitleEl.textContent = profile.job_title || 'Not set';

  const phoneEl = document.getElementById('profile-phone');
  if (phoneEl) phoneEl.textContent = profile.phone || 'Not set';

  const hireDateEl = document.getElementById('profile-hire-date');
  if (hireDateEl) hireDateEl.textContent = formatDate(profile.hire_date);

  applyRoleVisibility(profile.role);
}

// ---- Boot ------------------------------------------------------------------------
(async function boot() {
  const session = await initProtectedPage();
  if (!session) return; // initProtectedPage already redirected to login

  const { data: profile, error } = await getCurrentProfile();

  if (error || !profile) {
    notifyError('Could not load your profile.');
    showAlert(
      document.getElementById('profile-error-alert'),
      "We couldn't load your profile details. Try refreshing the page.",
      'danger'
    );
    return;
  }

  renderProfile(profile);
})();
