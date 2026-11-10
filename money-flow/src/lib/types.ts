/** One normalized transaction. amount > 0 = money INTO the account, < 0 = money OUT. */
export interface Transaction {
  id: string;
  /** Name of my account this row came from (e.g. "Chase Checking"). */
  account: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  description: string;
  amount: number;
  /** Auto-normalized counterparty key (before user aliases). */
  counterparty: string;
  /** Source file name, for traceability. */
  source: string;
  /**
   * Set for a flow between two OTHER parties (from a "from → to" file, e.g. A paid B).
   * Such rows only appear in the graph; they are not your income or spending.
   */
  link?: { from: string; to: string };
  /** Crypto unit (ETH, USDC, BTC…). Undefined = US dollars. Crypto never mixes into dollar totals. */
  unit?: string;
}

export type AmountMode = 'signed' | 'debitCredit';
export type DateFormat = 'auto' | 'MDY' | 'DMY' | 'YMD';

export interface ColumnMapping {
  hasHeader: boolean;
  date: string;
  description: string;
  amountMode: AmountMode;
  /** signed mode */
  amount?: string;
  /** debitCredit mode */
  debit?: string;
  credit?: string;
  /** Flip sign (credit-card exports often show purchases as positive). */
  invert: boolean;
  dateFormat: DateFormat;
  /** Lines to skip before the header row (title lines in Venmo-style exports). */
  skipRows?: number;
  /** 'fromTo' = each row says who paid whom (columns `from` and `to`). */
  flow?: 'account' | 'fromTo';
  from?: string;
  to?: string;
  /** Your own name/email as it appears in the from/to columns. Empty = all rows are between others. */
  me?: string;
  /** Crypto explorer file (Etherscan, Blockscout…): rows stay in coin units and are graph-only. */
  crypto?: boolean;
  /** Crypto files: a fixed unit (from a header like "Value_IN(ETH)") and/or a per-row symbol column. */
  unit?: string;
  unitCol?: string;
  /** Crypto files: status column; rows marked as errors/failed are skipped. */
  statusCol?: string;
  /** Crypto files: transaction hash, kept in the description for checking on the explorer. */
  hashCol?: string;
}

export interface BankProfile {
  name: string;
  /** Header signature used to auto-detect this bank on future uploads. */
  signature: string;
  mapping: ColumnMapping;
}

/** user alias map: normalized counterparty key -> display name (or an account name) */
export type Aliases = Record<string, string>;

export type Direction = 'all' | 'in' | 'out';

export interface Filters {
  from?: string;
  to?: string;
  minAmount: number;
  direction: Direction;
  /** Keep only the N largest counterparties by volume (0 = no limit). */
  topN: number;
  /** Restrict to these accounts (empty = all). */
  accounts: string[];
}

export const DEFAULT_FILTERS: Filters = {
  minAmount: 0,
  direction: 'all',
  topN: 40,
  accounts: [],
};
