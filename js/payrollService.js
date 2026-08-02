// =============================================================================
// payrollService.js
// All Supabase access for the Payroll module lives here. Pages never query
// `payroll_records`, `profiles` (rates), or `settings` directly.
// =============================================================================

import { supabase } from './supabaseClient.js';

const PAYROLL_SELECT = '*, profiles!payroll_records_user_id_fkey(full_name, email, department, role)';

/**
 * Payroll-relevant org settings: standard hours, overtime rules, default
 * tax/insurance rates.
 */
export async function getPayrollSettings() {
  const { data, error } = await supabase
    .from('settings')
    .select('work_hours_per_day, overtime_threshold, overtime_multiplier, default_tax_rate, default_insurance_rate')
    .eq('id', 1)
    .single();

  return { data, error };
}

/**
 * Active employees with their current hourly rate, for the rates panel.
 */
export async function getEmployeesWithRates() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, department, hourly_rate')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  return { data, error };
}

/**
 * Sets an employee's hourly rate (used as the basis for all salary math).
 */
export async function updateHourlyRate(userId, rate) {
  const numRate = Number(rate);
  if (Number.isNaN(numRate) || numRate < 0) {
    return { data: null, error: { message: 'Enter a valid hourly rate.' } };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ hourly_rate: numRate })
    .eq('id', userId)
    .select()
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

/**
 * Computes regular hours, overtime hours, and unexplained-absence days for
 * one employee within a period, from their real attendance + leave rows.
 */
