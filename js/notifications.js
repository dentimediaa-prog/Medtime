// =============================================================================
// notifications.js
// Lightweight toast system. Expects a <div id="toast-region"></div> to exist
// somewhere on the page (added automatically if missing).
// =============================================================================

const ICONS = {
  success:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
  error:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  info:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

function getRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration ms before auto-dismiss (0 = persistent)
 */
export function notify(message, type = 'info', duration = 4000) {
  const region = getRegion();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span aria-hidden="true">${ICONS[type] || ICONS.info}</span><span>${escapeHtml(message)}</span>`;
  region.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.style.transition = 'opacity 200ms ease, transform 200ms ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(4px)';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  return toast;
}

export const notifySuccess = (msg, duration) => notify(msg, 'success', duration);
export const notifyError = (msg, duration) => notify(msg, 'error', duration);
export const notifyInfo = (msg, duration) => notify(msg, 'info', duration);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
