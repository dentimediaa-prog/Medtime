// =============================================================================
// attendance.page.js
// Bootstrap script for attendance.html. Talks to Supabase ONLY through
// attendanceService.js, roles.js, and session.js — no direct queries here.
// =============================================================================

import { initProtectedPage, logout } from '../session.js';
import { getCurrentProfile } from '../roles.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifyError, notifySuccess } from '../notifications.js';
import { setButtonLoading, showAlert, hideAlert } from '../ui.js';
import {
  getTodayAttendance,
  getAttendanceHistory,
  clockIn,
  clockOut,
  startBreak,
  endBreak
} from '../attendanceService.js';

// ---- Theme -----------------------------------------------------------------
initTheme();
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
  toggleTheme();
});

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

// ---- Role-based sidebar visibility --------------------------------------------
function applyRoleVisibility(role) {
  const isAdminUser = role === 'admin';
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.hidden = !isAdminUser;
  });
  document.querySelectorAll('[data-employee-only]').forEach((el) => {
    el.hidden = isAdminUser;
  });
}

// ---- Module state -----------------------------------------------------------
let currentUserId = null;
let currentAttendance = null; // today's attendance row (with .breaks[]), or null
let timerInterval = null;

// ---- Formatting helpers -------------------------------------------------------
function formatTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(safeSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(safeSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function statusBadgeInfo(state) {
  switch (state) {
    case 'not_clocked_in':
      return { text: 'Not clocked in', className: 'badge badge-neutral' };
    case 'clocked_in':
      return { text: 'Clocked in', className: 'badge badge-success' };
    case 'on_break':
      return { text: 'On break', className: 'badge badge-warning' };
    case 'clocked_out':
      return { text: 'Clocked out', className: 'badge badge-neutral' };
    default:
      return { text: 'Unknown', className: 'badge badge-neutral' };
  }
}

function getActiveBreak(attendance) {
  if (!attendance?.breaks?.length) return null;
  return attendance.breaks.find((b) => !b.break_end) || null;
}

function totalBreakMinutes(attendance) {
  if (!attendance?.breaks?.length) return 0;
  return attendance.breaks.reduce((sum, b) => sum + (Number(b.duration_minutes) || 0), 0);
}

function deriveState(attendance) {
  if (!attendance) return 'not_clocked_in';
  if (attendance.clock_out) return 'clocked_out';
  if (getActiveBreak(attendance)) return 'on_break';
  return 'clocked_in';
}

// ---- Rendering ----------------------------------------------------------------
function renderTodayCard() {
  const state = deriveState(currentAttendance);
  const badge = statusBadgeInfo(state);

  const badgeEl = document.getElementById('today-status-badge');
  if (badgeEl) {
    badgeEl.textContent = badge.text;
    badgeEl.className = badge.className;
  }

  document.getElementById('today-clock-in-time').textContent = formatTime(currentAttendance?.clock_in);
  document.getElementById('today-clock-out-time').textContent = formatTime(currentAttendance?.clock_out);

  const breakMinutes = totalBreakMinutes(currentAttendance);
  document.getElementById('today-break-minutes').textContent = currentAttendance
    ? `${Math.round(breakMinutes)} min`
    : '–';

  const totalHoursEl = document.getElementById('today-total-hours');
  if (state === 'clocked_out') {
    totalHoursEl.textContent = `${Number(currentAttendance.total_hours).toFixed(2)} hrs`;
  } else if (state === 'not_clocked_in') {
    totalHoursEl.textContent = '–';
  } else {
    totalHoursEl.textContent = 'In progress…';
  }

  // Buttons
  const clockInBtn = document.getElementById('clock-in-btn');
  const clockOutBtn = document.getElementById('clock-out-btn');
  const breakStartBtn = document.getElementById('break-start-btn');
  const breakEndBtn = document.getElementById('break-end-btn');

  clockInBtn.hidden = state !== 'not_clocked_in';
  clockOutBtn.hidden = state !== 'clocked_in';
  breakStartBtn.hidden = state !== 'clocked_in';
  breakEndBtn.hidden = state !== 'on_break';

  restartTimer(state);
}

function restartTimer(state) {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const timerEl = document.getElementById('today-timer');
  if (!timerEl) return;

  if (state === 'not_clocked_in') {
    timerEl.textContent = '00:00:00';
    timerEl.classList.remove('is-paused');
    return;
  }

  const clockInMs = new Date(currentAttendance.clock_in).getTime();

  const tick = () => {
    const nowMs = state === 'clocked_out' ? new Date(currentAttendance.clock_out).getTime() : Date.now();
    const activeBreak = getActiveBreak(currentAttendance);

    let elapsedSeconds = (nowMs - clockInMs) / 1000;
    elapsedSeconds -= totalBreakMinutes(currentAttendance) * 60;

    if (activeBreak && state !== 'clocked_out') {
      const activeBreakMs = Date.now() - new Date(activeBreak.break_start).getTime();
      elapsedSeconds -= activeBreakMs / 1000;
    }

    timerEl.textContent = formatDuration(elapsedSeconds);
    timerEl.classList.toggle('is-paused', state === 'on_break' || state === 'clocked_out');
  };

  tick();
  if (state === 'clocked_in' || state === 'on_break') {
    timerInterval = setInterval(tick, 1000);
  }
}

function renderHistory(records) {
  const tableWrap = document.getElementById('history-table-wrap');
  const emptyState = document.getElementById('history-empty');
  const tbody = document.getElementById('history-table-body');

  if (!records || records.length === 0) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  const statusBadgeClass = {
    present: 'badge-success',
    late: 'badge-warning',
    absent: 'badge-danger',
    on_leave: 'badge-neutral'
  };

  tbody.innerHTML = records
    .map((record) => {
      const breakMins = (record.breaks || []).reduce((sum, b) => sum + (Number(b.duration_minutes) || 0), 0);
      const totalHours = record.clock_out ? `${Number(record.total_hours).toFixed(2)} hrs` : 'In progress';
      const badgeClass = statusBadgeClass[record.status] || 'badge-neutral';
      return `
        <tr>
          <td>${escapeHtml(formatDate(record.date))}</td>
          <td class="mono">${escapeHtml(formatTime(record.clock_in))}</td>
          <td class="mono">${escapeHtml(formatTime(record.clock_out))}</td>
          <td>${Math.round(breakMins)} min</td>
          <td class="mono">${escapeHtml(totalHours)}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(record.status)}</span></td>
        </tr>`;
    })
    .join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

// ---- Data loading ---------------------------------------------------------------
async function loadAttendanceData() {
  const [{ data: today, error: todayError }, { data: history, error: historyError }] = await Promise.all([
    getTodayAttendance(currentUserId),
    getAttendanceHistory(currentUserId)
  ]);

  if (todayError) {
    showAlert(document.getElementById('attendance-alert'), "Couldn't load today's attendance.", 'danger');
    notifyError("Couldn't load today's attendance.");
  } else {
    hideAlert(document.getElementById('attendance-alert'));
  }

  currentAttendance = today;
  renderTodayCard();

  if (historyError) {
    notifyError("Couldn't load attendance history.");
  } else {
    renderHistory(history);
  }
}

// ---- Action handlers --------------------------------------------------------------
async function handleClockIn() {
  const btn = document.getElementById('clock-in-btn');
  setButtonLoading(btn, true, 'Clocking in…');
  const { error } = await clockIn(currentUserId);
  setButtonLoading(btn, false);

  if (error) {
    notifyError(error.message);
    return;
  }
  notifySuccess('Clocked in.');
  await loadAttendanceData();
}

async function handleClockOut() {
  if (!currentAttendance) return;
  const btn = document.getElementById('clock-out-btn');
  setButtonLoading(btn, true, 'Clocking out…');
  const { error } = await clockOut(currentAttendance.id);
  setButtonLoading(btn, false);

  if (error) {
    notifyError(error.message);
    return;
  }
  notifySuccess('Clocked out. Have a great rest of your day!');
  await loadAttendanceData();
}

async function handleBreakStart() {
  if (!currentAttendance) return;
  const btn = document.getElementById('break-start-btn');
  setButtonLoading(btn, true, 'Starting…');
  const { error } = await startBreak(currentAttendance.id, 'short');
  setButtonLoading(btn, false);

  if (error) {
    notifyError(error.message);
    return;
  }
  notifySuccess('Break started.');
  await loadAttendanceData();
}

async function handleBreakEnd() {
  const activeBreak = getActiveBreak(currentAttendance);
  if (!activeBreak) return;
  const btn = document.getElementById('break-end-btn');
  setButtonLoading(btn, true, 'Ending…');
  const { error } = await endBreak(activeBreak.id);
  setButtonLoading(btn, false);

  if (error) {
    notifyError(error.message);
    return;
  }
  notifySuccess('Break ended.');
  await loadAttendanceData();
}

document.getElementById('clock-in-btn')?.addEventListener('click', handleClockIn);
document.getElementById('clock-out-btn')?.addEventListener('click', handleClockOut);
document.getElementById('break-start-btn')?.addEventListener('click', handleBreakStart);
document.getElementById('break-end-btn')?.addEventListener('click', handleBreakEnd);

// ---- Sidebar profile summary (same contract as dashboard.page.js) -------------------
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

  currentUserId = profile.id;
  renderSidebarProfile(profile);
  await loadAttendanceData();
})();
