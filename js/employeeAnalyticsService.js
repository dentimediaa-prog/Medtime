// =============================================================================
// employeeAnalyticsService.js
// All Supabase access for the Employee Analytics page lives here. The page
// never queries `profiles`, `attendance`, `breaks`, `leave_requests`,
// `payroll_records`, or `settings` directly. Every chart/stat/table on the
// page is computed client-side from these same raw fetches — one query per
// table, no duplicated queries.
// =============================================================================

import { supabase } from './supabaseClient.js';

/**
 * The employee's own profile row.
 */
export async function getEmployeeProfile(employeeId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', employeeId)
    .single();

  return { data, error };
}

/**
 * Full attendance history for this employee, with break durations embedded.
 */
export async function getEmployeeAttendance(employeeId) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*, breaks(duration_minutes)')
    .eq('user_id', employeeId)
    .order('date', { ascending: false });

  return { data, error };
}

/**
 * Full leave request history for this employee.
 */
export async function getEmployeeLeave(employeeId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('user_id', employeeId)
    .order('start_date', { ascending: false });

  return { data, error };
}

/**
 * Full payroll history for this employee.
 */
export async function getEmployeePayroll(employeeId) {
  const { data, error } = await supabase
    .from('payroll_records')
    .select('*')
    .eq('user_id', employeeId)
    .order('period_start', { ascending: false });

  return { data, error };
}

/**
 * Org settings needed for overtime / early-checkout / standard-day math.
 */
export async function getAnalyticsSettings() {
  const { data, error } = await supabase
    .from('settings')
    .select('work_hours_per_day, overtime_threshold')
    .eq('id', 1)
    .single();

  return { data, error };
}
