import { useMemo, useState } from 'react';
import { applyMapping, guessMapping, headerSignature, parseCsvText, type ParsedCsv } from '../lib/csv';
import type { StatementResult } from '../lib/pdfStatement';
import type { BankProfile, ColumnMapping, Transaction } from '../lib/types';
import { money } from '../format';

export interface PendingFile {
  name: string;
  text: string;
  /** Set for PDF statements: rows already extracted, plus the reconciliation check. */
  pdf?: StatementResult;
}

interface Props {
  file: PendingFile;
  remaining: number;
  profiles: BankProfile[];
  accounts: string[];
  onImport: (txns: Transaction[], profile: BankProfile | null) => void;
  onSkip: () => void;
}

const accountFromFile = (name: string) =>
  name
    .replace(/\.csv$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Column-mapping step for one CSV. Auto-applies a saved bank profile when the header matches. */
export default function ImportDialog({ file, remaining, profiles, accounts, onImport, onSkip }: Props) {
  const initial = useMemo(() => {
    if (file.pdf) {
      const p = file.pdf.parsed;
      return { mapping: { ...guessMapping(p.headers, true, p.rows), dateFormat: 'YMD' as const }, profileName: '' };
    }
    const withHeader = parseCsvText(file.text, true);
    const sig = headerSignature(withHeader.headers);
    const prof = profiles.find((p) => p.signature === sig);
    if (prof) return { mapping: prof.mapping, profileName: prof.name };
    // no profile: a header row normally has no digits; bank rows always do
    const looksHeaderless = withHeader.headers.some((h) => /\d/.test(h));
    const p = parseCsvText(file.text, !looksHeaderless);
    return { mapping: guessMapping(p.headers, !looksHeaderless, p.rows), profileName: '' };
  }, [file, profiles]);

  const [mapping, setMapping] = useState<ColumnMapping>(initial.mapping);
  const [account, setAccount] = useState(file.pdf?.suggestedAccount || accountFromFile(file.name));
  const [profileName, setProfileName] = useState(initial.profileName || accountFromFile(file.name));
  const [saveProfile, setSaveProfile] = useState(!initial.profileName && !file.pdf);

  const parsed: ParsedCsv = useMemo(
    () => file.pdf?.parsed ?? parseCsvText(file.text, mapping.hasHeader),
    [file.pdf, file.text, mapping.hasHeader],
  );
  const result = useMemo(
    () => applyMapping(parsed, mapping, account.trim() || 'Account', file.name),
    [parsed, mapping, account, file.name],
  );

  const set = (patch: Partial<ColumnMapping>) => setMapping((m) => ({ ...m, ...patch }));
  const setHasHeader = (hasHeader: boolean) => {
    const p = parseCsvText(file.text, hasHeader);
    setMapping({ ...guessMapping(p.headers, hasHeader, p.rows), hasHeader });
  };

  const inflow = result.transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outflow = result.transactions.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const fatal = result.errors.find((e) => e.row === 0);

  const colSelect = (label: string, value: string | undefined, onChange: (v: string) => void, optional = false) => (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? '— none —' : '— choose —'}</option>
        {parsed.headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );

  const doImport = () => {
    const name = profileName.trim();
    const profile =
      saveProfile && name
        ? { name, signature: mapping.hasHeader ? headerSignature(parsed.headers) : `noheader:${parsed.headers.length}`, mapping }
        : null;
    onImport(result.transactions, profile);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Map CSV columns">
        <header className="modal-head">
          <div>
            <h2>Map columns</h2>
            <div className="muted">
              {file.name}
              {remaining > 0 && ` · ${remaining} more file(s) after this`}
            </div>
          </div>
          {initial.profileName && <span className="badge">Recognized: {initial.profileName}</span>}
        </header>

        <div className="grid-form">
          <label className="field">
            <span>Account name</span>
            <input list="acct-list" value={account} onChange={(e) => setAccount(e.target.value)} />
            <datalist id="acct-list">
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          {file.pdf ? (
            <PdfCheck pdf={file.pdf} />
          ) : (
            <label className="field check">
              <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              <span>First row is a header</span>
            </label>
          )}
          {colSelect('Date', mapping.date, (v) => set({ date: v }))}
          <label className="field">
            <span>Date format</span>
            <select value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as ColumnMapping['dateFormat'] })}>
              <option value="auto">Auto (MM/DD/YYYY or YYYY-MM-DD)</option>
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
              <option value="YMD">YYYY-MM-DD</option>
            </select>
          </label>
          {colSelect('Description', mapping.description, (v) => set({ description: v }))}
          <label className="field">
            <span>Amount layout</span>
            <select value={mapping.amountMode} onChange={(e) => set({ amountMode: e.target.value as ColumnMapping['amountMode'] })}>
              <option value="signed">One amount column (+/−)</option>
              <option value="debitCredit">Separate debit / credit columns</option>
            </select>
          </label>
          {mapping.amountMode === 'signed' ? (
            colSelect('Amount', mapping.amount, (v) => set({ amount: v }))
          ) : (
            <>
              {colSelect('Debit (money out)', mapping.debit, (v) => set({ debit: v || undefined }), true)}
              {colSelect('Credit (money in)', mapping.credit, (v) => set({ credit: v || undefined }), true)}
            </>
          )}
          <label className="field check wide">
            <input type="checkbox" checked={mapping.invert} onChange={(e) => set({ invert: e.target.checked })} />
            <span>
              Flip sign — tick this for credit cards that show <b>purchases as positive</b> (Amex, Discover, Citi…)
            </span>
          </label>
        </div>

        <div className="preview">
          <div className="preview-stats">
            <span>
              <b>{result.transactions.length}</b> transactions
            </span>
            <span className="in">In {money(inflow)}</span>
            <span className="out">Out {money(outflow)}</span>
            {result.errors.length > 0 && !fatal && <span className="warn">{result.errors.length} row(s) skipped</span>}
          </div>
          {fatal ? (
            <p className="warn">{fatal.reason}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>→ Counterparty</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.transactions.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td className="desc">{t.description}</td>
                    <td>
                      <b>{t.counterparty}</b>
                    </td>
                    <td className={`num ${t.amount < 0 ? 'out' : 'in'}`}>{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.errors.length > 0 && !fatal && (
            <details>
              <summary>Skipped rows</summary>
              <ul>
                {result.errors.slice(0, 20).map((e) => (
                  <li key={e.row}>
                    Line {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="muted small">
            Check: money <b>out</b> should be negative/red. If purchases show as green, tick “Flip sign”.
          </p>
        </div>

        <footer className="modal-foot">
          {file.pdf && (
            <span className="muted small">Same account name for every month = statements are combined (overlaps are skipped).</span>
          )}
          {!file.pdf && <>
          <label className="field check">
            <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
            <span>Remember this layout as bank</span>
          </label>
          <input
            className="profile-name"
            placeholder="e.g. Chase checking"
            value={profileName}
            disabled={!saveProfile}
            onChange={(e) => setProfileName(e.target.value)}
          />
          </>}
          <span className="spacer" />
          <button onClick={onSkip}>Skip file</button>
          <button className="primary" disabled={!!fatal || result.transactions.length === 0} onClick={doImport}>
            Import {result.transactions.length}
          </button>
        </footer>
      </div>
    </div>
  );
}

function PdfCheck({ pdf }: { pdf: StatementResult }) {
  const { info, reconcileDiff, balanceMismatches, hasBalance } = pdf;
  const ok = reconcileDiff === 0 && balanceMismatches === 0;
  return (
    <div className={`pdf-check ${ok ? 'ok' : 'bad'}`}>
      <b>{ok ? '✓ PDF reconciles' : reconcileDiff === null ? 'PDF: no balance totals found' : '⚠ PDF does not reconcile'}</b>
      {info.periodStart && (
        <div className="small">
          {info.periodStart} → {info.periodEnd}
        </div>
      )}
      {info.beginning !== null && info.ending !== null && (
        <div className="small">
          Beginning {money(info.beginning)} → ending {money(info.ending)}
          {reconcileDiff !== null && reconcileDiff !== 0 && <> · off by {money(reconcileDiff)}</>}
        </div>
      )}
      {balanceMismatches > 0 && <div className="small">{balanceMismatches} row(s) don't match the printed balance — check them below.</div>}
      {!hasBalance && <div className="small">No balance column (credit card?). If purchases show green, tick “Flip sign”.</div>}
    </div>
  );
}
