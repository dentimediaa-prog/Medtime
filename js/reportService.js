// =============================================================================
// reportService.js
// All Supabase access for the Reports module lives here. Pages never query
// `attendance`, `leave_requests`, `profiles`, or `settings` directly.
// Aggregation/grouping for each report type happens in reports.page.js from
// the raw rows returned here — no separate query per report.
// =============================================================================

import { supabase } from './supabaseClient.js';

/**
 * Employee + department options for the filter dropdowns.
 */
export async function getFilterOptions() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, department, role')
    .order('full_name', { ascending: true });

  if (error) return { data: null, error };

  const departments = Array.from(new Set((data || []).map((p) => p.department).filter(Boolean))).sort();

  return { data: { employees: data || [], departments }, error: null };
}

/**
 * Org settings needed for overtime / early-checkout thresholds.
 */
export async function getReportSettings() {
  const { data, error } = await supabase
    .from('settings')
    .select('work_hours_per_day, overtime_threshold')
    .eq('id', 1)
    .single();

  return { data, error };
}

/**
 * Raw attendance rows within [startDate, endDate], with the employee's
 * name/department/role embedded. Department/role filters are applied
 * client-side after the fetch (kept here so the page never touches
 * Supabase directly).
 */
export async function getAttendanceInRange({ startDate, endDate, employeeId, department, role }) {
  let query = supabase
    .from('attendance')
    .select('*, profiles!attendance_user_id_fkey(id, full_name, email, department, role), breaks(duration_minutes)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (employeeId) query = query.eq('user_id', employeeId);

  const { data, error } = await query;
  if (error) return { data: null, error };

  let rows = data || [];
  if (department) rows = rows.filter((r) => r.profiles?.department === department);
  if (role) rows = rows.filter((r) => r.profiles?.role === role);

  return { data: rows, error: null };
}

/**
 * Raw leave requests overlapping [startDate, endDate], with the employee's
 * name/department/role embedded.
 */
export async function getLeaveInRange({ startDate, endDate, employeeId, department, role }) {
  let query = supabase
    .from('leave_requests')
    .select('*, profiles!leave_requests_user_id_fkey(id, full_name, email, department, role)')
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .order('start_date', { ascending: true });

  if (employeeId) query = query.eq('user_id', employeeId);

  const { data, error } = await query;
  if (error) return { data: null, error };

  let rows = data || [];
  if (department) rows = rows.filter((r) => r.profiles?.department === department);
  if (role) rows = rows.filter((r) => r.profiles?.role === role);

  return { data: rows, error: null };
}

/**
 * Active employees who have neither an attendance record nor approved
 * leave covering the given single date.
 */
export async function getAbsentEmployees({ date, department, role }) {
  let empQuery = supabase.from('profiles').select('id, full_name, email, department, role').eq('is_active', true);
  if (department) empQuery = empQuery.eq('department', department);
  if (role) empQuery = empQuery.eq('role', role);

  const { data: employees, error: empError } = await empQuery;
  if (empError) return { data: null, error: empError };

  const { data: attendanceRows, error: attError } = await supabase
    .from('attendance')
    .select('user_id')
    .eq('date', date);
  if (attError) return { data: null, error: attError };

  const { data: leaveRows, error: leaveError } = await supabase
    .from('leave_requests')
    .select('user_id')
    .eq('status', 'approved')
    .lte('start_date', date)
    .gte('end_date', date);
  if (leaveError) return { data: null, error: leaveError };

  const presentIds = new Set((attendanceRows || []).map((r) => r.user_id));
  const onLeaveIds = new Set((leaveRows || []).map((r) => r.user_id));

  const absent = (employees || []).filter((e) => !presentIds.has(e.id) && !onLeaveIds.has(e.id));

  return { data: absent, error: null };
}
