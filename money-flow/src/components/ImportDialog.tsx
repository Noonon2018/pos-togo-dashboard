import { useMemo, useState } from 'react';
import { applyMapping, detectMe, findHeaderRow, guessMapping, headerSignature, looksLikeHeader, parseCsvText, shortAddress, type ParsedCsv } from '../lib/csv';
import type { StatementResult } from '../lib/pdfStatement';
import type { BankProfile, ColumnMapping, Transaction } from '../lib/types';
import { amountFmt, money } from '../format';
import { useT } from '../i18n';

export interface PendingFile {
  name: string;
  text: string;
  /** Set for PDF statements: rows already extracted, plus the reconciliation check. */
  pdf?: StatementResult;
  /** Suggested account name (sample files) */
  account?: string;
  /** the PDF was a scan: rows were read by OCR (check the numbers) */
  ocr?: boolean;
}

interface Props {
  file: PendingFile;
  remaining: number;
  profiles: BankProfile[];
  accounts: string[];
  onImport: (txns: Transaction[], links: Transaction[], profile: BankProfile | null, tags?: Record<string, string>) => void;
  onSkip: () => void;
}

const accountFromFile = (name: string) =>
  name
    .replace(/\.csv$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Column-mapping step for one CSV. Auto-applies a saved bank profile when the header matches. */
export default function ImportDialog({ file, remaining, profiles, accounts, onImport, onSkip }: Props) {
  const t = useT();
  const initial = useMemo(() => {
    if (file.pdf) {
      const p = file.pdf.parsed;
      return { mapping: { ...guessMapping(p.headers, true, p.rows), dateFormat: 'YMD' as const }, profileName: '' };
    }
    const skipRows = findHeaderRow(file.text); // title lines above the header (Venmo, PayPal)
    const withHeader = parseCsvText(file.text, true, skipRows);
    const sig = headerSignature(withHeader.headers);
    const prof = profiles.find((p) => p.signature === sig);
    if (prof) {
      // the owner's name differs per person: re-detect it rather than reuse the saved one
      const me = prof.mapping.flow === 'fromTo' && prof.mapping.from && prof.mapping.to ? detectMe(withHeader, prof.mapping.from, prof.mapping.to) : null;
      return { mapping: { ...prof.mapping, skipRows, ...(me ? { me } : {}) }, profileName: prof.name };
    }
    const hasHeader = looksLikeHeader(withHeader.headers);
    const p = parseCsvText(file.text, hasHeader, skipRows);
    return { mapping: { ...guessMapping(p.headers, hasHeader, p.rows), skipRows }, profileName: '' };
  }, [file, profiles]);

  const [mapping, setMapping] = useState<ColumnMapping>(initial.mapping);
  const [account, setAccount] = useState(file.account || file.pdf?.suggestedAccount || accountFromFile(file.name));
  const [profileName, setProfileName] = useState(initial.profileName || accountFromFile(file.name));
  const [saveProfile, setSaveProfile] = useState(!initial.profileName && !file.pdf);

  const parsed: ParsedCsv = useMemo(
    () => file.pdf?.parsed ?? parseCsvText(file.text, mapping.hasHeader, mapping.skipRows ?? 0),
    [file.pdf, file.text, mapping.hasHeader, mapping.skipRows],
  );
  const result = useMemo(
    () => applyMapping(parsed, mapping, account.trim() || 'Account', file.name),
    [parsed, mapping, account, file.name],
  );

  const set = (patch: Partial<ColumnMapping>) => setMapping((m) => ({ ...m, ...patch }));
  const setHasHeader = (hasHeader: boolean) => {
    const p = parseCsvText(file.text, hasHeader, mapping.skipRows ?? 0);
    setMapping({ ...guessMapping(p.headers, hasHeader, p.rows), hasHeader, skipRows: mapping.skipRows });
  };

  const isFromTo = mapping.flow === 'fromTo';
  // names that appear most in from/to — candidates for "your name in this file"
  const topNames = useMemo(() => {
    if (!isFromTo) return [];
    const iF = parsed.headers.indexOf(mapping.from ?? '');
    const iT = parsed.headers.indexOf(mapping.to ?? '');
    const c = new Map<string, number>();
    for (const r of parsed.rows) for (const i of [iF, iT]) if (i >= 0 && r[i]) c.set(r[i].toUpperCase().trim(), (c.get(r[i].toUpperCase().trim()) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
  }, [isFromTo, parsed, mapping.from, mapping.to]);
  // crypto: totals into / out of your wallet, per coin
  const walletTotals = useMemo(() => {
    const m = new Map<string, { in: number; out: number }>();
    for (const l of result.links) {
      if (!l.unit || !l.link) continue;
      const v = m.get(l.unit) ?? m.set(l.unit, { in: 0, out: 0 }).get(l.unit)!;
      if (l.link.to === l.account) v.in += -l.amount;
      if (l.link.from === l.account) v.out += -l.amount;
    }
    return [...m.entries()];
  }, [result.links]);
  const inflow = result.transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outflow = result.transactions.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const fatal = result.errors.find((e) => e.row === 0);

  const colSelect = (label: string, value: string | undefined, onChange: (v: string) => void, optional = false) => (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ? t('none') : t('choose')}</option>
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
    onImport(result.transactions, result.links, profile, result.labels);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Map CSV columns">
        <header className="modal-head">
          <div>
            <h2>{t('mapTitle')}</h2>
            <div className="muted">
              {file.name}
              {remaining > 0 && t('moreFiles', { n: remaining })}
            </div>
          </div>
          {initial.profileName && <span className="badge">{t('recognized', { p: initial.profileName })}</span>}
        </header>

        <div className="grid-form">
          <label className="field" hidden={!!mapping.crypto}>
            <span>{t('accountName')}</span>
            <input list="acct-list" value={account} onChange={(e) => setAccount(e.target.value)} />
            <span className="field-hint">{t('accountHint')}</span>
            <datalist id="acct-list">
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          {file.pdf ? (
            <PdfCheck pdf={file.pdf} ocr={file.ocr} />
          ) : (
            <label className="field check">
              <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              <span>{t('headerRow')}</span>
            </label>
          )}
          {colSelect(t('date'), mapping.date, (v) => set({ date: v }))}
          <label className="field">
            <span>{t('dateFormat')}</span>
            <select value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as ColumnMapping['dateFormat'] })}>
              <option value="auto">{t('dfAuto')}</option>
              <option value="MDY">MM/DD/YYYY</option>
              <option value="DMY">DD/MM/YYYY</option>
              <option value="YMD">YYYY-MM-DD</option>
            </select>
          </label>
          {!file.pdf && (
            <label className="field wide">
              <span>{t('flowMode')}</span>
              <select id="flow-mode" value={mapping.flow ?? 'account'} onChange={(e) => set({ flow: e.target.value as ColumnMapping['flow'] })}>
                <option value="account">{t('flowAccount')}</option>
                <option value="fromTo">{t('flowFromTo')}</option>
              </select>
            </label>
          )}
          {mapping.crypto && <p className="crypto-banner wide">{t('cryptoDetected')}</p>}
          {isFromTo ? (
            <>
              {colSelect(t('fromCol'), mapping.from, (v) => set({ from: v || undefined }))}
              {colSelect(t('toCol'), mapping.to, (v) => set({ to: v || undefined }))}
              {mapping.amountMode === 'debitCredit' ? (
                <>
                  {colSelect(t('valueIn'), mapping.credit, (v) => set({ credit: v || undefined }), true)}
                  {colSelect(t('valueOut'), mapping.debit, (v) => set({ debit: v || undefined }), true)}
                </>
              ) : (
                colSelect(t('amount'), mapping.amount, (v) => set({ amount: v }))
              )}
              {colSelect(t('noteCol'), mapping.description, (v) => set({ description: v }), true)}
              {mapping.crypto && (
                <label className="field">
                  <span>{t('unitLabel')}</span>
                  <input id="coin-unit" value={mapping.unit ?? ''} placeholder="ETH" onChange={(e) => set({ unit: e.target.value.toUpperCase() })} />
                  <span className="field-hint">{mapping.unitCol ? t('unitFromCol', { c: mapping.unitCol }) : t('unitHint')}</span>
                </label>
              )}
              <label className="field wide">
                <span>{mapping.crypto ? t('meWalletLabel') : t('meLabel')}</span>
                <input id="me-name" list="me-list" value={mapping.me ?? ''} placeholder={t('mePh')} onChange={(e) => set({ me: e.target.value })} />
                <datalist id="me-list">
                  {topNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <span className="field-hint">{t('meHint')}</span>
              </label>
            </>
          ) : (
          <>
          {colSelect(t('description'), mapping.description, (v) => set({ description: v }))}
          <label className="field">
            <span>{t('amountLayout')}</span>
            <select value={mapping.amountMode} onChange={(e) => set({ amountMode: e.target.value as ColumnMapping['amountMode'] })}>
              <option value="signed">{t('signed')}</option>
              <option value="debitCredit">{t('debitCredit')}</option>
            </select>
          </label>
          {mapping.amountMode === 'signed' ? (
            colSelect(t('amount'), mapping.amount, (v) => set({ amount: v }))
          ) : (
            <>
              {colSelect(t('debit'), mapping.debit, (v) => set({ debit: v || undefined }), true)}
              {colSelect(t('credit'), mapping.credit, (v) => set({ credit: v || undefined }), true)}
            </>
          )}
          <label className="field check wide">
            <input type="checkbox" checked={mapping.invert} onChange={(e) => set({ invert: e.target.checked })} />
            <span>
              {t('flip')}
            </span>
          </label>
          </>
          )}
          {!file.pdf && (mapping.skipRows ?? 0) > 0 && <p className="small muted wide">{t('skippedTitleRows', { n: mapping.skipRows ?? 0 })}</p>}
        </div>

        <div className="preview">
          <div className="preview-stats">
            {!mapping.crypto && (
              <span>
                <b>{t('txCount', { n: result.transactions.length })}</b>
              </span>
            )}
            {isFromTo && !mapping.crypto && <span className="link-count">{t('linkCount', { n: result.links.length })}</span>}
            {mapping.crypto && (
              <span className="link-count">
                {t('cryptoCount', { n: result.links.length })}
                {walletTotals.map(([u, v]) => (
                  <span key={u}>
                    {' · '}
                    {t('walletIn', { v: amountFmt(v.in, u) })} · {t('walletOut', { v: amountFmt(v.out, u) })}
                  </span>
                ))}
              </span>
            )}
            {!mapping.crypto && (
              <>
                <span className="in">{t('in')} {money(inflow)}</span>
                <span className="out">{t('out')} {money(outflow)}</span>
              </>
            )}
            {result.errors.length > 0 && !fatal && <span className="warn">{t('rowsSkipped', { n: result.errors.length })}</span>}
          </div>
          {fatal ? (
            <p className="warn">{fatal.reason}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('date')}</th>
                  <th>{t('description')}</th>
                  <th>{t('colCounterparty')}</th>
                  <th className="num">{t('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {[...result.transactions.slice(0, 8), ...result.links.slice(0, isFromTo ? 6 : 0)].map((t) => (
                  <tr key={t.id}>
                    <td>{t.date}</td>
                    <td className="desc">{t.description}</td>
                    <td>
                      {t.link ? (
                        <span className="link-tag">
                          {shortAddress(t.link.from)} → {shortAddress(t.link.to)}
                        </span>
                      ) : (
                        <b>{t.counterparty}</b>
                      )}
                    </td>
                    <td className={`num ${t.link ? '' : t.amount < 0 ? 'out' : 'in'}`}>{amountFmt(t.link ? -t.amount : t.amount, t.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.errors.length > 0 && !fatal && (
            <details>
              <summary>{t('skippedRows')}</summary>
              <ul>
                {result.errors.slice(0, 20).map((e) => (
                  <li key={e.row}>
                    {t('line')} {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!isFromTo && <p className="muted small">{t('checkSign')}</p>}
        </div>

        <footer className="modal-foot">
          {file.pdf && (
            <span className="muted small">{t('pdfCombine')}</span>
          )}
          {!file.pdf && <>
          <label className="field check">
            <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
            <span>{t('remember')}</span>
          </label>
          <input
            className="profile-name"
            placeholder={t('profilePh')}
            value={profileName}
            disabled={!saveProfile}
            onChange={(e) => setProfileName(e.target.value)}
          />
          </>}
          <span className="spacer" />
          <button onClick={onSkip}>{t('skipFile')}</button>
          <button className="primary" disabled={!!fatal || result.transactions.length + result.links.length === 0} onClick={doImport}>
            {t('importN', { n: result.transactions.length + result.links.length })}
          </button>
        </footer>
      </div>
    </div>
  );
}

function PdfCheck({ pdf, ocr }: { pdf: StatementResult; ocr?: boolean }) {
  const t = useT();
  const { info, reconcileDiff, balanceMismatches, hasBalance } = pdf;
  const ok = reconcileDiff === 0 && balanceMismatches === 0;
  return (
    <div className={`pdf-check ${ok ? 'ok' : 'bad'}`}>
      <b>{ok ? t('pdfOk') : reconcileDiff === null ? t('pdfNoTotals') : t('pdfBad')}</b>
      {info.periodStart && (
        <div className="small">
          {info.periodStart} → {info.periodEnd}
        </div>
      )}
      {info.beginning !== null && info.ending !== null && (
        <div className="small">
          {t('begEnd', { b: money(info.beginning), e: money(info.ending) })}
          {reconcileDiff !== null && reconcileDiff !== 0 && t('offBy', { d: money(reconcileDiff) })}
        </div>
      )}
      {balanceMismatches > 0 && <div className="small">{t('pdfMismatch', { n: balanceMismatches })}</div>}
      {!hasBalance && <div className="small">{t('pdfNoBalance')}</div>}
      {ocr && <div className="small ocr-note">📷 {ok ? t('ocrOk') : t('ocrCheck')}</div>}
    </div>
  );
}
