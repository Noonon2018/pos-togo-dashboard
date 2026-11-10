import { useMemo, useState } from 'react';
import { CATEGORIES, categoryOf, type CategorizedTx, type CategoryOverrides } from '../lib/categories';
import { ALL, defaultPeriod, insights, monthlySeries, periodRange, periodsIn, summarize, type CategoryTotal, type Insight, type PeriodOptions } from '../lib/summary';
import { budgetStatus, goalProgress, suggestBudget, suggestEmergencyFund, type Budgets, type Goal } from '../lib/budget';
import type { Aliases } from '../lib/types';
import { money } from '../format';
import { useLang, useT } from '../i18n';

interface Props {
  txns: CategorizedTx[];
  aliases: Aliases;
  overrides: CategoryOverrides;
  onOverride: (name: string, categoryId: string | null) => void;
  onResetOverrides: () => void;
  cycleDay: number;
  cycleAuto: boolean;
  onCycleDay: (day: number) => void;
  dataFrom?: string;
  dataTo?: string;
  budgets: Budgets;
  onBudget: (categoryId: string, amount: number | null) => void;
  goal: Goal;
  onGoal: (g: Goal) => void;
}

const MONEY_VARS = new Set(['amt', 'year', 'gap', 'from', 'to', 'a1', 'a2', 'avg', 'spent', 'limit', 'left', 'projected']);

