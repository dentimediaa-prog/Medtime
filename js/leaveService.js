// =============================================================================
// leaveService.js
// All Supabase access for the `leave_requests` table lives here. Pages never
// query this table (or `settings`/`profiles`, for filter purposes) directly.
// =============================================================================

import { supabase } from './supabaseClient.js';

export const LEAVE_TYPES = ['vacation', 'sick', 'personal'];

function daysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.max(Math.round((end - start) / 86400000) + 1, 0);
}

/**
 * All of the current user's own leave requests, most recent first.
 */
export async function getMyLeaveRequests(userId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return { data, error };
}

/**
 * Remaining vacation leave balance for this calendar year.
 * entitlement comes from settings.annual_leave_days (admin-configurable);
 * used is the sum of approved 'vacation' requests starting this year.
 */
export async function getLeaveBalance(userId) {
  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('annual_leave_days')
    .eq('id', 1)
    .single();

  if (settingsError) return { data: null, error: settingsError };

  const year = new Date().getFullYear();

  const { data: approved, error: approvedError } = await supabase
    .from('leave_requests')
    .select('start_date, end_date')
    .eq('user_id', userId)
    .eq('leave_type', 'vacation')
    .eq('status', 'approved')
    .gte('start_date', `${year}-01-01`)
    .lte('start_date', `${year}-12-31`);

  if (approvedError) return { data: null, error: approvedError };

  const used = (approved || []).reduce((sum, r) => sum + daysInclusive(r.start_date, r.end_date), 0);
  const entitlement = Number(settings.annual_leave_days);
  const remaining = Math.max(entitlement - used, 0);

  return { data: { entitlement, used, remaining }, error: null };
}

/**
 * Submits a new leave request for the current user. Validates before
 * hitting the network so the caller gets a clean, friendly error.
 */
export async function submitLeaveRequest({ userId, leaveType, startDate, endDate, reason }) {
  if (!LEAVE_TYPES.includes(leaveType)) {
    return { data: null, error: { message: 'Choose a valid leave type.' } };
  }
  if (!startDate || !endDate) {
    return { data: null, error: { message: 'Choose a start and end date.' } };
  }
  if (new Date(endDate) < new Date(startDate)) {
    return { data: null, error: { message: 'End date must be on or after the start date.' } };
  }
  if (!reason || !reason.trim()) {
    return { data: null, error: { message: 'Enter a reason for your leave request.' } };
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      user_id: userId,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
      status: 'pending'
    })
    .select()
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

/**
 * Cancels (deletes) a request. RLS only allows this while the request
 * still belongs to the caller and is still pending.
 */
export async function cancelLeaveRequest(requestId) {
  const { error } = await supabase.from('leave_requests').delete().eq('id', requestId);
  if (error) return { data: null, error: { message: error.message } };
  return { data: true, error: null };
}

/**
 * Admin: all leave requests, optionally filtered, with the requesting
 * employee's and reviewer's names embedded.
 */
export async function getAllLeaveRequests({ status, employeeId } = {}) {
  let query = supabase
    .from('leave_requests')
    .select(
      '*, requester:profiles!leave_requests_user_id_fkey(full_name, email), reviewer:profiles!leave_requests_reviewed_by_fkey(full_name)'
    )
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (employeeId) query = query.eq('user_id', employeeId);

  const { data, error } = await query;
  return { data, error };
}

/**
 * Admin: employee list for the "filter by employee" dropdown.
 */
export async function getEmployeeOptions() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .order('full_name', { ascending: true });

  return { data, error };
}

export async function approveLeaveRequest(requestId, adminId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
    .select()
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

export async function rejectLeaveRequest(requestId, adminId, rejectionReason) {
  if (!rejectionReason || !rejectionReason.trim()) {
    return { data: null, error: { message: 'Enter a reason for rejecting this request.' } };
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status: 'rejected',
      rejection_reason: rejectionReason.trim(),
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString()
    })
    .eq('id', requestId)
    .select()
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

/**
 * Realtime: fires onChange whenever any of the current user's own leave
 * requests are inserted/updated/deleted (e.g. an admin approves it).
 * Returns an unsubscribe function.
 */
export function subscribeToMyLeaveRequests(userId, onChange) {
  const channel = supabase
    .channel(`leave-requests-user-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'leave_requests', filter: `user_id=eq.${userId}` },
      onChange
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/**
 * Realtime: fires onChange whenever ANY leave request changes, for the
 * admin management view. Returns an unsubscribe function.
 */
export function subscribeToAllLeaveRequests(onChange) {
  const channel = supabase
    .channel('leave-requests-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, onChange)
    .subscribe();

  return () => supabase.removeChannel(channel);
}
