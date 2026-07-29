// =============================================================================
// ui.js
// Small, framework-free DOM helpers reused across every page's *.page.js.
// =============================================================================

/**
 * Puts a button into a "loading" state: disables it, swaps its label for a
 * spinner + busy text, and remembers the original label to restore later.
 */
export function setButtonLoading(button, isLoading, busyText = 'Please wait…') {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span><span>${busyText}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.innerHTML = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }
}

/**
 * Shows a validation error under a form field. Expects the field wrapper
 * (element with class="field") to contain an element with class="field-error".
 */
export function showFieldError(fieldEl, message) {
  if (!fieldEl) return;
  fieldEl.classList.add('has-error');
  const errorEl = fieldEl.querySelector('.field-error');
  if (errorEl) errorEl.textContent = message;
}

export function clearFieldError(fieldEl) {
  if (!fieldEl) return;
  fieldEl.classList.remove('has-error');
  const errorEl = fieldEl.querySelector('.field-error');
  if (errorEl) errorEl.textContent = '';
}

export function clearAllFieldErrors(formEl) {
  if (!formEl) return;
  formEl.querySelectorAll('.field.has-error').forEach((el) => {
    el.classList.remove('has-error');
    const errorEl = el.querySelector('.field-error');
    if (errorEl) errorEl.textContent = '';
  });
}

/**
 * Shows/hides an inline alert banner (e.g. #login-alert) with a message.
 */
export function showAlert(alertEl, message, type = 'danger') {
  if (!alertEl) return;
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
  alertEl.hidden = false;
}

export function hideAlert(alertEl) {
  if (!alertEl) return;
  alertEl.hidden = true;
  alertEl.textContent = '';
}

/**
 * Basic email format check for instant client-side feedback
 * (the real validation always happens server-side too).
 */
export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