export default function SummaryView(props: Props) {
  const { txns, aliases, overrides, onOverride, onResetOverrides, cycleDay, cycleAuto, onCycleDay, dataFrom, dataTo, budgets, onBudget, goal, onGoal } = props;
  const t = useT();
  const { lang } = useLang();
  const opts: PeriodOptions = useMemo(() => ({ cycleDay, dataFrom, dataTo, budgets }), [cycleDay, dataFrom, dataTo, budgets]);
  const periods = useMemo(() => periodsIn(txns, cycleDay), [txns, cycleDay]);
  const [period, setPeriod] = useState(() => defaultPeriod(txns, opts));
  const [periodDay, setPeriodDay] = useState(cycleDay);
  // when the cycle day changes, the old period key means something else: go back to the default
  const p = periodDay === cycleDay && (period === ALL || periods.includes(period)) ? period : defaultPeriod(txns, opts);
  const pick = (k: string) => {
    setPeriod(k);
    setPeriodDay(cycleDay);
  };
  const s = useMemo(() => summarize(txns, p, opts), [txns, p, opts]);
  const ins = useMemo(() => insights(txns, aliases, p, opts), [txns, aliases, p, opts]);
  const series = useMemo(() => monthlySeries(txns, opts), [txns, opts]);
  const [open, setOpen] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  // per-category history over complete periods (for budget suggestions)
  const history = useMemo(() => {
    const h = new Map<string, number[]>();
    const complete = series.filter((r) => r.complete).map((r) => r.month);
    for (const k of complete) for (const c of summarize(txns, k, opts).spendCategories) h.set(c.id, [...(h.get(c.id) ?? []), c.total]);
    return { byCat: h, spending: series.filter((r) => r.complete).map((r) => r.spending), nets: series.filter((r) => r.complete).map((r) => r.net) };
  }, [series, txns, opts]);

  const locale = lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-US';
  const fmtDay = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const catLabel = (id: string) => {
    const c = categoryOf(id);
    return `${c.icon} ${lang === 'th' ? c.th : c.en}`;
  };
  const periodLabel = (k: string) => {
    if (k === ALL) return t('allTime');
    if (cycleDay === 1) return new Date(`${k}-15T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const r = periodRange(k, cycleDay);
    return `${fmtDay(r.from, false)} – ${fmtDay(r.to, true)}`;
  };
  const shortLabel = (k: string) =>
    cycleDay === 1
      ? new Date(`${k}-15T00:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
      : fmtDay(periodRange(k, cycleDay).from, false);

  const renderInsight = (i: Insight) => {
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(i.vars)) vars[k] = k === 'cat' ? catLabel(String(v)) : MONEY_VARS.has(k) && typeof v === 'number' ? money(v) : v;
    return t(i.key as Parameters<typeof t>[0], vars);
  };

  const focus = (i: Insight) => {
    if (!i.focus) return;
    if (i.focus.kind === 'category') {
      setOpen(i.focus.value);
      setHighlight(null);
    } else {
      const name = i.focus.value;
      const tx = txns.find((x) => x.name === name && x.amount < 0) ?? txns.find((x) => x.name === name);
      if (tx) setOpen(tx.category);
      setHighlight(name);
    }
    setTimeout(() => document.getElementById('cat-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const delta = (cur: number, prev: number | undefined) => {
    if (prev === undefined || prev === 0) return null;
    const pct = Math.round((cur / prev - 1) * 100);
    return pct === 0 ? null : pct;
  };

  const kpi = (label: string, value: number, cls: string, prev?: number, hint?: string, sub?: string, upIsBad = false) => {
    const d = delta(value, prev);
    return (
      <div className="kpi">
        <span className="kpi-label" title={hint}>
          {label}
        </span>
        <b className={cls}>{money(value)}</b>
        {sub && <span className="small muted">{sub}</span>}
        {prev !== undefined && s.prev && (
          <span className="small muted">
            {t('kpiPrev', { v: money(prev) })}
            {d !== null && <span className={(d > 0) === upIsBad ? 'out' : 'in'}> ({d > 0 ? '+' : ''}{d}%)</span>}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="summary">
      <div className="summary-head">
        <label className="period">
          {t('period')}
          <select id="period" value={p} onChange={(e) => pick(e.target.value)}>
            {[...periods].reverse().map((k) => (
              <option key={k} value={k}>
                {periodLabel(k)}
              </option>
            ))}
            <option value={ALL}>{t('allTime')}</option>
          </select>
        </label>
        <label className="cycle small">
          {t('cycleDay')}
          <select id="cycle-day" value={cycleDay} onChange={(e) => onCycleDay(Number(e.target.value))}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d === 1 ? t('cycleCalendar') : d}
              </option>
            ))}
          </select>
          {cycleAuto && cycleDay > 1 && <span className="muted">({t('cycleAutoHint')})</span>}
        </label>
        <span className="small muted">
          {p !== ALL && s.coverage.days < s.coverage.fullDays - 1 ? (
            <span className="warn">⚠ {t('coverage', { days: s.coverage.days, full: s.coverage.fullDays, from: s.coverage.from, to: s.coverage.to })}</span>
          ) : (
            t('coverageAll', { from: s.coverage.from, to: s.coverage.to, days: s.coverage.days })
          )}
        </span>
      </div>

      <div className="kpis-row">
        {kpi(t('kpiIncome'), s.income, 'in', s.prev?.income)}
        {kpi(t('kpiSpending'), s.spending, 'out', s.prev?.spending, t('kpiSpendingHint'), t('kpiSpendingHint'), true)}
        {kpi(t('kpiInvest'), s.invest, 'invest', s.prev?.invest)}
        {kpi(
          t('kpiNet'),
          s.net,
          s.net < 0 ? 'out' : 'in',
          undefined,
          undefined,
          s.net < 0 ? t('netNegative') : s.income > 0 ? t('savingsRate', { pct: Math.round((s.net / s.income) * 100) }) : undefined,
        )}
      </div>

      <section className="card">
        <h3>💡 {t('insightsTitle')}</h3>
        {ins.length === 0 ? (
          <p className="muted">{t('noInsights')}</p>
        ) : (
          <ul className="insights">
            {ins.map((i) => (
              <li key={i.id} className={`ins ${i.level} ${i.focus ? 'clickable' : ''}`} onClick={() => focus(i)}>
                <span className="ins-icon">{i.level === 'warn' ? '⚠️' : i.level === 'good' ? '✅' : 'ℹ️'}</span>
                <span>{renderInsight(i)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="summary-cols">
        <section className="card" id="cat-list">
          <h3>{t('spendTitle')}</h3>
          <p className="small muted">{t('summaryHint')}</p>
          <CategoryList cats={s.spendCategories} catLabel={catLabel} open={open} setOpen={setOpen} highlight={highlight} hasPrev={!!s.prev} kind="spend" overrides={overrides} onOverride={onOverride} budgets={budgets} />
          {s.investCategory && (
            <>
              <h3>{t('investTitle')}</h3>
              <CategoryList cats={[s.investCategory]} catLabel={catLabel} open={open} setOpen={setOpen} highlight={highlight} hasPrev={!!s.prev} kind="spend" overrides={overrides} onOverride={onOverride} noShare />
            </>
          )}
          {Object.keys(overrides).length > 0 && (
            <button className="link small" onClick={() => confirm(t('confirmResetCategories')) && onResetOverrides()}>
              {t('resetCategories')}
            </button>
          )}
        </section>
        <div>
          <BudgetCard
            budgets={budgets}
            onBudget={onBudget}
            spentOf={(id) => s.spendCategories.find((c) => c.id === id)?.total ?? 0}
            days={p === ALL ? 0 : s.coverage.days}
            fullDays={p === ALL ? 0 : s.coverage.fullDays}
            history={history.byCat}
            current={s.spendCategories}
            catLabel={catLabel}
            disabled={p === ALL}
          />
          <GoalCard goal={goal} onGoal={onGoal} nets={history.nets} spending={history.spending} />
          <section className="card">
            <h3>{t('incomeTitle')}</h3>
            <CategoryList cats={s.incomeCategories} catLabel={catLabel} open={open} setOpen={setOpen} highlight={highlight} hasPrev={!!s.prev} kind="income" overrides={overrides} onOverride={onOverride} />
          </section>
          {series.length > 0 && (
            <section className="card">
              <h3>{t('trendTitle')}</h3>
              <TrendChart series={series} selected={p} onPick={pick} label={shortLabel} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetCard(props: {
  budgets: Budgets;
  onBudget: (id: string, amount: number | null) => void;
  spentOf: (id: string) => number;
  days: number;
  fullDays: number;
  history: Map<string, number[]>;
  current: CategoryTotal[];
  catLabel: (id: string) => string;
  disabled: boolean;
}) {
  const t = useT();
  const { budgets, onBudget, spentOf, days, fullDays, history, current, catLabel, disabled } = props;
  const spendCats = CATEGORIES.filter((c) => c.kind === 'spend' || c.kind === 'cash');
  // offer the categories you actually spend on first
  const choices = [...spendCats].sort((a, b) => (spentOf(b.id) || 0) - (spentOf(a.id) || 0)).filter((c) => !(budgets[c.id] > 0));
  const [cat, setCat] = useState('');
  const [amount, setAmount] = useState('');
  const suggestion = cat ? suggestBudget(history.get(cat) ?? (current.find((c) => c.id === cat) ? [current.find((c) => c.id === cat)!.total] : [])) : null;
  const add = () => {
    const v = Number(amount || suggestion);
    if (cat && v > 0) onBudget(cat, Math.round(v * 100) / 100);
    setCat('');
    setAmount('');
  };
  const entries = Object.entries(budgets).filter(([, v]) => v > 0);
  return (
    <section className="card" id="budgets">
      <h3>{t('budgetTitle')}</h3>
      {entries.length === 0 && <p className="small muted">{t('budgetEmpty')}</p>}
      <ul className="budgets">
        {entries.map(([id, limit]) => {
          const st = budgetStatus(spentOf(id), limit, days, fullDays);
          const pct = Math.min(100, st.pct * 100);
          return (
            <li key={id} className={`budget ${disabled ? '' : st.state}`}>
              <div className="budget-top">
                <span>{catLabel(id)}</span>
                <span className="num small">{t('budgetUsed', { spent: money(st.spent), limit: money(limit) })}</span>
              </div>
              <div className="budget-bar" role="progressbar" aria-valuenow={Math.round(st.pct * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${pct}%` }} />
                {st.projected !== null && st.projected > st.spent && (
                  <i style={{ left: `${pct}%`, width: `${Math.max(0, Math.min(100, (st.projected / limit) * 100) - pct)}%` }} />
                )}
              </div>
              <div className="budget-foot small">
                <span className={st.state === 'over' ? 'out' : st.state === 'ok' ? 'muted' : 'warn'}>
                  {st.state === 'over' ? t('budgetOverBy', { v: money(-st.left) }) : t('budgetLeft', { v: money(st.left) })}
                  {st.projected !== null && st.state !== 'over' && <> · {t('budgetProjected', { v: money(st.projected) })}</>}
                </span>
                <button className="link small" onClick={() => onBudget(id, null)}>
                  {t('remove')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="budget-add">
        <select id="budget-cat" aria-label={t('budgetCat')} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{t('budgetCat')}…</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {catLabel(c.id)}
            </option>
          ))}
        </select>
        <input
          id="budget-amount"
          type="number"
          min={0}
          step={10}
          inputMode="decimal"
          aria-label={t('budgetAmount')}
          placeholder={suggestion ? t('suggested', { v: money(suggestion) }) : t('budgetAmount')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="primary" disabled={!cat || !(Number(amount) > 0 || (suggestion ?? 0) > 0)} onClick={add}>
          {t('addBudget')}
        </button>
      </div>
    </section>
  );
}

function GoalCard({ goal, onGoal, nets, spending }: { goal: Goal; onGoal: (g: Goal) => void; nets: number[]; spending: number[] }) {
  const t = useT();
  const g = goalProgress(goal, nets);
  const suggestion = suggestEmergencyFund(spending);
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <section className="card" id="goal">
      <h3>{t('goalTitle')}</h3>
      <div className="goal-inputs">
        <label className="field">
          <span>{t('goalTarget')}</span>
          <input id="goal-target" type="number" min={0} step={100} inputMode="decimal" value={goal.target || ''} placeholder={suggestion ? String(suggestion) : '10000'} onChange={(e) => onGoal({ ...goal, target: num(e.target.value) })} />
        </label>
        <label className="field">
          <span>{t('goalCurrent')}</span>
          <input id="goal-current" type="number" min={0} step={100} inputMode="decimal" value={goal.current || ''} placeholder="0" onChange={(e) => onGoal({ ...goal, current: num(e.target.value) })} />
        </label>
      </div>
      {suggestion !== null && goal.target !== suggestion && (
        <button className="link small" onClick={() => onGoal({ ...goal, target: suggestion })}>
          {t('goalSuggest', { v: money(suggestion) })}
        </button>
      )}
      {goal.target > 0 && (
        <>
          <div className="goal-bar" role="progressbar" aria-valuenow={Math.round(g.pct * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${g.pct * 100}%` }} />
          </div>
          <p className="small">
            {g.reached ? t('goalReached') : t('goalProgress', { pct: Math.round(g.pct * 100), v: money(g.remaining) })}
          </p>
          {!g.reached && (
            <p className={`small ${g.monthlySaving !== null && g.monthlySaving <= 0 ? 'warn' : 'muted'}`}>
              {g.monthlySaving === null
                ? t('goalNoData')
                : g.monthsToGoal !== null
                  ? t('goalEta', { v: money(g.monthlySaving), n: g.monthsToGoal })
                  : t('goalNotSaving', { v: money(g.monthlySaving) })}
            </p>
          )}
        </>
      )}
      <p className="small muted">{t('goalNote')}</p>
    </section>
  );
}

function CategoryList(props: {
  cats: CategoryTotal[];
  catLabel: (id: string) => string;
  open: string | null;
  setOpen: (id: string | null) => void;
  highlight: string | null;
  hasPrev: boolean;
  kind: 'spend' | 'income';
  overrides: CategoryOverrides;
  onOverride: (name: string, id: string | null) => void;
  noShare?: boolean;
  budgets?: Budgets;
}) {
  const t = useT();
  const { lang } = useLang();
  const { cats, catLabel, open, setOpen, highlight, hasPrev, kind, overrides, onOverride, noShare, budgets } = props;
  const max = Math.max(1, ...cats.map((c) => Math.abs(c.total)));
  const choices = CATEGORIES.filter((c) => (kind === 'income' ? c.kind === 'income' : c.kind !== 'income'));
  if (!cats.length) return <p className="muted">{t('nothing')}</p>;
  return (
    <ul className="cats">
      {cats.map((c) => {
        const cat = categoryOf(c.id);
        const d = hasPrev && c.prevTotal > 0 ? Math.round((c.total / c.prevTotal - 1) * 100) : null;
        const isOpen = open === c.id;
        return (
          <li key={c.id} className={isOpen ? 'open' : ''}>
            <button className="cat-row" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
              <span className="cat-name">
                {catLabel(c.id)}
                {budgets?.[c.id] ? <span className={`budget-chip ${c.total > budgets[c.id] ? 'over' : ''}`}>🎯 {money(budgets[c.id])}</span> : null}
              </span>
              <span className="cat-amt">
                {money(c.total)}
                {!noShare && <span className="small muted"> · {Math.round(c.share * 100)}%</span>}
                {d !== null && Math.abs(d) >= 5 && (
                  <span className={`small ${(d > 0) === (kind === 'spend') ? 'out' : 'in'}`}> {d > 0 ? '▲' : '▼'}{Math.abs(d)}%</span>
                )}
              </span>
              <span className="cat-bar">
                <span style={{ width: `${(100 * Math.abs(c.total)) / max}%`, background: cat.color }} />
              </span>
            </button>
            {isOpen && (
              <ul className="cat-items">
                {c.items.map((it) => (
                  <li key={it.name} className={highlight === it.name ? 'hl' : ''}>
                    <span className="it-name">
                      {it.name} <span className="muted small">{t('times', { n: it.count })}</span>
                    </span>
                    <span className="num">{money(it.total)}</span>
                    <select
                      aria-label={t('changeCategory')}
                      value={overrides[it.name] ?? ''}
                      onChange={(e) => onOverride(it.name, e.target.value || null)}
                    >
                      <option value="">{lang === 'th' ? '↻ อัตโนมัติ' : '↻ auto'}</option>
                      {choices.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.icon} {lang === 'th' ? x.th : x.en}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TrendChart({
  series,
  selected,
  onPick,
  label,
}: {
  series: { month: string; income: number; spending: number; invest: number; complete: boolean }[];
  selected: string;
  onPick: (m: string) => void;
  label: (m: string) => string;
}) {
  const t = useT();
  const rows = series.slice(-12);
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.spending + Math.max(0, r.invest)]));
  const W = 360;
  const H = 160;
  const slot = W / rows.length;
  const bw = Math.min(22, slot / 3);
  const y = (v: number) => H - 20 - (v / max) * (H - 30);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label={t('trendTitle')}>
        {rows.map((r, i) => {
          const x = i * slot + slot / 2;
          const inv = Math.max(0, r.invest);
          return (
            <g key={r.month} onClick={() => onPick(r.month)} className={`trend-m ${selected === r.month ? 'sel' : ''}`}>
              <rect x={i * slot + 2} y={0} width={slot - 4} height={H} className="trend-bg" />
              <rect x={x - bw - 1} y={y(r.income)} width={bw} height={H - 20 - y(r.income)} fill="#16a34a">
                <title>{`${t('kpiIncome')} ${money(r.income)}`}</title>
              </rect>
              <rect x={x + 1} y={y(r.spending)} width={bw} height={H - 20 - y(r.spending)} fill="#dc2626">
                <title>{`${t('kpiSpending')} ${money(r.spending)}`}</title>
              </rect>
              {inv > 0 && (
                <rect x={x + 1} y={y(r.spending + inv)} width={bw} height={y(r.spending) - y(r.spending + inv)} fill="#0f766e">
                  <title>{`${t('kpiInvest')} ${money(inv)}`}</title>
                </rect>
              )}
              <text x={x} y={H - 6} textAnchor="middle" className="trend-label">
                {label(r.month)}
                {!r.complete && '*'}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="trend-legend small">
        <span>
          <i style={{ background: '#16a34a' }} /> {t('kpiIncome')}
        </span>
        <span>
          <i style={{ background: '#dc2626' }} /> {t('kpiSpending')}
        </span>
        <span>
          <i style={{ background: '#0f766e' }} /> {t('kpiInvest')}
        </span>
      </div>
    </>
  );
}
