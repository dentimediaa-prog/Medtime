// =============================================================================
// roles.js
// Roles ALWAYS come from the `profiles` table — never hardcoded, never
// inferred from anything else. This module fetches the current user's
// profile once per session and caches it in memory.
// =============================================================================

import { supabase } from './supabaseClient.js';

let cachedProfile = null;
let inFlightRequest = null;

/**
 * Returns the current user's profile row ({ id, full_name, role, ... }),
 * fetching it once and caching it for the rest of the page's lifetime.
 */
export async function getCurrentProfile(forceRefresh = false) {
  if (cachedProfile && !forceRefresh) return { data: cachedProfile, error: null };
  if (inFlightRequest) return inFlightRequest;

  inFlightRequest = (async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      inFlightRequest = null;
      return { data: null, error: userError || { message: 'No authenticated user.' } };
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, department, job_title, phone, avatar_url, is_active, hire_date')
      .eq('id', userData.user.id)
      .single();

    inFlightRequest = null;

    if (error) return { data: null, error };

    cachedProfile = data;
    return { data, error: null };
  })();

  return inFlightRequest;
}

/**
 * Clears the cached profile. Call this on logout so a different user
 * signing in on the same page load never sees a stale role.
 */
export function clearRoleCache() {
  cachedProfile = null;
  inFlightRequest = null;
}

/**
 * Convenience boolean check.
 */
export async function isAdmin() {
  const { data } = await getCurrentProfile();
  return data?.role === 'admin';
}

/**
 * Route guard for admin-only pages. Call at the top of every admin page
 * AFTER session.initProtectedPage(). Redirects non-admins to the shared
 * dashboard immediately — employees must never see admin pages.
 *
 * @returns {Promise<object|null>} the profile if allowed, otherwise null
 */
export async function requireRole(role) {
  const { data: profile, error } = await getCurrentProfile();

  if (error || !profile) {
    window.location.replace('index.html');
    return null;
  }

  if (profile.role !== role) {
    window.location.replace('dashboard.html');
    return null;
  }

  return profile;
}
