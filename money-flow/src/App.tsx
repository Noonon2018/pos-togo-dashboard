import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GraphView, { type GraphHandle, type Selection } from './components/GraphView';
import ImportDialog, { type PendingFile } from './components/ImportDialog';
import SidePanel from './components/SidePanel';
import HelpDialog from './components/HelpDialog';
import SummaryView from './components/SummaryView';
import { categorize } from './lib/categories';
import { useLang, useT } from './i18n';
import { buildGraph, filterTransactions } from './lib/aggregate';
import { parseStatementLines } from './lib/pdfStatement';
import { download, summaryCsv, transactionsCsv } from './lib/exportCsv';
import { renameCounterparty, unmerge } from './lib/rename';
import { loadAliases, loadCategoryOverrides, loadProfiles, saveAliases, saveCategoryOverrides, saveProfiles } from './lib/storage';
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
  const [showHelp, setShowHelp] = useState(false);
  const [view, setView] = useState<'summary' | 'graph'>('summary');
  const [overrides, setOverrides] = useState(loadCategoryOverrides);
  const t = useT();
  const { lang, setLang } = useLang();
  const graphRef = useRef<GraphHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveAliases(aliases), [aliases]);
  useEffect(() => saveProfiles(profiles), [profiles]);
  useEffect(() => saveCategoryOverrides(overrides), [overrides]);

  const accounts = useMemo(() => [...new Set(txns.map((t) => t.account))].sort(), [txns]);
  const filtered = useMemo(() => filterTransactions(txns, filters), [txns, filters]);
  const graph = useMemo(() => buildGraph(txns, aliases, filters), [txns, aliases, filters]);
  const categorized = useMemo(() => categorize(txns, aliases, overrides), [txns, aliases, overrides]);
  const dateBounds = useMemo(() => {
    const ds = txns.map((t) => t.date).sort();
    return { min: ds[0] ?? '', max: ds[ds.length - 1] ?? '' };
  }, [txns]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const all = [...files];
    const csvs = all.filter((f) => /\.(csv|txt)$/i.test(f.name) || f.type.includes('csv'));
    const pdfs = all.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    const read: PendingFile[] = await Promise.all(csvs.map(async (f) => ({ name: f.name, text: await f.text() })));
    const problems: string[] = [];
    if (pdfs.length) {
      setStatus(t('readingPdf', { n: pdfs.length }));
      const { pdfToLines } = await import('./lib/pdfText');
      for (const f of pdfs) {
        try {
          const pdf = parseStatementLines(await pdfToLines(await f.arrayBuffer()));
          if (pdf.parsed.rows.length) read.push({ name: f.name, text: '', pdf });
          else problems.push(t('pdfNoTx', { f: f.name }));
        } catch (e) {
          problems.push(t('pdfError', { f: f.name, e: e instanceof Error ? e.message : 'error' }));
        }
      }
    }
    // oldest statement first so the account name from the first one is reused for the rest
    read.sort((a, b) => (a.pdf?.info.periodStart ?? a.name).localeCompare(b.pdf?.info.periodStart ?? b.name));
    if (read.length) setQueue((q) => [...q, ...read]);
    if (problems.length) setStatus(problems.join(' · '));
    else if (!read.length) setStatus(t('unsupported'));
    else if (pdfs.length) setStatus('');
  }, [t]);

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
      setStatus(t('imported', { n: fresh.length, f: file.name }) + (skipped ? t('alreadyLoaded', { n: skipped }) : ''));
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
    if (!confirm(t('confirmClear'))) return;
    setTxns([]);
    setSelection(null);
    setFilters(DEFAULT_FILTERS);
    setStatus('');
  };

  const resetNames = () => {
    if (confirm(t('confirmResetNames'))) setAliases({});
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
          {t('addFile')}
        </button>
        <button onClick={() => setShowHelp(true)}>❓ {t('help')}</button>
        <button className="lang" onClick={() => setLang(lang === 'th' ? 'en' : 'th')} title="ภาษา / Language">
          🌐 {t('lang')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.pdf,text/csv,application/pdf"
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
              {t('stats', { t: txns.length, a: accounts.length, n: graph.nodes.length })}
            </span>
            <span className="spacer" />
            {view === 'graph' && (
              <>
                <button onClick={() => graphRef.current?.fit()}>{t('fit')}</button>
                <button onClick={() => graphRef.current?.relayout()}>{t('relayout')}</button>
                <button onClick={exportPng}>{t('png')}</button>
              </>
            )}
            <button onClick={() => download(`money-flow-summary-${stamp}.csv`, summaryCsv(filtered, aliases))}>{t('summaryCsv')}</button>
            <button onClick={() => download(`money-flow-transactions-${stamp}.csv`, transactionsCsv(filtered, aliases))}>{t('txnsCsv')}</button>
            <button onClick={resetNames} title={t('resetNamesTitle')}>
              {t('resetNames')}
            </button>
            <button className="danger" onClick={clearAll}>
              {t('clear')}
            </button>
          </>
        )}
      </header>

      {txns.length > 0 && (
        <nav className="views">
          <button className={view === 'summary' ? 'active' : ''} onClick={() => setView('summary')}>
            {t('viewSummary')}
          </button>
          <button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>
            {t('viewGraph')}
          </button>
        </nav>
      )}

      {txns.length > 0 && view === 'graph' && (
        <div className="filters">
          <label>
            {t('from')} <input type="date" min={dateBounds.min} max={dateBounds.max} value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          </label>
          <label>
            {t('to')} <input type="date" min={dateBounds.min} max={dateBounds.max} value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
          </label>
          <label>
            {t('minAmt')} <input type="number" min={0} step={10} value={filters.minAmount || ''} placeholder="0" onChange={(e) => set({ minAmount: Number(e.target.value) || 0 })} />
          </label>
          <label>
            {t('flow')}
            <select value={filters.direction} onChange={(e) => set({ direction: e.target.value as Filters['direction'] })}>
              <option value="all">{t('flowAll')}</option>
              <option value="in">{t('flowIn')}</option>
              <option value="out">{t('flowOut')}</option>
            </select>
          </label>
          <label title={t('topNTitle')}>
            {t('topN')} <input type="number" min={0} step={5} value={filters.topN} onChange={(e) => set({ topN: Math.max(0, Number(e.target.value) || 0) })} />
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
              {t('resetFilters')}
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
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptyBody')}</p>
            <div className="empty-actions">
              <button className="primary" onClick={() => fileInput.current?.click()}>
                {t('addFile')}
              </button>
              <button onClick={() => setShowHelp(true)}>📖 {t('openHelp')}</button>
              <button onClick={loadSamples}>{t('trySamples')}</button>
            </div>
            <ul>
              <li>{t('empty1')}</li>
              <li>{t('empty2')}</li>
              <li>{t('empty3')}</li>
            </ul>
          </div>
        </main>
      ) : view === 'summary' ? (
        <main className="summary-main">
          <SummaryView
            txns={categorized}
            aliases={aliases}
            overrides={overrides}
            onOverride={(name, id) =>
              setOverrides((o) => {
                const next = { ...o };
                if (id) next[name] = id;
                else delete next[name];
                return next;
              })
            }
            onResetOverrides={() => setOverrides({})}
          />
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
              <i className="sw acct" /> {t('legAcct')}
            </span>
            <span>
              <i className="sw in" /> {t('legIn')}
            </span>
            <span>
              <i className="sw out" /> {t('legOut')}
            </span>
            <span>
              <i className="sw xfer" /> {t('legXfer')}
            </span>
            <span className="muted">{t('legEdge')}</span>
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
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
