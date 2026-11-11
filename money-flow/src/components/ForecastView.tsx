import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../i18n';
import { defaultSettings, simulate, type CashEvent, type Run, type Settings, type SimInput } from '../lib/forecast';

/** Cash forecast from a simulation-input CSV: when would the bank balance go below zero? */

const TEXT = {
  th: {
    title: 'พยากรณ์เงินสด',
    from: 'จากไฟล์',
    asOf: 'ข้อมูล ณ',
    close: 'ปิดหน้านี้',
    unknownTitle: 'ข้อมูลที่ไฟล์ยังไม่มี',
    unknownBody: 'ค่าแรงและค่าวัตถุดิบไม่มีในไฟล์ จึงใช้ % ของยอดขายในช่อง "สมมติฐาน" แทน ผลจะแม่นแค่ไหนขึ้นกับตัวเลขนี้ ใส่ตัวเลขจริงของร้านเมื่อรู้',
    bad: 'ขายแย่',
    normal: 'ขายปกติ',
    good: 'ขายดี',
    perDay: 'ยอดขาย Toast ต่อวัน',
    lowest: 'ต่ำสุด',
    neg: 'ติดลบวันที่',
    ok: 'ไม่ติดลบใน {n} วัน',
    end: 'สิ้นสุด',
    chart: 'เงินในบัญชี …วันต่อวัน',
    zero: '$0',
    assumptions: 'สมมติฐาน (แก้ได้)',
    horizon: 'ดูล่วงหน้า',
    days: 'วัน',
    food: 'ค่าวัตถุดิบ % ของยอดขาย',
    payroll: 'ค่าแรง % ของยอดขาย',
    payday: 'วันจ่ายค่าแรง',
    weekdays: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'],
    assumed: 'สมมติ',
    uber: 'นับเงิน Uber ที่ถูก hold',
    uberOn: 'เข้าวันที่',
    card: 'บัตรเครดิต',
    cardMin: 'จ่ายขั้นต่ำ',
    cardFull: 'จ่ายเต็มยอด',
    payWhat: 'จ่ายเมื่อไร (ลบวันที่ = ยังไม่จ่ายในช่วงนี้)',
    item: 'รายการ',
    amount: 'ยอด',
    date: 'วันที่',
    debt: 'หนี้ค้าง',
    monthly: 'บิลรายเดือน',
    dueDay: 'ครบทุกวันที่',
    daily: 'รายวัน',
    open: 'เปิด',
    inn: 'เข้า',
    out: 'ออก',
    bal: 'คงเหลือ',
    what: 'มีอะไร',
    reset: 'ค่าเริ่มต้น',
    note:
      'วิธีคิด: ยอดขาย Toast เข้าบัญชีหลัง {lag} วัน หักค่าธรรมเนียม {fee}% · ค่าวัตถุดิบหักวันเดียวกับที่ขาย · ค่าแรงจ่ายทุกสัปดาห์ · DoorDash / Grubhub เข้าทุกวันพฤหัส · ภาษีขายเดือนก่อน {tax}% ครบวันที่ 20 · ไม่นับเงิน Uber จนกว่าจะเปิด · ไม่มีอะไรถูกบันทึกนอกจากสมมติฐาน',
    ev: { start: 'เริ่ม', toast: 'Toast เข้า', food: 'วัตถุดิบ', payroll: 'ค่าแรง', doordash: 'DoorDash', grubhub: 'Grubhub', card: 'บัตรเครดิต', uber: 'Uber ปล่อยเงิน' },
  },
  en: {
    title: 'Cash forecast',
    from: 'from',
    asOf: 'as of',
    close: 'Close',
    unknownTitle: 'Missing from the file',
    unknownBody: 'Payroll and food purchases are not in the file, so the "Assumptions" % of sales is used instead. The result is only as good as those numbers — enter the real ones when known.',
    bad: 'Bad sales',
    normal: 'Normal sales',
    good: 'Good sales',
    perDay: 'Toast sales per day',
    lowest: 'Lowest',
    neg: 'Below zero on',
    ok: 'Stays above zero for {n} days',
    end: 'End',
    chart: 'Bank balance, day by day',
    zero: '$0',
    assumptions: 'Assumptions (editable)',
    horizon: 'Look ahead',
    days: 'days',
    food: 'Food & supplies, % of sales',
    payroll: 'Payroll, % of sales',
    payday: 'Payday',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    assumed: 'assumed',
    uber: 'Count the held Uber money',
    uberOn: 'arrives',
    card: 'Credit card',
    cardMin: 'Pay minimum',
    cardFull: 'Pay statement balance',
    payWhat: 'When to pay (clear the date = not paid in this window)',
    item: 'Item',
    amount: 'Amount',
    date: 'Date',
    debt: 'debt',
    monthly: 'Monthly bills',
    dueDay: 'Due on day',
    daily: 'Day by day',
    open: 'Open',
    inn: 'In',
    out: 'Out',
    bal: 'Balance',
    what: 'What',
    reset: 'Defaults',
    note:
      'How: Toast sales reach the bank after {lag} days minus {fee}% · food is bought the same day · payroll weekly · DoorDash / Grubhub on Thursdays · last month sales tax {tax}% due on the 20th · Uber money only when switched on · only the assumptions are saved.',
    ev: { start: 'Start', toast: 'Toast deposit', food: 'Food', payroll: 'Payroll', doordash: 'DoorDash', grubhub: 'Grubhub', card: 'Credit card', uber: 'Uber released' },
  },
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const STORE = 'money-flow.forecast.v1';
const SCEN = ['bad', 'normal', 'good'] as const;
type Scen = (typeof SCEN)[number];
const COLOR: Record<Scen, string> = { bad: 'var(--out)', normal: 'var(--acct)', good: 'var(--in)' };

/** only assumptions are remembered — never the cash figures */
function loadSaved(): Partial<Settings> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    const keep: (keyof Settings)[] = ['foodPct', 'payrollPct', 'payrollWeekday', 'horizonDays', 'cardMode'];
    return Object.fromEntries(Object.entries(v).filter(([k]) => keep.includes(k as keyof Settings)));
  } catch {
    return {};
  }
}

