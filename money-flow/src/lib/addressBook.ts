import Papa from 'papaparse';
import { isCryptoAddress } from './csv';

/**
 * Address book: human names for addresses (and any other party names), kept on this computer.
 * Sources: a CSV you write once (address, name, type), name tags inside explorer exports,
 * and labels you set by clicking a dot in the graph.
 */

export type LabelKind = 'mine' | 'person' | 'shop' | 'exchange' | 'mixer' | 'bridge' | 'contract' | 'other';

export interface Label {
  name: string;
  kind: LabelKind;
}

export type AddressBook = Record<string, Label>;

export const KIND_ICON: Record<LabelKind, string> = {
  mine: '🔑',
  person: '👤',
  shop: '🏪',
  exchange: '🏦',
  mixer: '🌀',
  bridge: '🌉',
  contract: '📜',
  other: '🏷️',
};

export const KINDS: LabelKind[] = ['mine', 'person', 'shop', 'exchange', 'mixer', 'bridge', 'contract', 'other'];

/** Same key the graph uses: hex addresses in lower case, other names trimmed/upper-cased like party names. */
export function bookKey(v: string): string {
  const t = v.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase();
  if (isCryptoAddress(t)) return t;
  return t.replace(/\s+/g, ' ').toUpperCase();
}

/** Guess a kind from a name tag ("Binance 14" → exchange, "Tornado.Cash: Router" → mixer). */
export function kindFromName(name: string): LabelKind {
  const n = name.toLowerCase();
  if (/tornado|mixer|mixing|blender|sinbad|wasabi|samourai|railgun/.test(n)) return 'mixer';
  if (/bridge|wormhole|stargate|across|hop protocol|multichain|synapse|layerzero|portal/.test(n)) return 'bridge';
  if (/binance|coinbase|kraken|okx|okex|bybit|kucoin|gemini|bitfinex|huobi|htx|crypto\.com|bitstamp|gate\.io|upbit|bithumb|bitkub|robinhood|exchange|hot wallet|deposit/.test(n)) return 'exchange';
  if (/uniswap|sushiswap|curve|1inch|0x: |router|pool|vault|contract|aave|compound|lido|weth|usdc|usdt|dai|token|nft|opensea/.test(n)) return 'contract';
  return 'other';
}

const KIND_WORDS: [RegExp, LabelKind][] = [
  [/^(mine|me|my|ของฉัน|ฉัน|ตัวเอง)$/i, 'mine'],
  [/^(person|people|friend|คน|บุคคล|เพื่อน)$/i, 'person'],
  [/^(shop|store|merchant|ร้าน|ร้านค้า)$/i, 'shop'],
  [/^(exchange|cex|ตลาด|กระดานเทรด|exchange-like)$/i, 'exchange'],
  [/^(mixer|tumbler|มิกเซอร์|เครื่องปั่น)$/i, 'mixer'],
  [/^(bridge|บริดจ์|สะพาน)$/i, 'bridge'],
  [/^(contract|dex|defi|สัญญา)$/i, 'contract'],
];

export function parseKind(v: string | undefined, name: string): LabelKind {
  const t = (v ?? '').trim();
  for (const [re, k] of KIND_WORDS) if (re.test(t)) return k;
  return kindFromName(name);
}

/** Is this CSV an address book? (an address column and a name column, but no amount column) */
export function isAddressBookCsv(text: string): boolean {
  const head = Papa.parse<string[]>(text.replace(/^﻿/, ''), { preview: 1 }).data[0] ?? [];
  const h = head.map((x) => (x ?? '').trim().toLowerCase());
  const hasAddr = h.some((x) => /^(address|addr|wallet|party|ที่อยู่|address กระเป๋า|ชื่อในรายการ|ชื่อบัญชี|บัญชี)$/.test(x));
  const hasName = h.some((x) => /^(name|label|tag|name ?tag|display ?name|ชื่อ|ป้าย|ชื่อที่แสดง|ชื่อเรียก)$/.test(x));
  const hasMoney = h.some((x) => /amount|value|จำนวน|ยอด|debit|credit/.test(x));
  return hasAddr && hasName && !hasMoney;
}

/** Parse "address,name,type[,note]" (English or Thai headers). Rows without an address or name are ignored. */
export function parseAddressBook(text: string): AddressBook {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data;
  const head = (rows[0] ?? []).map((x) => (x ?? '').trim().toLowerCase());
  const iA = head.findIndex((x) => /^(address|addr|wallet|party|ที่อยู่|address กระเป๋า|ชื่อในรายการ|ชื่อบัญชี|บัญชี)$/.test(x));
  const iN = head.findIndex((x) => /^(name|label|tag|name ?tag|display ?name|ชื่อ|ป้าย|ชื่อที่แสดง|ชื่อเรียก)$/.test(x));
  const iK = head.findIndex((x) => /^(type|kind|category|ประเภท|ชนิด)$/.test(x));
  const book: AddressBook = {};
  if (iA < 0 || iN < 0) return book;
  for (const r of rows.slice(1)) {
    const addr = (r[iA] ?? '').trim();
    const name = (r[iN] ?? '').trim();
    if (!addr || !name) continue;
    book[bookKey(addr)] = { name, kind: parseKind(iK >= 0 ? r[iK] : '', name) };
  }
  return book;
}

/** Name tags found inside an explorer export → labels (kind guessed from the tag). */
export function labelsFromTags(tags: Record<string, string>): AddressBook {
  const book: AddressBook = {};
  for (const [addr, name] of Object.entries(tags)) book[bookKey(addr)] = { name, kind: kindFromName(name) };
  return book;
}

export function addressBookCsv(book: AddressBook): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['address,name,type'];
  for (const [a, l] of Object.entries(book).sort((x, y) => x[1].name.localeCompare(y[1].name))) lines.push([a, l.name, l.kind].map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** What to show for a party: its label, or a shortened address. */
export function displayName(raw: string, book: AddressBook, short: (v: string) => string): { text: string; label?: Label } {
  const label = book[bookKey(raw)];
  return label ? { text: `${KIND_ICON[label.kind]} ${label.name}`, label } : { text: short(raw) };
}