async function computePeriodMetrics(userId, periodStart, periodEnd, settings) {
  const { data: attendanceRows, error: attError } = await supabase
    .from('attendance')
    .select('date, total_hours, clock_out')
    .eq('user_id', userId)
    .gte('date', periodStart)
    .lte('date', periodEnd);
  if (attError) return { data: null, error: attError };

  const { data: leaveRows, error: leaveError } = await supabase
    .from('leave_requests')
    .select('start_date, end_date')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .lte('start_date', periodEnd)
    .gte('end_date', periodStart);
  if (leaveError) return { data: null, error: leaveError };

  const overtimeThreshold = Number(settings.overtime_threshold) || 8;
  const standardDayHours = Number(settings.work_hours_per_day) || 8;

  const attendedDates = new Set();
  let regularHours = 0;
  let overtimeHours = 0;

  (attendanceRows || []).forEach((r) => {
    attendedDates.add(r.date);
    if (!r.clock_out) return;
    const hours = Number(r.total_hours || 0);
    regularHours += Math.min(hours, overtimeThreshold);
    overtimeHours += Math.max(hours - overtimeThreshold, 0);
  });

  const leaveDates = new Set();
  (leaveRows || []).forEach((r) => {
    const cursor = new Date(`${r.start_date}T00:00:00`);
    const end = new Date(`${r.end_date}T00:00:00`);
    let guard = 0;
    while (cursor <= end && guard < 366) {
      const iso = cursor.toLocaleDateString('en-CA');
      if (iso >= periodStart && iso <= periodEnd) leaveDates.add(iso);
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  });

  let absenceDays = 0;
  const cursor = new Date(`${periodStart}T00:00:00`);
  const periodEndDate = new Date(`${periodEnd}T00:00:00`);
  let guard = 0;
  while (cursor <= periodEndDate && guard < 366) {
    const iso = cursor.toLocaleDateString('en-CA');
    const dayOfWeek = cursor.getDay(); // 0 = Sun, 6 = Sat
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !attendedDates.has(iso) && !leaveDates.has(iso)) {
      absenceDays += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return {
    data: { regularHours, overtimeHours, absenceDays, standardDayHours },
    error: null
  };
}

/**
 * Generates (or regenerates) a single employee's payroll record for a
 * period. Preserves any manually-entered bonus/penalty/status from an
 * existing record for the same period; recomputes everything derived from
 * attendance/leave/rate.
 */
export async function generatePayrollForEmployee({ userId, periodStart, periodEnd }) {
  const [{ data: profile, error: profileError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from('profiles').select('hourly_rate').eq('id', userId).single(),
    getPayrollSettings()
  ]);
  if (profileError) return { data: null, error: profileError };
  if (settingsError) return { data: null, error: settingsError };

  const hourlyRate = Number(profile.hourly_rate) || 0;

  const { data: metrics, error: metricsError } = await computePeriodMetrics(userId, periodStart, periodEnd, settings);
  if (metricsError) return { data: null, error: metricsError };

  const { data: existing } = await supabase
    .from('payroll_records')
    .select('bonus, penalty, status')
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle();

  const bonus = Number(existing?.bonus ?? 0);
  const penalty = Number(existing?.penalty ?? 0);
  const status = existing?.status ?? 'draft';

  const basicSalary = metrics.regularHours * hourlyRate;
  const overtimePay = metrics.overtimeHours * hourlyRate * (Number(settings.overtime_multiplier) || 1.5);
  const leaveDeduction = metrics.absenceDays * metrics.standardDayHours * hourlyRate;

  const grossPay = basicSalary + overtimePay + bonus - leaveDeduction - penalty;
  const tax = grossPay > 0 ? (grossPay * (Number(settings.default_tax_rate) || 0)) / 100 : 0;
  const insurance = grossPay > 0 ? (grossPay * (Number(settings.default_insurance_rate) || 0)) / 100 : 0;
  const netPay = grossPay - tax - insurance;

  const { data: saved, error: saveError } = await supabase
    .from('payroll_records')
    .upsert(
      {
        user_id: userId,
        period_start: periodStart,
        period_end: periodEnd,
        total_hours: metrics.regularHours + metrics.overtimeHours,
        overtime_hours: metrics.overtimeHours,
        basic_salary: basicSalary,
        overtime_pay: overtimePay,
        leave_deduction: leaveDeduction,
        bonus,
        penalty,
        gross_pay: grossPay,
        tax,
        insurance,
        net_pay: netPay,
        status,
        generated_at: new Date().toISOString()
      },
      { onConflict: 'user_id,period_start,period_end' }
    )
    .select(PAYROLL_SELECT)
    .single();

  if (saveError) return { data: null, error: { message: saveError.message } };
  return { data: saved, error: null };
}

/**
 * Generates payroll for every active employee matching the given filters.
 * Runs sequentially (small teams; keeps things simple and predictable).
 */
export async function generatePayrollForFilters({ periodStart, periodEnd, employeeId, department }) {
  let query = supabase.from('profiles').select('id, full_name').eq('is_active', true);
  if (employeeId) query = query.eq('id', employeeId);
  if (department) query = query.eq('department', department);

  const { data: employees, error } = await query;
  if (error) return { data: null, error };

  const results = [];
  for (const emp of employees || []) {
    const { data, error: genError } = await generatePayrollForEmployee({ userId: emp.id, periodStart, periodEnd });
    results.push(genError ? { employee: emp, error: genError } : { employee: emp, data });
  }

  return { data: results, error: null };
}

/**
 * Payroll history, optionally filtered by employee, department, and period.
 */
export async function getPayrollHistory({ employeeId, department, periodStart, periodEnd } = {}) {
  let query = supabase.from('payroll_records').select(PAYROLL_SELECT).order('period_start', { ascending: false });

  if (employeeId) query = query.eq('user_id', employeeId);
  if (periodStart) query = query.gte('period_start', periodStart);
  if (periodEnd) query = query.lte('period_end', periodEnd);

  const { data, error } = await query;
  if (error) return { data: null, error };

  let rows = data || [];
  if (department) rows = rows.filter((r) => r.profiles?.department === department);

  return { data: rows, error: null };
}

/**
 * Manual adjustments to bonus/penalty/tax/insurance. Recomputes gross/net
 * from the record's already-stored basic/overtime/leave-deduction figures.
 */
export async function updatePayrollRecord(id, { bonus, penalty, tax, insurance }) {
  const { data: existing, error: fetchError } = await supabase
    .from('payroll_records')
    .select('basic_salary, overtime_pay, leave_deduction')
    .eq('id', id)
    .single();
  if (fetchError) return { data: null, error: { message: fetchError.message } };

  const grossPay =
    Number(existing.basic_salary) + Number(existing.overtime_pay) + Number(bonus) - Number(existing.leave_deduction) - Number(penalty);
  const netPay = grossPay - Number(tax) - Number(insurance);

  const { data, error } = await supabase
    .from('payroll_records')
    .update({
      bonus: Number(bonus),
      penalty: Number(penalty),
      tax: Number(tax),
      insurance: Number(insurance),
      gross_pay: grossPay,
      net_pay: netPay
    })
    .eq('id', id)
    .select(PAYROLL_SELECT)
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}

/**
 * Moves a payroll record through Draft -> Pending -> Paid.
 */
export async function updatePayrollStatus(id, status) {
  if (!['draft', 'pending', 'paid'].includes(status)) {
    return { data: null, error: { message: 'Invalid status.' } };
  }

  const { data, error } = await supabase
    .from('payroll_records')
    .update({ status })
    .eq('id', id)
    .select(PAYROLL_SELECT)
    .single();

  if (error) return { data: null, error: { message: error.message } };
  return { data, error: null };
}
