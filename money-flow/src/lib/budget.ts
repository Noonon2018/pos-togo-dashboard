/**
 * Budgets per category and an emergency-fund goal. Pure functions, no storage.
 */

export type Budgets = Record<string, number>;

export interface Goal {
  /** target amount for the emergency fund, in dollars */
  target: number;
  /** how much is already saved (the user types this; the app can't see other accounts) */
  current: number;
}

export type BudgetState = 'ok' | 'near' | 'pace' | 'over';

export interface BudgetStatus {
  limit: number;
  spent: number;
  pct: number; // spent / limit
  /** expected spend at the end of the period at the current pace (only for an unfinished period) */
  projected: number | null;
  state: BudgetState;
  left: number;
}

/**
 * @param daysSoFar days of data in the period
 * @param fullDays  length of the period
 * Projection only kicks in after a week of data, so one big early payment doesn't scream "over".
 */
export function budgetStatus(spent: number, limit: number, daysSoFar: number, fullDays: number): BudgetStatus {
  const s = Math.max(0, spent);
  const ongoing = daysSoFar > 0 && daysSoFar < fullDays;
  const projected = ongoing && daysSoFar >= 7 ? Math.round((s / daysSoFar) * fullDays * 100) / 100 : null;
  let state: BudgetState = 'ok';
  if (s > limit) state = 'over';
  else if (projected !== null && projected > limit * 1.1) state = 'pace';
  else if (s >= limit * 0.8) state = 'near';
  return { limit, spent: s, pct: limit > 0 ? s / limit : 0, projected, state, left: Math.round((limit - s) * 100) / 100 };
}

/** Suggest a budget: a round number a bit under the average of complete periods (min $10). */
export function suggestBudget(history: number[]): number | null {
  const xs = history.filter((x) => x > 0);
  if (!xs.length) return null;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const step = avg >= 1000 ? 50 : avg >= 100 ? 10 : 5;
  return Math.max(10, Math.round((avg * 0.9) / step) * step);
}

export interface GoalProgress {
  pct: number;
  remaining: number;
  /** average left over per period (complete periods only) */
  monthlySaving: number | null;
  /** periods until the goal at that pace; null when not saving */
  monthsToGoal: number | null;
  reached: boolean;
}

export function goalProgress(goal: Goal, monthlyNets: number[]): GoalProgress {
  const remaining = Math.max(0, Math.round((goal.target - goal.current) * 100) / 100);
  const monthlySaving = monthlyNets.length ? Math.round((monthlyNets.reduce((a, b) => a + b, 0) / monthlyNets.length) * 100) / 100 : null;
  const reached = goal.target > 0 && goal.current >= goal.target;
  return {
    pct: goal.target > 0 ? Math.min(1, Math.max(0, goal.current / goal.target)) : 0,
    remaining,
    monthlySaving,
    monthsToGoal: reached ? 0 : monthlySaving && monthlySaving > 0 ? Math.ceil(remaining / monthlySaving) : null,
    reached,
  };
}

/** Common rule of thumb: 3–6 months of essential spending. We suggest 6 × average real spending. */
export function suggestEmergencyFund(monthlySpending: number[]): number | null {
  const xs = monthlySpending.filter((x) => x > 0);
  if (!xs.length) return null;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.round((avg * 6) / 100) * 100;
}
