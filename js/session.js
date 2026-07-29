// =============================================================================
// session.js
// Every HTML page in this app follows the same contract:
//   <div id="app-loading">...</div>   -- visible by default
//   <div id="app" hidden>...</div>    -- hidden by default, revealed once ready
//
// Public pages (index.html, forgot-password.html, reset-password.html) call
// initPublicPage(). Every other page calls initProtectedPage().
// =============================================================================

import { supabase } from './supabaseClient.js';
import { getSession, onAuthStateChange, signOut } from './auth.js';
import { clearRoleCache } from './roles.js';

const REDIRECT_MESSAGE_KEY = 'attendance-saas:redirect-message';

/**
 * For public-only pages such as the login page. If a valid session already
 * exists, skip straight to the dashboard instead of showing the login form.
 */
export async function initPublicPage() {
  const { data: session } = await getSession();
  if (session) {
    window.location.replace('dashboard.html');
    return;
  }
  revealApp();
  watchForSignOut();
}

/**
 * For every protected page. Confirms a session exists, otherwise redirects
 * to the login page. Returns the active session so the caller can read
 * the user id without a second round trip.
 *
 * @returns {Promise<import('@supabase/supabase-js').Session|null>}
 */
export async function initProtectedPage() {
  const { data: session, error } = await getSession();

  if (error) {
    redirectToLogin('You were signed out. Please log in again.');
    return null;
  }

  if (!session) {
    redirectToLogin();
    return null;
  }

  revealApp();
  watchForSignOut();
  return session;
}

/**
 * Signs the user out and returns them to the login page.
 */
export async function logout() {
  clearRoleCache();
  await signOut();
  window.location.replace('index.html');
}

/**
 * Reads (and clears) a one-time message set by redirectToLogin, so the
 * login page can show "You were signed out" / "Session expired" etc.
 */
export function consumeRedirectMessage() {
  const message = sessionStorage.getItem(REDIRECT_MESSAGE_KEY);
  if (message) sessionStorage.removeItem(REDIRECT_MESSAGE_KEY);
  return message;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function redirectToLogin(message) {
  if (message) sessionStorage.setItem(REDIRECT_MESSAGE_KEY, message);
  window.location.replace('index.html');
}

function revealApp() {
  const loading = document.getElementById('app-loading');
  const app = document.getElementById('app');
  if (loading) loading.hidden = true;
  if (app) app.hidden = false;
}

let listenerAttached = false;

/**
 * Auto-logout: if Supabase reports the session ended (token expired,
 * signed out in another tab, etc.) bounce back to the login page.
 * Attached once per page load.
 */
function watchForSignOut() {
  if (listenerAttached) return;
  listenerAttached = true;

  onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      clearRoleCache();
      const isPublicPage = document.body?.dataset?.page === 'public';
      if (!isPublicPage) {
        redirectToLogin('Your session ended. Please log in again.');
      }
    }
  });

  // Also react to network coming back after being offline, in case the
  // token needed refreshing while disconnected.
  window.addEventListener('online', async () => {
    const { data: session } = await getSession();
    if (!session && document.body?.dataset?.page !== 'public') {
      redirectToLogin('Your session ended. Please log in again.');
    }
  });
}

export { supabase };
