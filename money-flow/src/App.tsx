import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GraphView, { type GraphHandle, type Selection } from './components/GraphView';
import ImportDialog, { type PendingFile } from './components/ImportDialog';
import SidePanel from './components/SidePanel';
import { buildGraph, filterTransactions } from './lib/aggregate';
import { download, summaryCsv, transactionsCsv } from './lib/exportCsv';
import { renameCounterparty, unmerge } from './lib/rename';
import { loadAliases, loadProfiles, saveAliases, saveProfiles } from './lib/storage';
import { DEFAULT_FILTERS, type BankProfile, type Filters, type Transaction } from './lib/types';

const sampleFiles = import.meta.glob('../samples/*.csv', { query: '?raw', import: 'default' });

export default function App() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [queue, setQueue] = useState<PendingFile[]>([]);
  const [profiles, setProfiles] = useState<BankProfile[]>(loadProfiles);
  const [aliases, setAliases] = useState(loadAliases);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  const graphRef = useRef<GraphHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveAliases(aliases), [aliases]);
  useEffect(() => saveProfiles(profiles), [profiles]);

  const accounts = useMemo(() => [...new Set(txns.map((t) => t.account))].sort(), [txns]);
  const filtered = useMemo(() => filterTransactions(txns, filters), [txns, filters]);
  const graph = useMemo(() => buildGraph(txns, aliases, filters), [txns, aliases, filters]);
  const dateBounds = useMemo(() => {
    const ds = txns.map((t) => t.date).sort();
    return { min: ds[0] ?? '', max: ds[ds.length - 1] ?? '' };
  }, [txns]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files].filter((f) => /\.csv$/i.test(f.name) || f.type.includes('csv') || f.type === 'text/plain');
    const read = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
    if (read.length) setQueue((q) => [...q, ...read]);
    else setStatus('Only .csv files are supported — export CSV from your bank website.');
  }, []);

  const loadSamples = async () => {
    const entries = await Promise.all(
      Object.entries(sampleFiles).map(async ([path, load]) => ({ name: path.split('/').pop()!, text: (await load()) as string })),
    );
    setQueue((q) => [...q, ...entries]);
  };

  const finishImport = (newTx: Transaction[], profile: BankProfile | null) => {
    const file = queue[0];
    setTxns((cur) => {
      const ids = new Set(cur.map((t) => t.id));
      const fresh = newTx.filter((t) => !ids.has(t.id));
      const skipped = newTx.length - fresh.length;
      setStatus(`Imported ${fresh.length} from ${file.name}${skipped ? ` · ${skipped} already loaded (skipped)` : ''}`);
      return [...cur, ...fresh];
    });
    if (profile) setProfiles((ps) => [...ps.filter((p) => p.signature !== profile.signature && p.name !== profile.name), profile]);
    setQueue((q) => q.slice(1));
  };

  const rename = (from: string, to: string) =>
    setAliases((a) => renameCounterparty(a, new Set(txns.map((t) => t.counterparty)), from, to));

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const stamp = new Date().toISOString().slice(0, 10);

  const exportPng = () => {
    const blob = graphRef.current?.png();
    if (blob) download(`money-flow-${stamp}.png`, blob);
  };

  const clearAll = () => {
    if (!confirm('Remove all loaded transactions from this tab? (Bank layouts and renames are kept.)')) return;
    setTxns([]);
    setSelection(null);
    setFilters(DEFAULT_FILTERS);
    setStatus('');
  };

  const resetNames = () => {
    if (confirm('Forget all renames/merges?')) setAliases({});
  };

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <h1>Money Flow</h1>
        <button className="primary" onClick={() => fileInput.current?.click()}>
          + Add CSV
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {txns.length > 0 && (
          <>
            <span className="muted small">
              {txns.length} txns · {accounts.length} accounts · {graph.nodes.length} nodes
            </span>
            <span className="spacer" />
            <button onClick={() => graphRef.current?.fit()}>Fit</button>
            <button onClick={() => graphRef.current?.relayout()}>Re-layout</button>
            <button onClick={exportPng}>PNG</button>
            <button onClick={() => download(`money-flow-summary-${stamp}.csv`, summaryCsv(filtered, aliases))}>Summary CSV</button>
            <button onClick={() => download(`money-flow-transactions-${stamp}.csv`, transactionsCsv(filtered, aliases))}>Txns CSV</button>
            <button onClick={resetNames} title="Forget all renames/merges">
              Reset names
            </button>
            <button className="danger" onClick={clearAll}>
              Clear
            </button>
          </>
        )}
      </header>

      {txns.length > 0 && (
        <div className="filters">
          <label>
            From <input type="date" min={dateBounds.min} max={dateBounds.max} value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          </label>
          <label>
            To <input type="date" min={dateBounds.min} max={dateBounds.max} value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
          </label>
          <label>
            Min $ <input type="number" min={0} step={10} value={filters.minAmount || ''} placeholder="0" onChange={(e) => set({ minAmount: Number(e.target.value) || 0 })} />
          </label>
          <label>
            Flow
            <select value={filters.direction} onChange={(e) => set({ direction: e.target.value as Filters['direction'] })}>
              <option value="all">In &amp; out</option>
              <option value="in">Money in only</option>
              <option value="out">Money out only</option>
            </select>
          </label>
          <label title="Show only the N largest counterparties; the rest are grouped into OTHER (0 = show all)">
            Top N <input type="number" min={0} step={5} value={filters.topN} onChange={(e) => set({ topN: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <span className="acct-chips">
            {accounts.map((a) => {
              const on = filters.accounts.length === 0 || filters.accounts.includes(a);
              return (
                <button
                  key={a}
                  className={`chip ${on ? 'on' : ''}`}
                  onClick={() => {
                    const cur = filters.accounts.length ? filters.accounts : accounts;
                    const next = on ? cur.filter((x) => x !== a) : [...cur, a];
                    set({ accounts: next.length === accounts.length ? [] : next });
                  }}
                >
                  {a}
                </button>
              );
            })}
          </span>
          {(filters.from || filters.to || filters.minAmount || filters.direction !== 'all' || filters.accounts.length > 0) && (
            <button className="link" onClick={() => setFilters({ ...DEFAULT_FILTERS, topN: filters.topN })}>
              reset filters
            </button>
          )}
        </div>
      )}

      {status && (
        <div className="status" onClick={() => setStatus('')}>
          {status}
        </div>
      )}

      {txns.length === 0 ? (
        <main className="empty">
          <div className="empty-card">
            <h2>Map where your money goes</h2>
            <p>
              Drop one or more bank / credit-card <b>CSV exports</b> here (or click <b>+ Add CSV</b>). Each file is one account; add several
              to see transfers between your own accounts.
            </p>
            <ul>
              <li>Everything runs in this browser tab. Nothing is uploaded; the production build blocks all network requests.</li>
              <li>Only column layouts and renames are saved in this browser. Transactions are gone when you close the tab.</li>
              <li>Keep real statements in the <code>data/</code> folder (git-ignored).</li>
            </ul>
            <button onClick={loadSamples}>Try with anonymized sample files</button>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <GraphView ref={graphRef} graph={graph} selected={selection} onSelect={setSelection} />
          <SidePanel
            txns={filtered}
            aliases={aliases}
            graph={graph}
            accounts={accounts}
            selection={selection}
            onSelect={setSelection}
            onRename={rename}
            onUnmerge={(r) => setAliases((a) => unmerge(a, r))}
          />
          <div className="legend">
            <span>
              <i className="sw acct" /> your account
            </span>
            <span>
              <i className="sw in" /> money in
            </span>
            <span>
              <i className="sw out" /> money out
            </span>
            <span>
              <i className="sw xfer" /> own-account transfer
            </span>
            <span className="muted">edge label = count / total</span>
          </div>
        </main>
      )}

      {queue.length > 0 && (
        <ImportDialog
          key={`${queue[0].name}-${queue.length}`}
          file={queue[0]}
          remaining={queue.length - 1}
          profiles={profiles}
          accounts={accounts}
          onImport={finishImport}
          onSkip={() => setQueue((q) => q.slice(1))}
        />
      )}
    </div>
  );
}
