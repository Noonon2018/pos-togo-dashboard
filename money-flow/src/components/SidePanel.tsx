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
import { amountFmt, money } from '../format';
import { useT } from '../i18n';
import { mergeKind } from '../lib/mergeCheck';
import { resolveAlias } from '../lib/normalize';
import { isCryptoAddress, shortAddress } from '../lib/csv';
import { addressBookCsv, bookKey, displayName, KIND_ICON, KINDS, type AddressBook, type Label, type LabelKind } from '../lib/addressBook';
import { download } from '../lib/exportCsv';
import { ROLE_ICON, type Role } from '../lib/roles';
import { nextToExport, traceFrom, type Hop } from '../lib/trace';
import type { Selection } from './GraphView';

interface Props {
  txns: Transaction[]; // filtered
  /** flows between other people (graph only) */
  links?: Transaction[];
  /** links + bank-statement rows as from → to (for tracing and roles) */
  traceLinks?: Transaction[];
  book?: AddressBook;
  roles?: Map<string, Role[]>;
  onLabel?: (party: string, label: Label | null) => void;
  /** highlight these edges in the graph (a traced money trail), or clear */
  onTrace?: (edgeIds: string[] | null) => void;
  /** replace the whole address book (used by "Clear") */
  onBookReplace?: (b: AddressBook) => void;
  aliases: Aliases;
  graph: Graph;
  accounts: string[];
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  /** merge/rename; returns false if the user cancelled */
  onRename: (from: string[], to: string) => boolean;
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

/** The explanation line of a role, with amounts in the right currency / coin. */
function roleWhy(r: Role, tr: ReturnType<typeof useT>): string {
  const unit = String(r.vars.unit ?? '$') === '$' ? undefined : String(r.vars.unit);
  const v: Record<string, string | number> = { ...r.vars };
  for (const k of ['in', 'out', 'total', 'max', 'min', 'back']) if (typeof r.vars[k] === 'number') v[k] = amountFmt(r.vars[k] as number, unit);
  if (r.vars.gap) v.gap = gapText(String(r.vars.gap), tr);
  if (typeof r.vars.min === 'number') v.each = r.vars.min === r.vars.max ? v.max : `${v.min}–${v.max}`;
  return tr(`role_${r.id}_why` as Parameters<typeof tr>[0], v);
}

/** Parties with a 🧩 / 🔁 / ⚡ hint: what an investigator would open first. */
function RedFlags({ roles, graph, book = {}, onSelect }: Props) {
  const tr = useT();
  const items = useMemo(() => {
    const order: Role['id'][] = ['splitCash', 'splitOut', 'splitIn', 'roundTrip', 'passThrough'];
    const list: { party: string; r: Role }[] = [];
    for (const [party, rs] of roles ?? []) for (const r of rs) if (order.includes(r.id)) list.push({ party, r });
    const size = (r: Role) => Number(r.vars.total ?? r.vars.back ?? r.vars.out ?? 0);
    return list.sort((a, b) => order.indexOf(a.r.id) - order.indexOf(b.r.id) || size(b.r) - size(a.r)).slice(0, 12);
  }, [roles]);
  if (!items.length) return null;
  const nodeId = (p: string) => graph.nodes.find((n) => n.id === `acct:${p}` || n.id === `cp:${p}`)?.id ?? graph.nodes.find((n) => n.label === p)?.id;
  return (
    <section className="redflags">
      <h3>⚠️ {tr('redFlags')}</h3>
      <ul className="roles">
        {items.map(({ party, r }) => {
          const id = nodeId(party);
          return (
            <li key={`${party}-${r.id}`} className={`role ${r.id}${id ? ' clickable' : ''}`} onClick={() => id && onSelect({ kind: 'node', id })}>
              <b>
                {ROLE_ICON[r.id]} {displayName(party, book, shortAddress).text}
              </b>
              <span className="small">{roleWhy(r, tr)}</span>
            </li>
          );
        })}
      </ul>
      <p className="small muted">{tr('rolesNote')}</p>
    </section>
  );
}

function Overview(props: Props) {
  const { txns, aliases, onSelect } = props;
  const t = useT();
  const accts = useMemo(() => accountTotals(txns), [txns]);
  const topIn = useMemo(() => topCounterparties(txns, aliases, 'in', 10), [txns, aliases]);
  const topOut = useMemo(() => topCounterparties(txns, aliases, 'out', 10), [txns, aliases]);
  const maxOut = topOut[0]?.outflow ?? 1;
  const maxIn = topIn[0]?.inflow ?? 1;
  return (
    <>
      <RedFlags {...props} />
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

function Names({ txns, aliases, accounts, onRename, onUnmerge, onSelect, book = {}, onBookReplace }: Props) {
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
    if (!onRename(picked, target)) return;
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
      {picked.length > 0 && target.trim() && <MergeHint to={target} txns={txns} aliases={aliases} accounts={accounts} />}
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
      <div className="book-box">
        <b>📒 {tr('bookTitle')}</b>
        <div className="book-actions">
          <span className="small muted">{tr('bookCount', { n: Object.keys(book).length })}</span>
          {Object.keys(book).length > 0 && (
            <>
              <button className="small" onClick={() => download('address-book.csv', addressBookCsv(book))}>
                {tr('bookExport')}
              </button>
              <button className="small danger" onClick={() => confirm(tr('confirmBookClear')) && onBookReplace?.({})}>
                {tr('bookClear')}
              </button>
            </>
          )}
        </div>
        <span className="small muted">{tr('bookHint')}</span>
      </div>
    </>
  );
}

function Details({ txns, links = [], traceLinks = links, aliases, graph, accounts, selection, onSelect, onRename, onUnmerge, book = {}, roles, onLabel, onTrace }: Props & { selection: Selection }) {
  const [newName, setNewName] = useState('');
  const tr = useT();
  const back = (
    <button className="back" onClick={() => onSelect(null)}>
      {tr('back')}
    </button>
  );
  const byId = useMemo(() => new Map([...txns, ...links].map((t) => [t.id, t])), [txns, links]);

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
          <b>{e.count}</b> {tr('transactions')} · <b>{amountFmt(e.total, e.unit)}</b>
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

  const party = node.id.replace(/^(cp|acct):/, '');
  const isLinkParty = node.kind !== 'other' && traceLinks.some((l) => l.link && (l.link.from === party || l.link.to === party));
  const isAddress = isCryptoAddress(party);
  const shown = isLinkParty ? displayName(party, book, shortAddress).text : node.label;
  const partyRoles = roles?.get(party) ?? [];
  const canTrace = traceLinks.some((l) => l.link?.from === party);

  return (
    <div className="panel-body">
      {back}
      <h2 className="party-name">{shown}</h2>
      {isAddress && (
        <div className="addr-line">
          <code className="addr">{party}</code>
          <CopyButton text={party} />
          {/^0x[0-9a-f]{40}$/.test(party) && (
            <a className="small" href={`https://etherscan.io/address/${party}`} target="_blank" rel="noopener noreferrer">
              Etherscan ↗
            </a>
          )}
        </div>
      )}
      {partyRoles.length > 0 && (
        <ul className="roles">
          {partyRoles.map((r) => (
            <li key={r.id} className={`role ${r.id}`}>
              <b>
                {ROLE_ICON[r.id]} {tr(`role_${r.id}` as Parameters<typeof tr>[0])}
              </b>
              <span className="small">
                {roleWhy(r, tr)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {partyRoles.length > 0 && <p className="small muted roles-note">{tr('rolesNote')}</p>}
      {isLinkParty && onLabel && <LabelEditor key={party} party={party} current={book[bookKey(party)]} onLabel={onLabel} />}
      {canTrace && onTrace && <TraceView key={`t-${party}`} start={party} links={traceLinks} book={book} graph={graph} onTrace={onTrace} onSelect={onSelect} />}
      <div className="kpis">
        <div>
          <span className="muted small">{node.kind === 'account' ? tr('intoAccount') : tr('theyReceived')}</span>
          <b className={node.kind === 'account' ? 'in' : 'out'}>{node.unit === 'MIXED' ? '—' : amountFmt(node.totalIn, node.unit)}</b>
        </div>
        <div>
          <span className="muted small">{node.kind === 'account' ? tr('outOfAccount') : tr('theySent')}</span>
          <b className={node.kind === 'account' ? 'out' : 'in'}>{node.unit === 'MIXED' ? '—' : amountFmt(node.totalOut, node.unit)}</b>
        </div>
        <div>
          <span className="muted small">{tr('transactions')}</span>
          <b>{list.length}</b>
        </div>
      </div>

      {node.kind === 'counterparty' && !isAddress && (
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
                const to = newName.trim();
                const fromName = isCryptoAddress(node.id.replace(/^acct:/, '')) ? node.id.replace(/^acct:/, '') : node.label;
                if (!onRename([fromName], to)) return;
                if (fromName !== node.label || node.kind === 'account') onSelect({ kind: 'node', id: node.id });
                else onSelect(accounts.some((a) => a.toUpperCase() === to.toUpperCase()) ? null : nodeOf(to));
                setNewName('');
              }}
            >
              {tr('apply')}
            </button>
          </div>
          {newName.trim() && <MergeHint to={newName} txns={txns} aliases={aliases} accounts={accounts} />}
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
                  {e.count} / {amountFmt(e.total, e.unit)}
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
                {t.link ? (
                  <div>
                    <span className="link-tag">
                      {resolveAlias(t.link.from, aliases)} → {resolveAlias(t.link.to, aliases)}
                    </span>
                  </div>
                ) : (
                  !compact && <div>{counterpartyName(t, aliases)}</div>
                )}
                <div className="muted small desc">{t.link ? t.description : `${t.account} · ${t.description}`}</div>
              </td>
              <td className={`num ${t.link ? '' : t.amount < 0 ? 'out' : 'in'}`}>{amountFmt(t.link ? -t.amount : t.amount, t.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > limit && <button onClick={() => setLimit((l) => l + 200)}>{tr('showMore', { n: sorted.length - limit })}</button>}
    </>
  );
}

/** Says, before you press the button, whether this is a rename, a merge, or a transfer to your own account. */
function MergeHint({ to, txns, aliases, accounts }: { to: string; txns: Transaction[]; aliases: Aliases; accounts: string[] }) {
  const tr = useT();
  const names = useMemo(() => new Set(txns.map((t) => counterpartyName(t, aliases))), [txns, aliases]);
  const target = to.trim();
  const kind = mergeKind(target, names, accounts);
  return (
    <p className={`merge-hint small ${kind}`}>
      {kind === 'merge' ? '🔗 ' + tr('hintMerge', { to: target }) : kind === 'account' ? '🔁 ' + tr('hintAccount', { to: target }) : '✏️ ' + tr('hintRename', { to: target })}
    </p>
  );
}

type TrFn = ReturnType<typeof useT>;

/** "11m" -> "11 นาที" / "11 minutes" */
function gapText(g: string, tr: TrFn): string {
  const m = g.match(/^(\d+)([mhd])$/);
  if (!m) return g;
  return tr(m[2] === 'm' ? 'gapMin' : m[2] === 'h' ? 'gapHour' : 'gapDay', { n: m[1] });
}

function CopyButton({ text }: { text: string }) {
  const tr = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      className="link small"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {done ? tr('copied') : tr('copy')}
    </button>
  );
}

/** Give a party a name and a type; stored in the address book on this computer. */
function LabelEditor({ party, current, onLabel }: { party: string; current?: Label; onLabel: (p: string, l: Label | null) => void }) {
  const tr = useT();
  const [name, setName] = useState(current?.name ?? '');
  const [kind, setKind] = useState<LabelKind>(current?.kind ?? 'other');
  return (
    <div className="label-editor">
      <span className="small muted">{tr('labelTitle')}</span>
      <div className="label-row">
        <input id="label-name" placeholder={tr('labelNamePh')} value={name} onChange={(e) => setName(e.target.value)} />
        <select id="label-kind" aria-label={tr('labelKind')} value={kind} onChange={(e) => setKind(e.target.value as LabelKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_ICON[k]} {tr(`kind_${k}` as Parameters<typeof tr>[0])}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!name.trim()} onClick={() => onLabel(party, { name: name.trim(), kind })}>
          {tr('save')}
        </button>
        {current && (
          <button className="link small" onClick={() => onLabel(party, null)}>
            {tr('remove')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Money-trail timeline from one party, forward in time. */
function TraceView(props: {
  start: string;
  links: Transaction[];
  book: AddressBook;
  graph: Graph;
  onTrace: (ids: string[] | null) => void;
  onSelect: (s: Selection | null) => void;
}) {
  const tr = useT();
  const { start, links, book, graph, onTrace, onSelect } = props;
  const [hops, setHops] = useState<Hop[] | null>(null);
  const edgeOf = (h: Hop) => graph.edges.find((e) => e.txIds.includes(h.tx.id))?.id;
  const run = () => {
    const h = traceFrom(start, links, book);
    setHops(h);
    onTrace(h.map(edgeOf).filter((x): x is string => !!x));
  };
  const name = (p: string) => displayName(p, book, shortAddress).text;
  const missing = hops ? nextToExport(hops) : [];
  if (!hops) {
    return (
      <button className="trace-btn" onClick={run}>
        🔎 {tr('traceBtn')}
      </button>
    );
  }
  return (
    <section className="trace">
      <div className="trace-head">
        <h3>🔎 {tr('traceTitle')}</h3>
        <button
          className="link small"
          onClick={() => {
            setHops(null);
            onTrace(null);
          }}
        >
          {tr('close')}
        </button>
      </div>
      <p className="small muted">{tr('traceHint')}</p>
      {hops.length === 0 ? (
        <p className="muted">{tr('traceNone')}</p>
      ) : (
        <ol className="hops">
          {hops.map((h, i) => {
            const eid = edgeOf(h);
            return (
              <li key={i} style={{ marginLeft: `${(h.depth - 1) * 16}px` }} className={h.stop ? `stop-${h.stop}` : ''}>
                <button className="hop" onClick={() => eid && onSelect({ kind: 'edge', id: eid })}>
                  <span className="hop-when small muted">
                    {(h.tx.time ?? h.tx.date).replace('T', ' ').replace(/:00Z$|Z$/, '')}
                    {h.gap && <b className={`gap ${h.gapHours !== null && h.gapHours < 1 ? 'fast' : ''}`}> +{gapText(h.gap, tr)}</b>}
                  </span>
                  <span className="hop-what">
                    {name(h.from)} → <b>{name(h.to)}</b>
                  </span>
                  <span className="num">{amountFmt(h.amount, h.unit)}</span>
                </button>
                {h.stop && h.stop !== 'seen' && <span className={`stop-tag ${h.stop}`}>{tr(`stop_${h.stop}` as Parameters<typeof tr>[0])}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {missing.length > 0 && (
        <div className="next-export">
          <b className="small">{tr('traceNext')}</b>
          {missing.map((a) => (
            <div key={a} className="addr-line">
              <code className="addr">{shortAddress(a)}</code>
              <CopyButton text={a} />
              {/^0x[0-9a-f]{40}$/.test(a) && (
                <a className="small" href={`https://etherscan.io/exportData?type=address&a=${a}`} target="_blank" rel="noopener noreferrer">
                  {tr('exportOnEtherscan')} ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
