import type { Aliases } from './types';
import { resolveAlias } from './normalize';

/**
 * Point every key that currently resolves to `from` at `to` (rename, or merge into an existing
 * name). Aliases stay flat (key -> final name) so chains and cycles cannot build up.
 */
export function renameCounterparty(aliases: Aliases, rawKeys: Iterable<string>, from: string, to: string): Aliases {
  const target = to.trim();
  if (!target || target === from) return aliases;
  const next: Aliases = {};
  const keys = new Set([...rawKeys, ...Object.keys(aliases)]);
  for (const k of keys) {
    const cur = resolveAlias(k, aliases);
    const dest = cur === from ? target : cur;
    if (dest !== k) next[k] = dest;
  }
  // the new name is a final name: it must not alias onward
  delete next[target];
  if (from !== target && keys.has(from)) next[from] = target;
  return next;
}

/** Undo a merge for one raw key (it falls back to its auto-normalized name). */
export function unmerge(aliases: Aliases, rawKey: string): Aliases {
  const next = { ...aliases };
  delete next[rawKey];
  return next;
}
