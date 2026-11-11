import type { Aliases, BankProfile } from './types';

// Only settings live in localStorage (column mappings + renames). Transactions stay in memory
// and disappear when the tab closes.
const PROFILES = 'moneyflow.bankProfiles.v1';
const ALIASES = 'moneyflow.aliases.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}

export const loadProfiles = () => read<BankProfile[]>(PROFILES, []);
export const saveProfiles = (p: BankProfile[]) => write(PROFILES, p);
export const loadAliases = () => read<Aliases>(ALIASES, {});
export const saveAliases = (a: Aliases) => write(ALIASES, a);

const CATS = 'moneyflow.categories.v1';
export const loadCategoryOverrides = () => read<Record<string, string>>(CATS, {});
export const saveCategoryOverrides = (o: Record<string, string>) => write(CATS, o);

// Budgets, emergency-fund goal and statement-cycle day. Small settings only; still no transactions.
const BUDGETS = 'moneyflow.budgets.v1';
const GOAL = 'moneyflow.goal.v1';
const CYCLE = 'moneyflow.cycle.v1';
export const loadBudgets = () => read<Record<string, number>>(BUDGETS, {});
export const saveBudgets = (b: Record<string, number>) => write(BUDGETS, b);
export const loadGoal = () => read<{ target: number; current: number }>(GOAL, { target: 0, current: 0 });
export const saveGoal = (g: { target: number; current: number }) => write(GOAL, g);
/** manual = the user picked the day themselves (don't auto-change it from PDFs any more) */
export const loadCycle = () => read<{ day: number; manual: boolean }>(CYCLE, { day: 1, manual: false });
export const saveCycle = (c: { day: number; manual: boolean }) => write(CYCLE, c);

// Address book: names you gave to addresses / parties (no amounts, no transactions).
const BOOK = 'moneyflow.addressbook.v1';
export const loadAddressBook = () => read<import('./addressBook').AddressBook>(BOOK, {});
export const saveAddressBook = (b: import('./addressBook').AddressBook) => write(BOOK, b);
