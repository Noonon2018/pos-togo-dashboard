import type { Aliases, Transaction } from './types';
import { counterpartyName, ownAccountOf } from './aggregate';

/**
 * Automatic categories. Rules look at the normalized counterparty first, then the raw description.
 * The user can override any counterparty's category in the Summary page (stored locally).
 */

/** spend = real spending · invest = money moved into investments (not spending) · cash = ATM (unknown use)
 *  income = money in · transfer = between my own accounts */
export type CategoryKind = 'spend' | 'invest' | 'cash' | 'income' | 'transfer';

export interface Category {
  id: string;
  th: string;
  en: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  /** Charges here are subscriptions: used by insights (duplicate subscriptions, double billing). */
  subscription?: boolean;
}

export const CATEGORIES: Category[] = [
  { id: 'ai', th: 'AI', en: 'AI tools', icon: '🤖', color: '#7c3aed', kind: 'spend', subscription: true },
  { id: 'apps', th: 'สตรีมมิ่ง & แอป', en: 'Streaming & apps', icon: '📺', color: '#db2777', kind: 'spend', subscription: true },
  { id: 'games', th: 'เกม', en: 'Games', icon: '🎮', color: '#c026d3', kind: 'spend' },
  { id: 'phone', th: 'มือถือ & สาธารณูปโภค', en: 'Phone & utilities', icon: '📱', color: '#0891b2', kind: 'spend', subscription: true },
  { id: 'housing', th: 'ที่อยู่อาศัย', en: 'Housing', icon: '🏠', color: '#0d9488', kind: 'spend' },
  { id: 'insurance', th: 'ประกัน', en: 'Insurance', icon: '🛡️', color: '#475569', kind: 'spend' },
  { id: 'grocery', th: 'ของชำ', en: 'Groceries', icon: '🛒', color: '#16a34a', kind: 'spend' },
  { id: 'convenience', th: 'ร้านสะดวกซื้อ', en: 'Convenience stores', icon: '🏪', color: '#65a30d', kind: 'spend' },
  { id: 'dining', th: 'อาหารนอกบ้าน & เดลิเวอรี่', en: 'Dining & delivery', icon: '🍜', color: '#ea580c', kind: 'spend' },
  { id: 'alcohol', th: 'เครื่องดื่มแอลกอฮอล์', en: 'Alcohol', icon: '🍺', color: '#b45309', kind: 'spend' },
  { id: 'shopping', th: 'ช้อปปิ้ง', en: 'Shopping', icon: '🛍️', color: '#e11d48', kind: 'spend' },
  { id: 'transport', th: 'เดินทาง & น้ำมัน', en: 'Transport & gas', icon: '🚗', color: '#2563eb', kind: 'spend' },
  { id: 'business', th: 'วัตถุดิบ & ค่าใช้จ่ายร้าน', en: 'Business supplies', icon: '🏭', color: '#92400e', kind: 'spend' },
  { id: 'payroll', th: 'เงินเดือนพนักงาน & ภาษี', en: 'Payroll & taxes', icon: '🧾', color: '#78350f', kind: 'spend' },
  { id: 'people', th: 'โอนให้คน', en: 'Paid to people', icon: '👤', color: '#4f46e5', kind: 'spend' },
  { id: 'fees', th: 'ค่าธรรมเนียม', en: 'Fees', icon: '🏦', color: '#991b1b', kind: 'spend' },
  { id: 'other', th: 'อื่นๆ', en: 'Other', icon: '📦', color: '#6b7280', kind: 'spend' },
  { id: 'cash', th: 'ถอนเงินสด', en: 'Cash withdrawals', icon: '💵', color: '#a16207', kind: 'cash' },
  { id: 'invest', th: 'ลงทุน / คริปโต', en: 'Investing / crypto', icon: '📈', color: '#0f766e', kind: 'invest' },
  { id: 'salary', th: 'เงินเดือน', en: 'Salary', icon: '💼', color: '#15803d', kind: 'income' },
  { id: 'deposit', th: 'ฝากเงิน / ยอดขาย', en: 'Deposits & sales', icon: '🏧', color: '#16a34a', kind: 'income' },
  { id: 'from_people', th: 'รับโอนจากคน', en: 'From people', icon: '🤝', color: '#22c55e', kind: 'income' },
  { id: 'refund', th: 'เงินคืน', en: 'Refunds', icon: '↩️', color: '#4ade80', kind: 'income' },
  { id: 'interest', th: 'ดอกเบี้ย', en: 'Interest', icon: '💰', color: '#86efac', kind: 'income' },
  { id: 'income_other', th: 'รายรับอื่นๆ', en: 'Other income', icon: '➕', color: '#bbf7d0', kind: 'income' },
  { id: 'transfer', th: 'โอนระหว่างบัญชีตัวเอง', en: 'Own transfers', icon: '🔁', color: '#a78bfa', kind: 'transfer' },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export const categoryOf = (id: string) => CATEGORY_BY_ID.get(id) ?? CATEGORY_BY_ID.get('other')!;

/** Spending rules, first match wins. Tested against "NAME | DESCRIPTION" (upper case). */
const SPEND_RULES: [RegExp, string][] = [
  [/OPENAI|CHATGPT|ANTHROPIC|CLAUDE|\bGROK\b|\bX\.AI\b|\bXAI\b|PERPLEXITY|MIDJOURNEY|GEMINI|COPILOT|CURSOR|\bG1AI|POE\.COM|CHARACTER\.AI|ELEVENLABS|RUNWAY/, 'ai'],
  [/NETFLIX|SPOTIFY|\bHULU\b|DISNEY|YOUTUBE|AMAZON PRIME|\bMAX\b|HBO|PARAMOUNT|PEACOCK|APPLE\b|ICLOUD|MICROSOFT|DROPBOX|ADOBE|AUDIBLE|PATREON/, 'apps'],
  [/HONOR OF KING|STEAM|PLAYSTATION|XBOX|NINTENDO|ROBLOX|RIOT|EPIC GAMES|GARENA|MEBMARKET|GOOGLE PLAY|MOBILE LEGENDS|PUBG|GENSHIN/, 'games'],
  [/VISIBLE|T-MOBILE|AT&T|VERIZON|MINT MOBILE|CRICKET|METRO BY|XFINITY|COMCAST|SPECTRUM|RELIANT|CENTERPOINT|TXU|ENTERGY|WATER|ENERGY|ELECTRIC/, 'phone'],
  [/PROPERTY|APARTMENT|\bRENT\b|MORTGAGE|\bHOA\b|PLAZA LLC|REALTY|LEASING/, 'housing'],
  [/STATE FARM|GEICO|PROGRESSIVE|ALLSTATE|INSURANCE|LEMONADE|USAA/, 'insurance'],
  [/SYSCO|RESTAURANT DEPOT|JETRO|WHOLESALE|US FOODS|CHEF'?S WAREHOUSE|WEBSTAURANT/, 'business'],
  [/GUSTO|\bADP\b|PAYCHEX|\bIRS\b|COMPTROLLER|TAX\b/, 'payroll'],
  [/H-E-B|\bHEB\b|KROGER|COSTCO|SAM'S CLUB|ALDI|WHOLE FOODS|TRADER JOE|99 RANCH|HONG KONG FOOD|ASIAN MARKET|ASIAN SUPERMARKET|MAYFAIR|SEAFOOD|GROCERY|SUPERMARKET|FIESTA/, 'grocery'],
  [/FOOD MART|\bMART\b|7-ELEVEN|7 ELEVEN|CIRCLE K|QUIKTRIP|\bQT\b|BUC-EE|STRIPES|VALERO|SHELL FOOD/, 'convenience'],
  [/LIQUOR|WINE|SPEC'?S\b|\bBEER\b|SPIRITS|TOTAL WINE/, 'alcohol'],
  [/DOORDASH|UBER EATS|GRUBHUB|POSTMATES|STARBUCKS|MCDONALD|POPEYES|CHICK-FIL|TACO|PIZZA|BURGER|WENDY|SUBWAY|CAFE|COFFEE|RESTAURANT|KITCHEN|\bPHO\b|SUSHI|THAI|BBQ|GRILL|BOBA|TEA\b|BAKERY|DINER|NOODLE|RAMEN/, 'dining'],
  [/\bUBER\b|\bLYFT\b|SHELL|CHEVRON|EXXON|MOBIL|VALERO|PHILLIPS 66|CONOCO|MARATHON|GAS\b|PARKING|TOLL|EZ ?TAG|METRO|AIRLINE|UNITED|DELTA|SOUTHWEST|AMERICAN AIR/, 'transport'],
  [/AMAZON|TARGET|WALMART|BEST BUY|EBAY|ETSY|TEMU|SHEIN|HOME DEPOT|LOWE'S|IKEA|MACY|ROSS|TJ ?MAXX|MARSHALLS|NIKE|WALGREENS|CVS/, 'shopping'],
  [/\bFEE\b|OVERDRAFT|SERVICE CHARGE|INTEREST CHARGE|LATE FEE/, 'fees'],
];

const INVEST = /COINBASE|ROBINHOOD|BINANCE|KRAKEN|GEMINI TRUST|CRYPTO\.COM|SCHWAB|FIDELITY|VANGUARD|WEBULL|E\*?TRADE|ACORNS|STASH|\bBITCOIN\b|CASH APP.*BTC/;
const PERSON_RAILS = /ZELLE|VENMO|CASH APP|PAYPAL|APPLE CASH/;

/** Auto category for one transaction (before user overrides). */
export function autoCategory(t: Transaction, name: string, isOwnTransfer: boolean): string {
  if (isOwnTransfer) return 'transfer';
  const text = `${name} | ${t.description}`.toUpperCase();
  if (/TRANSFER (CHK|SAV|ACCT|MMA|CARD|LOC)\b/.test(name)) return 'transfer';
  if (INVEST.test(text)) return 'invest';
  if (t.amount > 0) {
    if (/PAYROLL|SALARY|DIRECT DEP|GUSTO|\bADP\b|PAYCHEX/.test(text)) return 'salary';
    if (/INTEREST/.test(text)) return 'interest';
    if (/REFUND|RETURN|REVERSAL|CREDIT ADJ|CASHBACK|CASH BACK/.test(text)) return 'refund';
    if (/DEPOSIT|SQUARE|TOAST|CLOVER|DOORDASH|UBER EATS|GRUBHUB|STRIPE/.test(text)) return 'deposit';
    if (PERSON_RAILS.test(text)) return 'from_people';
    if (/CARD PAYMENT RECEIVED|PAYMENT THANK YOU/.test(text)) return 'transfer';
    return SPEND_RULES.some(([re]) => re.test(text)) ? 'refund' : 'income_other';
  }
  if (/ATM CASH|ATM WITHDRAWAL|CASH WITHDRAWAL/.test(text)) return 'cash';
  for (const [re, id] of SPEND_RULES) if (re.test(text)) return id;
  if (PERSON_RAILS.test(text)) return 'people';
  return 'other';
}

/** counterparty name -> category id chosen by the user */
export type CategoryOverrides = Record<string, string>;

export interface CategorizedTx extends Transaction {
  name: string;
  category: string;
}

export function categorize(txns: Transaction[], aliases: Aliases, overrides: CategoryOverrides): CategorizedTx[] {
  const accounts = new Set(txns.map((t) => t.account));
  return txns.map((t) => {
    const own = ownAccountOf(t, aliases, accounts);
    const name = counterpartyName(t, aliases);
    const auto = autoCategory(t, name, !!own);
    const o = overrides[name];
    // income categories only apply to money in, spending categories only to money out;
    // invest / transfer / cash make sense in both directions
    const kind = o && CATEGORY_BY_ID.has(o) ? categoryOf(o).kind : null;
    const valid = kind !== null && (kind === 'invest' || kind === 'transfer' || (kind === 'income') === t.amount > 0);
    return { ...t, name, category: own ? 'transfer' : valid ? o : auto };
  });
}
