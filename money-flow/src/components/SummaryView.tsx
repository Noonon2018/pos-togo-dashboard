import { useMemo, useState } from 'react';
import { CATEGORIES, categoryOf, type CategorizedTx, type CategoryOverrides } from '../lib/categories';
import { ALL, defaultPeriod, insights, monthlySeries, monthsIn, summarize, type CategoryTotal, type Insight } from '../lib/summary';
import type { Aliases } from '../lib/types';
import { money } from '../format';
import { useLang, useT } from '../i18n';

interface Props {
  txns: CategorizedTx[];
  aliases: Aliases;
  overrides: CategoryOverrides;
  onOverride: (name: string, categoryId: string | null) => void;
  onResetOverrides: () => void;
}

const MONEY_VARS = new Set(['amt', 'year', 'gap', 'from', 'to', 'a1', 'a2', 'avg']);

export default function SummaryView({ txns, aliases, overrides, onOverride, onResetOverrides }: Props) {
  const t = useT();
  const { lang } = useLang();
  const months = useMemo(() => monthsIn(txns), [txns]);
  const [period, setPeriod] = useState(() => defaultPeriod(txns));
  const p = period === ALL || months.includes(period) ? period : defaultPeriod(txns);
  const s = useMemo(() => summarize(txns, p), [txns, p]);
  const ins = useMemo(() => insights(txns, aliases, p), [txns, aliases, p]);
  const series = useMemo(() => monthlySeries(txns), [txns]);
  const [open, setOpen] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const catLabel = (id: string) => {
    const c = categoryOf(id);
    return `${c.icon} ${lang === 'th' ? c.th : c.en}`;
  };
  const monthLabel = (m: string) =>
    m === ALL ? t('allTime') : new Date(`${m}-15T00:00:00Z`).toLocaleDateString(lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

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
          <select value={p} onChange={(e) => setPeriod(e.target.value)}>
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
            <option value={ALL}>{t('allTime')}</option>
          </select>
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
          <CategoryList cats={s.spendCategories} catLabel={catLabel} open={open} setOpen={setOpen} highlight={highlight} hasPrev={!!s.prev} kind="spend" overrides={overrides} onOverride={onOverride} />
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
          <section className="card">
            <h3>{t('incomeTitle')}</h3>
            <CategoryList cats={s.incomeCategories} catLabel={catLabel} open={open} setOpen={setOpen} highlight={highlight} hasPrev={!!s.prev} kind="income" overrides={overrides} onOverride={onOverride} />
          </section>
          {series.length > 0 && (
            <section className="card">
              <h3>{t('trendTitle')}</h3>
              <TrendChart series={series} selected={p} onPick={setPeriod} monthLabel={monthLabel} />
            </section>
          )}
        </div>
      </div>
    </div>
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
}) {
  const t = useT();
  const { lang } = useLang();
  const { cats, catLabel, open, setOpen, highlight, hasPrev, kind, overrides, onOverride, noShare } = props;
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
              <span className="cat-name">{catLabel(c.id)}</span>
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
  monthLabel,
}: {
  series: { month: string; income: number; spending: number; invest: number }[];
  selected: string;
  onPick: (m: string) => void;
  monthLabel: (m: string) => string;
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
                {monthLabel(r.month).split(' ')[0].slice(0, 6)}
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
