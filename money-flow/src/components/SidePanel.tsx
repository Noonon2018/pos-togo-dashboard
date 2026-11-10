import { useMemo, useState } from 'react';
import {
  OTHER_NODE,
  accountTotals,
  counterpartyName,
  counterpartyTotals,
  detectRecurring,
  findDuplicates,
  monthlyTotals,
  topCounterparties,
  type Graph,
} from '../lib/aggregate';
import type { Aliases, Transaction } from '../lib/types';
import { money } from '../format';
import type { Selection } from './GraphView';

interface Props {
  txns: Transaction[]; // filtered
  aliases: Aliases;
  graph: Graph;
  accounts: string[];
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onRename: (from: string, to: string) => void;
  onUnmerge: (rawKey: string) => void;
}

type Tab = 'overview' | 'monthly' | 'recurring' | 'duplicates' | 'names';

export default function SidePanel(props: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const { selection } = props;
  return (
    <aside className="panel">
      {selection ? (
        <Details {...props} selection={selection} />
      ) : (
        <>
          <nav className="tabs">
            {(['overview', 'monthly', 'recurring', 'duplicates', 'names'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
          <div className="panel-body">
            {tab === 'overview' && <Overview {...props} />}
            {tab === 'monthly' && <Monthly {...props} />}
            {tab === 'recurring' && <Recurring {...props} />}
            {tab === 'duplicates' && <Duplicates {...props} />}
            {tab === 'names' && <Names {...props} />}
          </div>
        </>
      )}
    </aside>
  );
}

const nodeOf = (name: string): Selection => ({ kind: 'node', id: `cp:${name}` });

function Overview({ txns, aliases, onSelect }: Props) {
  const accts = useMemo(() => accountTotals(txns), [txns]);
  const topIn = useMemo(() => topCounterparties(txns, aliases, 'in', 10), [txns, aliases]);
  const topOut = useMemo(() => topCounterparties(txns, aliases, 'out', 10), [txns, aliases]);
  const maxOut = topOut[0]?.outflow ?? 1;
  const maxIn = topIn[0]?.inflow ?? 1;
  return (
    <>
      <h3>Accounts (raw — should match your statements)</h3>
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th className="num">In</th>
            <th className="num">Out</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {accts.map((a) => (
            <tr key={a.account} title={`${a.count} txns · ${a.first} → ${a.last}`}>
              <td>
                {a.account}
                <div className="muted small nowrap">
                  {a.count} txns · {a.first.slice(5)} → {a.last.slice(5)}
                </div>
              </td>
              <td className="num in">{money(a.inflow)}</td>
              <td className="num out">{money(a.outflow)}</td>
              <td className="num">{money(a.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Top money out</h3>
      <BarList items={topOut.map((c) => ({ name: c.name, value: c.outflow, sub: `${c.countOut}×` }))} max={maxOut} cls="out" onPick={(n) => onSelect(nodeOf(n))} />
      <h3>Top money in</h3>
      <BarList items={topIn.map((c) => ({ name: c.name, value: c.inflow, sub: `${c.countIn}×` }))} max={maxIn} cls="in" onPick={(n) => onSelect(nodeOf(n))} />
      <p className="muted small">Transfers between your own accounts are excluded from the top lists.</p>
    </>
  );
}

function BarList({ items, max, cls, onPick }: { items: { name: string; value: number; sub: string }[]; max: number; cls: string; onPick: (n: string) => void }) {
  if (!items.length) return <p className="muted">Nothing in this range.</p>;
  return (
    <ul className="bars">
      {items.map((i) => (
        <li key={i.name} onClick={() => onPick(i.name)}>
          <div className="bar-label">
            <span>{i.name}</span>
            <span className="num">
              {money(i.value)} <span className="muted small">{i.sub}</span>
            </span>
          </div>
          <div className="bar-track">
            <div className={`bar ${cls}`} style={{ width: `${(100 * i.value) / max}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Monthly({ txns, aliases }: Props) {
  const rows = useMemo(() => monthlyTotals(txns, aliases), [txns, aliases]);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.inflow, r.outflow)));
  return (
    <>
      <h3>By month</h3>
      <table className="monthly">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">In</th>
            <th className="num">Out</th>
            <th className="num">Net</th>
            <th className="num" title="Moved between your own accounts (counted once)">
              Transfers
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>
                {r.month}
                <div className="mini">
                  <div className="bar in" style={{ width: `${(100 * r.inflow) / max}%` }} />
                  <div className="bar out" style={{ width: `${(100 * r.outflow) / max}%` }} />
                </div>
              </td>
              <td className="num in">{money(r.inflow)}</td>
              <td className="num out">{money(r.outflow)}</td>
              <td className={`num ${r.net < 0 ? 'out' : ''}`}>{money(r.net)}</td>
              <td className="num muted">{money(r.transfers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        In/Out exclude transfers between your accounts once you've renamed those transfer nodes to the account name (see Names tab).
      </p>
    </>
  );
}

function Recurring({ txns, aliases, onSelect }: Props) {
  const rows = useMemo(() => detectRecurring(txns, aliases), [txns, aliases]);
  const outs = rows.filter((r) => r.direction === 'out');
  const ins = rows.filter((r) => r.direction === 'in');
  const yearly = outs.reduce((s, r) => s + r.annualCost, 0);
  const table = (list: typeof rows) => (
    <table>
      <thead>
        <tr>
          <th>Who</th>
          <th>Every</th>
          <th className="num">Typical</th>
          <th className="num">Per year</th>
          <th>Next</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={`${r.counterparty}|${r.account}`} className="clickable" onClick={() => onSelect(nodeOf(r.counterparty))}>
            <td>
              {r.counterparty}
              <div className="muted small">
                {r.account} · {r.count}×{r.priceIncrease && <span className="warn"> · price up → {money(r.lastAmount)}</span>}
              </div>
            </td>
            <td>{r.frequency}</td>
            <td className="num">{money(r.typicalAmount)}</td>
            <td className="num">{money(r.annualCost)}</td>
            <td className="small">{r.nextExpected}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <h3>Recurring charges</h3>
      {outs.length ? (
        <>
          <p>
            <b>{outs.length}</b> recurring outflows ≈ <b className="out">{money(yearly)}</b> per year.
          </p>
          {table(outs)}
        </>
      ) : (
        <p className="muted">None found. Needs ≥3 regular charges (2 for yearly) with similar amounts.</p>
      )}
      {ins.length > 0 && (
        <>
          <h3>Recurring income</h3>
          {table(ins)}
        </>
      )}
      <p className="muted small">Heuristic: regular spacing (weekly…yearly) and amounts within ±20%. Load 3+ months for best results.</p>
    </>
  );
}

function Duplicates({ txns, aliases }: Props) {
  const groups = useMemo(() => findDuplicates(txns, aliases), [txns, aliases]);
  if (!groups.length) return <p className="muted">No possible duplicates in this range.</p>;
  return (
    <>
      <h3>Possible duplicates ({groups.length})</h3>
      <p className="muted small">Same account, counterparty and amount on the same day (exact) or within 2 days (near). Verify before disputing.</p>
      {groups.map((g, i) => (
        <div key={i} className={`dup ${g.kind}`}>
          <div className="dup-head">
            <span className="badge">{g.kind}</span> <b>{g.counterparty}</b> · {money(g.amount)} × {g.transactions.length}
            <div className="muted small">{g.account}</div>
          </div>
          <TxList txns={g.transactions} aliases={aliases} compact />
        </div>
      ))}
    </>
  );
}

function Names({ txns, aliases, accounts, onRename, onUnmerge, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const totals = useMemo(() => counterpartyTotals(txns, aliases), [txns, aliases]);
  const rawByName = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of txns) {
      const n = counterpartyName(t, aliases);
      (m.get(n) ?? m.set(n, new Set()).get(n)!).add(t.counterparty);
    }
    return m;
  }, [txns, aliases]);
  const list = totals
    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));
  const merge = () => {
    for (const p of picked) onRename(p, target);
    setPicked([]);
    setTarget('');
  };
  return (
    <>
      <h3>Rename / merge counterparties</h3>
      <p className="muted small">
        Tick names that are the same party and merge them. To mark a transfer between your own accounts, merge it into the
        <b> account name</b> (e.g. “TRANSFER SAV 7788” → “Savings”).
      </p>
      <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      {picked.length > 0 && (
        <div className="merge-bar">
          <span>{picked.length} selected → </span>
          <input list="names-list" placeholder="New / existing name" value={target} onChange={(e) => setTarget(e.target.value)} />
          <button className="primary" disabled={!target.trim()} onClick={merge}>
            Merge
          </button>
        </div>
      )}
      <datalist id="names-list">
        {accounts.map((a) => (
          <option key={`a-${a}`} value={a}>
            (your account)
          </option>
        ))}
        {totals.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      <ul className="names">
        {list.map((c) => {
          const raws = [...(rawByName.get(c.name) ?? [])].filter((r) => r !== c.name);
          return (
            <li key={c.name}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.includes(c.name)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.name] : p.filter((x) => x !== c.name)))}
                />
                <span className="link" onClick={(e) => (e.preventDefault(), onSelect(nodeOf(c.name)))}>
                  {c.name}
                </span>
              </label>
              <span className="num small">
                {c.inflow > 0 && <span className="in">+{money(c.inflow)} </span>}
                {c.outflow > 0 && <span className="out">−{money(c.outflow)}</span>}
              </span>
              {raws.length > 0 && (
                <div className="raws">
                  {raws.map((r) => (
                    <span key={r} className="chip" title="Click to un-merge" onClick={() => onUnmerge(r)}>
                      {r} ✕
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Details({ txns, aliases, graph, accounts, selection, onSelect, onRename, onUnmerge }: Props & { selection: Selection }) {
  const [newName, setNewName] = useState('');
  const back = (
    <button className="back" onClick={() => onSelect(null)}>
      ← Back
    </button>
  );
  const byId = useMemo(() => new Map(txns.map((t) => [t.id, t])), [txns]);

  if (selection.kind === 'edge') {
    const e = graph.edges.find((x) => x.id === selection.id);
    if (!e) return <div className="panel-body">{back}</div>;
    const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
    const list = e.txIds.map((id) => byId.get(id)!).filter(Boolean);
    return (
      <div className="panel-body">
        {back}
        <h2>
          {label(e.source)} → {label(e.target)}
        </h2>
        <p>
          <b>{e.count}</b> transactions · <b>{money(e.total)}</b>
        </p>
        <TxList txns={list} aliases={aliases} />
      </div>
    );
  }

  const node = graph.nodes.find((n) => n.id === selection.id);
  if (!node) {
    return (
      <div className="panel-body">
        {back}
        <p className="muted">Not in the current view (check filters / Top N).</p>
      </div>
    );
  }
  const incident = graph.edges.filter((e) => e.source === node.id || e.target === node.id);
  const list = incident.flatMap((e) => e.txIds.map((id) => byId.get(id)!)).filter(Boolean);
  const raws = node.kind === 'counterparty' ? [...new Set(list.filter((t) => counterpartyName(t, aliases) === node.label).map((t) => t.counterparty))] : [];

  return (
    <div className="panel-body">
      {back}
      <h2>{node.label}</h2>
      <div className="kpis">
        <div>
          <span className="muted small">{node.kind === 'account' ? 'Into account' : 'They received'}</span>
          <b className={node.kind === 'account' ? 'in' : 'out'}>{money(node.totalIn)}</b>
        </div>
        <div>
          <span className="muted small">{node.kind === 'account' ? 'Out of account' : 'They sent you'}</span>
          <b className={node.kind === 'account' ? 'out' : 'in'}>{money(node.totalOut)}</b>
        </div>
        <div>
          <span className="muted small">Transactions</span>
          <b>{list.length}</b>
        </div>
      </div>

      {node.kind === 'counterparty' && (
        <>
          <div className="merge-bar">
            <input list="rename-list" placeholder="Rename / merge into…" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <datalist id="rename-list">
              {accounts.map((a) => (
                <option key={a} value={a}>
                  (your account — marks as transfer)
                </option>
              ))}
              {graph.nodes
                .filter((n) => n.kind === 'counterparty' && n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.label} />
                ))}
            </datalist>
            <button
              className="primary"
              disabled={!newName.trim()}
              onClick={() => {
                onRename(node.label, newName.trim());
                onSelect(accounts.includes(newName.trim()) ? null : nodeOf(newName.trim()));
                setNewName('');
              }}
            >
              Apply
            </button>
          </div>
          {raws.some((r) => r !== node.label) && (
            <div className="raws">
              <span className="muted small">Merged from: </span>
              {raws
                .filter((r) => r !== node.label)
                .map((r) => (
                  <span key={r} className="chip" title="Click to un-merge" onClick={() => onUnmerge(r)}>
                    {r} ✕
                  </span>
                ))}
            </div>
          )}
        </>
      )}

      <h3>Connections</h3>
      <ul className="conn">
        {incident
          .sort((a, b) => b.total - a.total)
          .map((e) => {
            const other = e.source === node.id ? e.target : e.source;
            const label = graph.nodes.find((n) => n.id === other)?.label ?? other;
            return (
              <li key={e.id} onClick={() => onSelect({ kind: 'edge', id: e.id })}>
                <span>
                  {e.source === node.id ? '→' : '←'} {label}
                </span>
                <span className="num">
                  {e.count} / {money(e.total)}
                </span>
              </li>
            );
          })}
      </ul>
      {node.id === OTHER_NODE && <p className="muted small">Raise “Top N” in the filters to break this group out.</p>}
      <h3>Transactions</h3>
      <TxList txns={list} aliases={aliases} />
    </div>
  );
}

function TxList({ txns, aliases, compact }: { txns: Transaction[]; aliases: Aliases; compact?: boolean }) {
  const [limit, setLimit] = useState(100);
  const sorted = [...txns].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <table className="tx">
        <tbody>
          {sorted.slice(0, limit).map((t) => (
            <tr key={t.id} title={`${t.description}\n${t.source}`}>
              <td className="small">{t.date}</td>
              <td>
                {!compact && <div>{counterpartyName(t, aliases)}</div>}
                <div className="muted small desc">
                  {t.account} · {t.description}
                </div>
              </td>
              <td className={`num ${t.amount < 0 ? 'out' : 'in'}`}>{money(t.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > limit && <button onClick={() => setLimit((l) => l + 200)}>Show more ({sorted.length - limit})</button>}
    </>
  );
}
