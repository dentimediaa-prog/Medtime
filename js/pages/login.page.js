// =============================================================================
// login.page.js
// Bootstrap script for index.html. Handles: theme toggle, live clock,
// login / forgot-password / sign-up panel switching, and wiring each form
// to auth.js with proper loading/error states.
// =============================================================================

import { signIn, signUp, sendPasswordResetEmail } from '../auth.js';
import { initPublicPage, consumeRedirectMessage } from '../session.js';
import { initTheme, toggleTheme } from '../theme.js';
import { notifySuccess } from '../notifications.js';
import {
  setButtonLoading,
  showFieldError,
  clearAllFieldErrors,
  showAlert,
  hideAlert,
  isValidEmail
} from '../ui.js';

// ---- Theme --------------------------------------------------------------
initTheme();
document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
  toggleTheme();
});

// ---- Live clock -----------------------------------------------------------
function tickClock() {
  const now = new Date();
  const timeEl = document.getElementById('live-clock-time');
  const dateEl = document.getElementById('live-clock-date');
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

// ---- Panel switching --------------------------------------------------------
const panels = {
  login: document.getElementById('login-panel'),
  forgot: document.getElementById('forgot-panel'),
  signup: document.getElementById('signup-panel')
};

const headerTitle = document.getElementById('auth-header-title');
const headerSubtitle = document.getElementById('auth-header-subtitle');

const HEADER_COPY = {
  login: { title: 'Welcome back', subtitle: 'Log in to your TimeKeep account.' },
  forgot: { title: 'Reset your password', subtitle: "We'll email you a secure reset link." },
  signup: { title: 'Create your account', subtitle: 'Set up employee access to TimeKeep.' }
};

function showPanel(name) {
  Object.entries(panels).forEach(([key, el]) => {
    if (el) el.hidden = key !== name;
  });
  const copy = HEADER_COPY[name];
  if (copy) {
    if (headerTitle) headerTitle.textContent = copy.title;
    if (headerSubtitle) headerSubtitle.textContent = copy.subtitle;
  }
}

document.getElementById('forgot-password-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  showPanel('forgot');
});

document.getElementById('show-signup-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  showPanel('signup');
});

document.querySelectorAll('.back-to-login').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('login');
  });
});

// ---- Password visibility toggle --------------------------------------------
document.querySelectorAll('.toggle-password-visibility').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });
});

// ---- Login form --------------------------------------------------------------
const loginForm = document.getElementById('login-form');
loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAllFieldErrors(loginForm);
  hideAlert(document.getElementById('login-alert'));

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  let hasError = false;
  if (!isValidEmail(email)) {
    showFieldError(document.getElementById('login-email-field'), 'Enter a valid email address.');
    hasError = true;
  }
  if (!password) {
    showFieldError(document.getElementById('login-password-field'), 'Enter your password.');
    hasError = true;
  }
  if (hasError) return;

  const submitBtn = document.getElementById('login-submit');
  setButtonLoading(submitBtn, true, 'Logging in…');

  const { error } = await signIn(email, password);

  setButtonLoading(submitBtn, false);

  if (error) {
    showAlert(document.getElementById('login-alert'), error.message, 'danger');
    return;
  }

  notifySuccess('Logged in successfully.');
  window.location.replace('dashboard.html');
});

// ---- Forgot password form ------------------------------------------------------
const forgotForm = document.getElementById('forgot-form');
forgotForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAllFieldErrors(forgotForm);
  hideAlert(document.getElementById('forgot-alert'));

  const email = document.getElementById('forgot-email').value;
  if (!isValidEmail(email)) {
    showFieldError(document.getElementById('forgot-email-field'), 'Enter a valid email address.');
    return;
  }

  const submitBtn = document.getElementById('forgot-submit');
  setButtonLoading(submitBtn, true, 'Sending…');

  const { error } = await sendPasswordResetEmail(email);

  setButtonLoading(submitBtn, false);

  if (error) {
    showAlert(document.getElementById('forgot-alert'), error.message, 'danger');
    return;
  }

  showAlert(
    document.getElementById('forgot-alert'),
    'If an account exists for that email, a reset link is on its way.',
    'success'
  );
});

// ---- Sign-up form ------------------------------------------------------------------
const signupForm = document.getElementById('signup-form');
signupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAllFieldErrors(signupForm);
  hideAlert(document.getElementById('signup-alert'));

  const fullName = document.getElementById('signup-name').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;

  let hasError = false;
  if (!fullName.trim()) {
    showFieldError(document.getElementById('signup-name-field'), 'Enter your full name.');
    hasError = true;
  }
  if (!isValidEmail(email)) {
    showFieldError(document.getElementById('signup-email-field'), 'Enter a valid email address.');
    hasError = true;
  }
  if (password.length < 8) {
    showFieldError(document.getElementById('signup-password-field'), 'Use at least 8 characters.');
    hasError = true;
  }
  if (hasError) return;

  const submitBtn = document.getElementById('signup-submit');
  setButtonLoading(submitBtn, true, 'Creating account…');

  const { data, error } = await signUp(email, password, fullName);

  setButtonLoading(submitBtn, false);

  if (error) {
    showAlert(document.getElementById('signup-alert'), error.message, 'danger');
    return;
  }

  if (data?.session) {
    // Email confirmations disabled on this project -> already logged in.
    notifySuccess('Account created.');
    window.location.replace('dashboard.html');
    return;
  }

  showAlert(
    document.getElementById('signup-alert'),
    'Account created. Check your email to confirm it, then log in.',
    'success'
  );
  signupForm.reset();
});

// ---- Boot ------------------------------------------------------------------------
(async function boot() {
  const redirectMessage = consumeRedirectMessage();
  if (redirectMessage) {
    showAlert(document.getElementById('redirect-alert'), redirectMessage, 'info');
  }
  await initPublicPage();
})();
