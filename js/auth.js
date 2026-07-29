// =============================================================================
// auth.js
// Thin wrapper around Supabase Auth. No DOM code here — pages call these
// functions and handle their own UI. All functions return a consistent
// { data, error } shape so callers never need to guess.
// =============================================================================

import { supabase, isConfigured } from './supabaseClient.js';

const CONFIG_ERROR = {
  message: 'The app is not connected to Supabase yet. Add your project URL and anon key in js/supabaseClient.js.'
};

/**
 * Sign in an existing user with email + password.
 * @returns {Promise<{data: object|null, error: {message: string}|null}>}
 */
export async function signIn(email, password) {
  if (!isConfigured) return { data: null, error: CONFIG_ERROR };
  if (!email || !password) {
    return { data: null, error: { message: 'Enter both your email and password.' } };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    if (error) return { data: null, error: normalizeAuthError(error) };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: normalizeNetworkError(err) };
  }
}

/**
 * Create a new account. Role is never set by the client — the database
 * trigger `handle_new_user` always assigns 'employee' by default.
 */
export async function signUp(email, password, fullName) {
  if (!isConfigured) return { data: null, error: CONFIG_ERROR };
  if (!email || !password) {
    return { data: null, error: { message: 'Enter both an email and a password.' } };
  }
  if (password.length < 8) {
    return { data: null, error: { message: 'Password must be at least 8 characters.' } };
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName?.trim() || '' }
      }
    });
    if (error) return { data: null, error: normalizeAuthError(error) };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: normalizeNetworkError(err) };
  }
}

/**
 * Sign the current user out and clear the local session.
 */
export async function signOut() {
  if (!isConfigured) return { data: null, error: CONFIG_ERROR };
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return { data: null, error: normalizeAuthError(error) };
    return { data: true, error: null };
  } catch (err) {
    return { data: null, error: normalizeNetworkError(err) };
  }
}

/**
 * Send a password-reset email. redirectTo must point at reset-password.html
 * on wherever this app is hosted (GitHub Pages URL).
 */
export async function sendPasswordResetEmail(email) {
  if (!isConfigured) return { data: null, error: CONFIG_ERROR };
  if (!email) return { data: null, error: { message: 'Enter your email address.' } };

  try {
    const redirectTo = new URL('reset-password.html', window.location.href).toString();
    const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo
    });
    if (error) return { data: null, error: normalizeAuthError(error) };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: normalizeNetworkError(err) };
  }
}

/**
 * Complete a password reset. Only valid when called from the recovery
 * session established by clicking the emailed link.
 */
export async function updatePassword(newPassword) {
  if (!isConfigured) return { data: null, error: CONFIG_ERROR };
  if (!newPassword || newPassword.length < 8) {
    return { data: null, error: { message: 'Password must be at least 8 characters.' } };
  }

  try {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { data: null, error: normalizeAuthError(error) };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: normalizeNetworkError(err) };
  }
}

/**
 * Get the current session (or null) without triggering a network error
 * when there simply isn't one.
 */
export async function getSession() {
  if (!isConfigured) return { data: null, error: CONFIG_ERROR };
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { data: null, error: normalizeAuthError(error) };
    return { data: data.session, error: null };
  } catch (err) {
    return { data: null, error: normalizeNetworkError(err) };
  }
}

/**
 * Subscribe to auth state changes. Returns the subscription so the caller
 * can unsubscribe if needed.
 */
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return data.subscription;
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function normalizeAuthError(error) {
  const map = {
    'Invalid login credentials': 'Incorrect email or password.',
    'Email not confirmed': 'Please confirm your email address before logging in.',
    'User already registered': 'An account with this email already exists.'
  };
  return { message: map[error.message] || error.message || 'Something went wrong. Please try again.' };
}

function normalizeNetworkError(err) {
  if (err instanceof TypeError) {
    return { message: 'Network error. Check your internet connection and try again.' };
  }
  return { message: err?.message || 'An unexpected error occurred.' };
}
