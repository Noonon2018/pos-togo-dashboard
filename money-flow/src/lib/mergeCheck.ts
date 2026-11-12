/**
 * Safety check before merging counterparty names. Merging is the one action that silently changes
 * totals (e.g. ATM cash merged into a phone bill), so risky merges need a confirmation.
 */

export type MergeWarning =
  | { kind: 'none' }
  /** target is one of my own accounts: these names will count as own-account transfers, not spending */
  | { kind: 'toAccount'; names: string[] }
  /** names from different categories end up together */
  | { kind: 'crossCategory'; items: { name: string; category: string }[]; target: string; targetCategory: string | null };

/**
 * @param categoryOfName main category of a current name, or null if that name doesn't exist yet
 */
export function mergeWarning(
  froms: string[],
  to: string,
  categoryOfName: (name: string) => string | null,
  accounts: string[],
): MergeWarning {
  const target = to.trim();
  const sources = froms.filter((f) => f !== target);
  if (!target || sources.length === 0) return { kind: 'none' };

  if (accounts.some((a) => a.toUpperCase() === target.toUpperCase())) {
    const notTransfers = sources.filter((n) => categoryOfName(n) !== 'transfer');
    return notTransfers.length ? { kind: 'toAccount', names: notTransfers } : { kind: 'none' };
  }

  const targetCategory = categoryOfName(target);
  const items = sources.map((name) => ({ name, category: categoryOfName(name) ?? 'other' }));
  const cats = new Set(items.map((i) => i.category));
  if (targetCategory) cats.add(targetCategory);
  // 'other' means "unknown" — merging an unknown shop into a known one is the normal clean-up case
  cats.delete('other');
  return cats.size > 1 ? { kind: 'crossCategory', items, target, targetCategory } : { kind: 'none' };
}

/** Is `to` an existing name (merge) or a new one (rename)? */
export function mergeKind(to: string, existingNames: Set<string>, accounts: string[]): 'merge' | 'rename' | 'account' {
  const t = to.trim();
  if (accounts.some((a) => a.toUpperCase() === t.toUpperCase())) return 'account';
  return existingNames.has(t) ? 'merge' : 'rename';
}
