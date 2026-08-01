// =============================================================================
// employeeService.js
// All Supabase access for employee management lives here. Pages never query
// `profiles` (or call auth.signUp for account creation) directly.
// =============================================================================

import { supabase } from './supabaseClient.js';

/**
 * Paginated, searchable, filterable list of employees.
 * @returns {Promise<{data: object[]|null, count: number|null, error: object|null}>}
 */
export async function getEmployees({ search = '', role = '', status = '', page = 1, pageSize = 10 } = {}) {
  let query = supabase.from('profiles').select('*', { count: 'exact' });

  const trimmedSearch = search.trim();
  if (trimmedSearch) {
    const term = `%${trimmedSearch}%`;
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
  }
  if (role) query = query.eq('role', role);
  if (status === 'active') query = query.eq('is_active', true);
  if (status === 'inactive') query = query.eq('is_active', false);

  const from = (Math.max(page, 1) - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order('full_name', { ascending: true })
    .range(from, to);

  if (error) return { data: null, count: null, error };
  return { data, count, error: null };
}

/**
 * Creates a brand-new employee account: signs them up (which the
 * `handle_new_user` DB trigger turns into a `profiles` row), restores the
 * admin's own session (signUp can otherwise switch the active browser
 * session to the new user), then fills in the details the admin entered.
 */
export async function createEmployee({ email, password, fullName, role, department, jobTitle, phone, hireDate }) {
  if (!email || !email.trim()) return { data: null, error: { message: 'Enter an email address.' } };
  if (!password || password.length < 8) {
    return { data: null, error: { message: 'Temporary password must be at least 8 characters.' } };
  }
  if (!['admin', 'employee'].includes(role)) {
    return { data: null, error: { message: 'Choose a valid role.' } };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const adminSession = sessionData?.session || null;

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName?.trim() || '' } }
  });

  if (signUpError) {
    return { data: null, error: { message: normalizeSignUpError(signUpError) } };
  }

  // Restore the admin's session regardless of what signUp did to it.
  if (adminSession) {
    await supabase.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token
    });
  }

  const newUserId = signUpData.user?.id;
  if (!newUserId) {
    return { data: null, error: { message: 'The account was created, but no user id was returned.' } };
  }

  const { data: profile, error: updateError } = await supabase
    .from('profiles')
    .update({
      role,
      department: department || null,
      job_title: jobTitle || null,
      phone: phone || null,
      hire_date: hireDate || null
    })
    .eq('id', newUserId)
    .select()
    .single();

  if (updateError) {
    return {
      data: null,
      error: { message: `The account was created, but saving the remaining details failed: ${updateError.message}` }
    };
  }

  return { data: profile, error: null };
}

/**
 * Updates an existing employee's profile fields (never email — changing the
 * login email is out of scope for a simple profile edit).
 */
export async function updateEmployee(id, fields) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: fields.fullName ?? undefined,
      role: fields.role ?? undefined,
      department: fields.department ?? null,
      job_title: fields.jobTitle ?? null,
      phone: fields.phone ?? null,
      hire_date: fields.hireDate ?? null
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

/**
 * Soft delete: marks the profile inactive without removing any data.
 */
export async function deactivateEmployee(id) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

/**
 * Reverses a soft delete.
 */
export async function reactivateEmployee(id) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_active: true })
    .eq('id', id)
    .select()
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

// -----------------------------------------------------------------------------
function normalizeSignUpError(error) {
  if (error.message === 'User already registered') {
    return 'An account with this email already exists.';
  }
  return error.message || 'Something went wrong creating the account.';
}
