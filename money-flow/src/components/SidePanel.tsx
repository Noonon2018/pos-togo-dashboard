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
import { useT } from '../i18n';
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
  const t = useT();
  const tabLabel: Record<Tab, string> = {
    overview: t('tabOverview'),
    monthly: t('tabMonthly'),
    recurring: t('tabRecurring'),
    duplicates: t('tabDuplicates'),
    names: t('tabNames'),
  };
  return (
    <aside className="panel">
      {selection ? (
        <Details {...props} selection={selection} />
      ) : (
        <>
          <nav className="tabs">
            {(['overview', 'monthly', 'recurring', 'duplicates', 'names'] as Tab[]).map((k) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {tabLabel[k]}
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
  const t = useT();
  const accts = useMemo(() => accountTotals(txns), [txns]);
  const topIn = useMemo(() => topCounterparties(txns, aliases, 'in', 10), [txns, aliases]);
  const topOut = useMemo(() => topCounterparties(txns, aliases, 'out', 10), [txns, aliases]);
  const maxOut = topOut[0]?.outflow ?? 1;
  const maxIn = topIn[0]?.inflow ?? 1;
  return (
    <>
      <h3>{t('accountsRaw')}</h3>
      <table>
        <thead>
          <tr>
            <th>{t('account')}</th>
            <th className="num">{t('in')}</th>
            <th className="num">{t('out')}</th>
            <th className="num">{t('net')}</th>
          </tr>
        </thead>
        <tbody>
          {accts.map((a) => (
            <tr key={a.account} title={`${a.count} ${t('txns')} · ${a.first} → ${a.last}`}>
              <td>
                {a.account}
                <div className="muted small nowrap">
                  {a.count} {t('txns')} · {a.first.slice(5)} → {a.last.slice(5)}
                </div>
              </td>
              <td className="num in">{money(a.inflow)}</td>
              <td className="num out">{money(a.outflow)}</td>
              <td className="num">{money(a.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t('topOut')}</h3>
      <BarList items={topOut.map((c) => ({ name: c.name, value: c.outflow, sub: `${c.countOut}×` }))} max={maxOut} cls="out" onPick={(n) => onSelect(nodeOf(n))} />
      <h3>{t('topIn')}</h3>
      <BarList items={topIn.map((c) => ({ name: c.name, value: c.inflow, sub: `${c.countIn}×` }))} max={maxIn} cls="in" onPick={(n) => onSelect(nodeOf(n))} />
      <p className="muted small">{t('transfersExcluded')}</p>
    </>
  );
}

function BarList({ items, max, cls, onPick }: { items: { name: string; value: number; sub: string }[]; max: number; cls: string; onPick: (n: string) => void }) {
  const t = useT();
  if (!items.length) return <p className="muted">{t('nothing')}</p>;
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
  const t = useT();
  const rows = useMemo(() => monthlyTotals(txns, aliases), [txns, aliases]);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.inflow, r.outflow)));
  return (
    <>
      <h3>{t('byMonth')}</h3>
      <table className="monthly">
        <thead>
          <tr>
            <th>{t('month')}</th>
            <th className="num">{t('in')}</th>
            <th className="num">{t('out')}</th>
            <th className="num">{t('net')}</th>
            <th className="num" title={t('transfersTitle')}>
              {t('transfers')}
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
        {t('monthlyNote')}
      </p>
    </>
  );
}

function Recurring({ txns, aliases, onSelect }: Props) {
  const t = useT();
  const rows = useMemo(() => detectRecurring(txns, aliases), [txns, aliases]);
  const outs = rows.filter((r) => r.direction === 'out');
  const ins = rows.filter((r) => r.direction === 'in');
  const yearly = outs.reduce((s, r) => s + r.annualCost, 0);
  const table = (list: typeof rows) => (
    <table>
      <thead>
        <tr>
          <th>{t('who')}</th>
          <th>{t('every')}</th>
          <th className="num">{t('typical')}</th>
          <th className="num">{t('perYear')}</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={`${r.counterparty}|${r.account}`} className="clickable" onClick={() => onSelect(nodeOf(r.counterparty))}>
            <td>
              {r.counterparty}
              <div className="muted small">
                {r.account} · {r.count}× · {t('next')} {r.nextExpected}{r.priceIncrease && <span className="warn">{t('priceUp', { v: money(r.lastAmount) })}</span>}
              </div>
            </td>
            <td>{t(r.frequency)}</td>
            <td className="num">{money(r.typicalAmount)}</td>
            <td className="num">{money(r.annualCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <h3>{t('recurringTitle')}</h3>
      {outs.length ? (
        <>
          <p>
            <b>{t('recurringSummary', { n: outs.length, v: money(yearly) })}</b>
          </p>
          {table(outs)}
        </>
      ) : (
        <p className="muted">{t('recurringNone')}</p>
      )}
      {ins.length > 0 && (
        <>
          <h3>{t('recurringIncome')}</h3>
          {table(ins)}
        </>
      )}
      <p className="muted small">{t('recurringNote')}</p>
    </>
  );
}

function Duplicates({ txns, aliases }: Props) {
  const t = useT();
  const groups = useMemo(() => findDuplicates(txns, aliases), [txns, aliases]);
  if (!groups.length) return <p className="muted">{t('noDuplicates')}</p>;
  return (
    <>
      <h3>{t('duplicatesTitle', { n: groups.length })}</h3>
      <p className="muted small">{t('duplicatesNote')}</p>
      {groups.map((g, i) => (
        <div key={i} className={`dup ${g.kind}`}>
          <div className="dup-head">
            <span className="badge">{t(g.kind)}</span> <b>{g.counterparty}</b> · {money(g.amount)} × {g.transactions.length}
            <div className="muted small">{g.account}</div>
          </div>
          <TxList txns={g.transactions} aliases={aliases} compact />
        </div>
      ))}
    </>
  );
}

function Names({ txns, aliases, accounts, onRename, onUnmerge, onSelect }: Props) {
  const tr = useT();
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
      <h3>{tr('namesTitle')}</h3>
      <p className="muted small">{tr('namesNote')}</p>
      <input className="search" placeholder={tr('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {picked.length > 0 && (
        <div className="merge-bar">
          <span>{tr('selected', { n: picked.length })}</span>
          <input list="names-list" placeholder={tr('newName')} value={target} onChange={(e) => setTarget(e.target.value)} />
          <button className="primary" disabled={!target.trim()} onClick={merge}>
            {tr('merge')}
          </button>
        </div>
      )}
      <datalist id="names-list">
        {accounts.map((a) => (
          <option key={`a-${a}`} value={a}>
            {tr('yourAccount')}
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
                    <span key={r} className="chip" title={tr('unmergeTitle')} onClick={() => onUnmerge(r)}>
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
  const tr = useT();
  const back = (
    <button className="back" onClick={() => onSelect(null)}>
      {tr('back')}
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
          <b>{e.count}</b> {tr('transactions')} · <b>{money(e.total)}</b>
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
        <p className="muted">{tr('notInView')}</p>
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
          <span className="muted small">{node.kind === 'account' ? tr('intoAccount') : tr('theyReceived')}</span>
          <b className={node.kind === 'account' ? 'in' : 'out'}>{money(node.totalIn)}</b>
        </div>
        <div>
          <span className="muted small">{node.kind === 'account' ? tr('outOfAccount') : tr('theySent')}</span>
          <b className={node.kind === 'account' ? 'out' : 'in'}>{money(node.totalOut)}</b>
        </div>
        <div>
          <span className="muted small">{tr('transactions')}</span>
          <b>{list.length}</b>
        </div>
      </div>

      {node.kind === 'counterparty' && (
        <>
          <div className="merge-bar">
            <input list="rename-list" placeholder={tr('renamePh')} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <datalist id="rename-list">
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {tr('yourAccountXfer')}
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
              {tr('apply')}
            </button>
          </div>
          {raws.some((r) => r !== node.label) && (
            <div className="raws">
              <span className="muted small">{tr('mergedFrom')}</span>
              {raws
                .filter((r) => r !== node.label)
                .map((r) => (
                  <span key={r} className="chip" title={tr('unmergeTitle')} onClick={() => onUnmerge(r)}>
                    {r} ✕
                  </span>
                ))}
            </div>
          )}
        </>
      )}

      <h3>{tr('connections')}</h3>
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
      {node.id === OTHER_NODE && <p className="muted small">{tr('otherHint')}</p>}
      <h3>{tr('transactions')}</h3>
      <TxList txns={list} aliases={aliases} />
    </div>
  );
}

function TxList({ txns, aliases, compact }: { txns: Transaction[]; aliases: Aliases; compact?: boolean }) {
  const [limit, setLimit] = useState(100);
  const tr = useT();
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
      {sorted.length > limit && <button onClick={() => setLimit((l) => l + 200)}>{tr('showMore', { n: sorted.length - limit })}</button>}
    </>
  );
}
