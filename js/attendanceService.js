// =============================================================================
// attendanceService.js
// All Supabase access for the `attendance` and `breaks` tables lives here.
// Pages never query these tables directly — they only call these functions.
// =============================================================================

import { supabase } from './supabaseClient.js';

/**
 * Returns today's local date as 'YYYY-MM-DD', matching the `attendance.date`
 * column. Uses the browser's local timezone, not UTC, so "today" lines up
 * with what the user actually sees on their clock.
 */
export function todayDateString() {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * Fetches today's attendance row for a user, together with its breaks.
 * Returns { data: null, error: null } if the user hasn't clocked in today.
 */
export async function getTodayAttendance(userId) {
  const dateStr = todayDateString();

  const { data: attendance, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('user_id', userId)
    .eq('date', dateStr)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!attendance) return { data: null, error: null };

  const { data: breaks, error: breaksError } = await supabase
    .from('breaks')
    .select('*')
    .eq('attendance_id', attendance.id)
    .order('break_start', { ascending: true });

  if (breaksError) return { data: { ...attendance, breaks: [] }, error: breaksError };

  return { data: { ...attendance, breaks: breaks || [] }, error: null };
}

/**
 * Clocks the user in for today. Fails with a friendly message if they've
 * already clocked in today (unique constraint on user_id + date).
 */
export async function clockIn(userId) {
  const { data, error } = await supabase
    .from('attendance')
    .insert({
      user_id: userId,
      date: todayDateString(),
      clock_in: new Date().toISOString(),
      status: 'present'
    })
    .select()
    .single();

  if (error) return { data: null, error: normalizeError(error, 'clockIn') };
  return { data, error: null };
}

/**
 * Clocks out an existing attendance row. total_hours is computed
 * server-side by the `compute_attendance_hours` trigger.
 */
export async function clockOut(attendanceId) {
  const { data, error } = await supabase
    .from('attendance')
    .update({ clock_out: new Date().toISOString() })
    .eq('id', attendanceId)
    .select()
    .single();

  if (error) return { data: null, error: normalizeError(error, 'clockOut') };
  return { data, error: null };
}

/**
 * Starts a break tied to today's attendance row.
 */
export async function startBreak(attendanceId, breakType = 'short') {
  const { data, error } = await supabase
    .from('breaks')
    .insert({
      attendance_id: attendanceId,
      break_start: new Date().toISOString(),
      break_type: breakType
    })
    .select()
    .single();

  if (error) return { data: null, error: normalizeError(error, 'startBreak') };
  return { data, error: null };
}

/**
 * Ends a break. duration_minutes is computed server-side by the
 * `compute_break_duration` trigger.
 */
export async function endBreak(breakId) {
  const { data, error } = await supabase
    .from('breaks')
    .update({ break_end: new Date().toISOString() })
    .eq('id', breakId)
    .select()
    .single();

  if (error) return { data: null, error: normalizeError(error, 'endBreak') };
  return { data, error: null };
}

/**
 * Fetches recent attendance history for a user, most recent first, with
 * each row's total break minutes embedded via the breaks relationship.
 */
export async function getAttendanceHistory(userId, limit = 30) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*, breaks(duration_minutes)')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit);

  if (error) return { data: null, error };
  return { data, error: null };
}

// -----------------------------------------------------------------------------
function normalizeError(error, action) {
  if (error.code === '23505') {
    if (action === 'clockIn') {
      return { message: "You've already clocked in today." };
    }
  }
  return { message: error.message || 'Something went wrong. Please try again.' };
}