export default function ForecastView({ input, fileName, onClose }: { input: SimInput; fileName: string; onClose: () => void }) {
  const { lang } = useLang();
  const L = TEXT[lang];
  const [st, setSt] = useState<Settings>(() => ({ ...defaultSettings(input), ...loadSaved() }));
  const [pick, setPick] = useState<Scen>('normal');
  useEffect(() => setSt({ ...defaultSettings(input), ...loadSaved() }), [input]);
  useEffect(() => {
    try {
      const { foodPct, payrollPct, payrollWeekday, horizonDays, cardMode } = st;
      localStorage.setItem(STORE, JSON.stringify({ foodPct, payrollPct, payrollWeekday, horizonDays, cardMode }));
    } catch {
      /* private window: fine */
    }
  }, [st]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSt((s) => ({ ...s, [k]: v }));

  const runs = useMemo(
    () => ({ bad: simulate(input, st, st.salesBad), normal: simulate(input, st, st.salesNormal), good: simulate(input, st, st.salesGood) }) as Record<Scen, Run>,
    [input, st],
  );
  const salesKey: Record<Scen, 'salesBad' | 'salesNormal' | 'salesGood'> = { bad: 'salesBad', normal: 'salesNormal', good: 'salesGood' };
  const evLabel = (e: CashEvent) => (L.ev as Record<string, string>)[e.label] ?? e.label;
  const dshort = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${L.weekdays[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  };

  return (
    <div className="fc">
      <div className="fc-head">
        <div>
          <h2>📅 {L.title}</h2>
          <div className="muted small">
            {L.from} {fileName} · {L.asOf} {input.asOf} · {usd.format(input.cashCurrent)}
          </div>
        </div>
        <span className="spacer" />
        <button onClick={() => setSt(defaultSettings(input))}>{L.reset}</button>
        <button onClick={onClose}>{L.close}</button>
      </div>

      {input.unknown.length > 0 && (
        <div className="fc-unknown">
          <b>⚠️ {L.unknownTitle}:</b> {input.unknown.map((u) => u.item).join(' · ')}
          <div className="small">{L.unknownBody}</div>
        </div>
      )}

      <div className="fc-cards">
        {SCEN.map((k) => {
          const r = runs[k];
          return (
            <button key={k} className={`fc-card ${k} ${pick === k ? 'on' : ''}`} onClick={() => setPick(k)} aria-pressed={pick === k}>
              <span className="fc-card-title">
                <i style={{ background: COLOR[k] }} /> {L[k]}
              </span>
              <label className="small muted" onClick={(e) => e.stopPropagation()}>
                {L.perDay}{' '}
                <input
                  id={`fc-sales-${k}`}
                  type="number"
                  min={0}
                  step={10}
                  value={st[salesKey[k]]}
                  onChange={(e) => set(salesKey[k], Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
              {r.firstNegative ? (
                <b className="out">
                  {L.neg} {dshort(r.firstNegative)}
                </b>
              ) : (
                <b className="in">{fill(L.ok, { n: st.horizonDays })}</b>
              )}
              <span className="small">
                {L.lowest} <b className={r.low.value < 0 ? 'out' : ''}>{usd0.format(r.low.value)}</b> ({dshort(r.low.date)}) · {L.end} {usd0.format(r.end)}
              </span>
            </button>
          );
        })}
      </div>

      <section className="card fc-chart-card">
        <h3>{L.chart}</h3>
        <Chart runs={runs} pick={pick} dshort={dshort} labels={{ bad: L.bad, normal: L.normal, good: L.good }} />
      </section>

      <div className="fc-grid">
        <section className="card">
          <h3>{L.assumptions}</h3>
          <div className="fc-form">
            <label>
              {L.horizon}
              <select id="fc-horizon" value={st.horizonDays} onChange={(e) => set('horizonDays', Number(e.target.value))}>
                {[30, 45, 60, 90].map((n) => (
                  <option key={n} value={n}>
                    {n} {L.days}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {L.food} <span className="badge">{L.assumed}</span>
              <input id="fc-food" type="number" min={0} max={100} value={st.foodPct} onChange={(e) => set('foodPct', Number(e.target.value) || 0)} />
            </label>
            <label>
              {L.payroll} <span className="badge">{L.assumed}</span>
              <input id="fc-payroll" type="number" min={0} max={100} value={st.payrollPct} onChange={(e) => set('payrollPct', Number(e.target.value) || 0)} />
            </label>
            <label>
              {L.payday}
              <select id="fc-payday" value={st.payrollWeekday} onChange={(e) => set('payrollWeekday', Number(e.target.value))}>
                {L.weekdays.map((w, i) => (
                  <option key={w} value={i}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            {input.cardStatement !== null && (
              <label>
                {L.card} ({usd.format(input.cardStatement)}, {input.cardDate})
                <select id="fc-card" value={st.cardMode} onChange={(e) => set('cardMode', e.target.value as Settings['cardMode'])}>
                  <option value="min">
                    {L.cardMin} {usd.format(input.cardMinimum)}
                  </option>
                  <option value="full">{L.cardFull}</option>
                </select>
              </label>
            )}
            {input.heldUber > 0 && (
              <label className="fc-check">
                <input id="fc-uber" type="checkbox" checked={st.includeUber} onChange={(e) => set('includeUber', e.target.checked)} />
                {L.uber} {usd.format(input.heldUber)} · {L.uberOn}
                <input id="fc-uber-date" type="date" value={st.uberDate} disabled={!st.includeUber} onChange={(e) => set('uberDate', e.target.value)} />
              </label>
            )}
          </div>
          <p className="small muted">{fill(L.note, { lag: input.toastLagDays, fee: input.toastFeePct, tax: input.salesTaxPct })}</p>
        </section>

        <section className="card">
          <h3>{L.payWhat}</h3>
          <table>
            <thead>
              <tr>
                <th>{L.item}</th>
                <th className="num">{L.amount}</th>
                <th>{L.date}</th>
              </tr>
            </thead>
            <tbody>
              {input.obligations.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.label} {o.kind === 'debt' && <span className="badge">{L.debt}</span>} {o.status === 'estimate' && <span className="badge">{L.assumed}</span>}
                  </td>
                  <td className="num">{usd.format(o.amount)}</td>
                  <td>
                    <input
                      id={`fc-pay-${o.id}`}
                      type="date"
                      value={st.payDates[o.id] ?? ''}
                      onChange={(e) => setSt((s) => ({ ...s, payDates: { ...s.payDates, [o.id]: e.target.value } }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{L.monthly}</h3>
          <table>
            <tbody>
              {input.monthly.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.label} {m.status === 'estimate' && <span className="badge">{L.assumed}</span>}
                  </td>
                  <td className="num">{usd.format(m.amount)}</td>
                  <td className="small">
                    {L.dueDay}{' '}
                    <input
                      id={`fc-due-${m.id}`}
                      type="number"
                      min={1}
                      max={28}
                      value={st.dueDays[m.id] ?? m.day}
                      onChange={(e) => setSt((s) => ({ ...s, dueDays: { ...s.dueDays, [m.id]: Math.min(28, Math.max(1, Number(e.target.value) || 1)) } }))}
                    />{' '}
                    {m.dayAssumed && <span className="badge">{L.assumed}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <h3>
          {L.daily} · <span style={{ color: COLOR[pick] }}>{L[pick]}</span>
        </h3>
        <div className="fc-table">
          <table>
            <thead>
              <tr>
                <th>{L.date}</th>
                <th className="num">{L.inn}</th>
                <th className="num">{L.out}</th>
                <th className="num">{L.bal}</th>
                <th>{L.what}</th>
              </tr>
            </thead>
            <tbody>
              {runs[pick].days.map((d) => {
                const inn = d.events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
                const out = d.events.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);
                const notable = d.events.filter((e) => !['sales', 'food', 'start'].includes(e.group));
                return (
                  <tr key={d.date} className={d.close < 0 ? 'fc-neg' : ''}>
                    <td className="nowrap">{dshort(d.date)}</td>
                    <td className="num in">{inn ? usd0.format(inn) : ''}</td>
                    <td className="num out">{out ? usd0.format(out) : ''}</td>
                    <td className={`num ${d.close < 0 ? 'out' : ''}`}>
                      <b>{usd0.format(d.close)}</b>
                    </td>
                    <td className="small">{notable.map((e) => `${evLabel(e)} ${e.amount > 0 ? '+' : '−'}${usd0.format(Math.abs(e.amount))}`).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Chart({ runs, pick, dshort, labels }: { runs: Record<Scen, Run>; pick: Scen; dshort: (iso: string) => string; labels: Record<Scen, string> }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 300;
  const P = { l: 64, r: 16, t: 14, b: 30 };
  const n = runs.normal.days.length;
  const all = SCEN.flatMap((k) => runs[k].days.map((d) => d.close));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.06 || 100;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const x = (i: number) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  // round ticks
  const step = Math.pow(10, Math.floor(Math.log10((y1 - y0) / 4)));
  const nice = [1, 2, 5, 10].map((m) => m * step).find((s) => (y1 - y0) / s <= 6) ?? step * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(y0 / nice) * nice; v <= y1; v += nice) ticks.push(v);
  return (
    <div className="fc-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="cash balance chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (n - 1)))));
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={v === 0 ? 0 : 1} />
            <text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {usd0.format(Math.abs(v) < 1e-9 ? 0 : v)}
            </text>
          </g>
        ))}
        {lo < 0 && <rect x={P.l} y={y(0)} width={W - P.l - P.r} height={y(y0) - y(0)} fill="var(--out)" opacity="0.06" />}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="var(--text)" strokeDasharray="4 3" strokeWidth="1.2" />
        {runs.normal.days.map((d, i) =>
          i % 7 === 0 ? (
            <text key={d.date} x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {dshort(d.date)}
            </text>
          ) : null,
        )}
        {SCEN.map((k) => (
          <polyline
            key={k}
            points={runs[k].days.map((d, i) => `${x(i)},${y(d.close)}`).join(' ')}
            fill="none"
            stroke={COLOR[k]}
            strokeWidth={k === pick ? 3 : 1.6}
            opacity={k === pick ? 1 : 0.55}
            strokeLinejoin="round"
          />
        ))}
        {SCEN.map((k) => {
          const neg = runs[k].firstNegative;
          if (!neg) return null;
          const i = runs[k].days.findIndex((d) => d.date === neg);
          return <circle key={k} cx={x(i)} cy={y(runs[k].days[i].close)} r={5} fill={COLOR[k]} stroke="#fff" strokeWidth="1.5" />;
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--muted)" strokeWidth="1" />
            {SCEN.map((k) => (
              <circle key={k} cx={x(hover)} cy={y(runs[k].days[hover].close)} r={3.5} fill={COLOR[k]} />
            ))}
          </g>
        )}
      </svg>
      <div className="fc-legend small">
        {hover !== null ? (
          <>
            <b>{dshort(runs.normal.days[hover].date)}</b>
            {SCEN.map((k) => (
              <span key={k}>
                <i style={{ background: COLOR[k] }} /> {labels[k]} <b className={runs[k].days[hover].close < 0 ? 'out' : ''}>{usd0.format(runs[k].days[hover].close)}</b>
              </span>
            ))}
          </>
        ) : (
          SCEN.map((k) => (
            <span key={k}>
              <i style={{ background: COLOR[k] }} /> {labels[k]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
