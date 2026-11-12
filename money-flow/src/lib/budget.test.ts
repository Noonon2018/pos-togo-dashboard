import { budgetStatus, goalProgress, suggestBudget, suggestEmergencyFund } from './budget';

describe('budgetStatus', () => {
  it('finished period: ok / near / over', () => {
    expect(budgetStatus(100, 200, 31, 31)).toMatchObject({ state: 'ok', pct: 0.5, left: 100, projected: null });
    expect(budgetStatus(170, 200, 31, 31).state).toBe('near');
    expect(budgetStatus(250, 200, 31, 31)).toMatchObject({ state: 'over', left: -50 });
  });
  it('ongoing period projects the pace after a week', () => {
    // $120 in 10 days of a 30-day period -> ~$360 projected vs $200 budget
    expect(budgetStatus(120, 200, 10, 30)).toMatchObject({ state: 'pace', projected: 360 });
    // too early to project
    expect(budgetStatus(120, 200, 3, 30)).toMatchObject({ state: 'ok', projected: null });
    // on pace (within 10%)
    expect(budgetStatus(80, 200, 10, 30).state).toBe('pace'); // 240 > 220
    expect(budgetStatus(70, 200, 10, 30).state).toBe('ok'); // 210: within the 10% tolerance
    expect(budgetStatus(60, 200, 10, 30).state).toBe('ok');
  });
});

describe('suggestBudget', () => {
  it('rounds a bit under the average', () => {
    expect(suggestBudget([470.7, 520])).toBe(450); // avg 495 × 0.9 = 446 -> 450
    expect(suggestBudget([2300, 2500])).toBe(2150);
    expect(suggestBudget([12])).toBe(10);
    expect(suggestBudget([])).toBeNull();
  });
});

describe('goalProgress', () => {
  it('computes progress and months to goal', () => {
    expect(goalProgress({ target: 10000, current: 4000 }, [500, 700])).toEqual({
      pct: 0.4,
      remaining: 6000,
      monthlySaving: 600,
      monthsToGoal: 10,
      reached: false,
    });
  });
  it('no estimate when not saving', () => {
    expect(goalProgress({ target: 10000, current: 4000 }, [-369, 100]).monthsToGoal).toBeNull();
    expect(goalProgress({ target: 10000, current: 4000 }, []).monthlySaving).toBeNull();
  });
  it('reached', () => {
    expect(goalProgress({ target: 5000, current: 6000 }, [])).toMatchObject({ pct: 1, reached: true, monthsToGoal: 0, remaining: 0 });
  });
});

describe('suggestEmergencyFund', () => {
  it('is 6 months of average spending, rounded to $100', () => {
    expect(suggestEmergencyFund([2047, 2369])).toBe(13200);
    expect(suggestEmergencyFund([])).toBeNull();
  });
});
