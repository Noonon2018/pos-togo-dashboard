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
