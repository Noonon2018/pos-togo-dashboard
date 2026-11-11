export type Currency = 'USD' | 'THB';

/** Display currency for non-crypto amounts (statements carry no currency code; the app setting decides). */
let CUR: Currency = 'USD';
export const setCurrency = (c: Currency) => {
  CUR = c;
};
export const currency = () => CUR;

const fmt = {
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
  THB: new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }),
};
const fmt0 = {
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  THB: new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }),
};
const SYMBOL: Record<Currency, string> = { USD: '$', THB: '฿' };

export const money = (n: number) => fmt[CUR].format(n);

/** Compact money for graph labels: $950, $1.2k, ฿35k, ฿1.4M */
export const moneyShort = (n: number) => {
  const a = Math.abs(n);
  const sym = SYMBOL[CUR];
  const sign = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${sign}${sym}${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}k`;
  return fmt0[CUR].format(n);
};

const coin = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

/** Dollars by default; coins with their unit and up to 6 decimals ("1.234567 ETH"). */
export const amountFmt = (n: number, unit?: string) => (unit && unit !== 'MIXED' ? `${coin.format(n)} ${unit}` : money(n));

/** Compact form for graph labels: "$1.2k", "0.52 ETH", "12k USDC". */
export const amountShort = (n: number, unit?: string) => {
  if (!unit) return moneyShort(n);
  if (unit === 'MIXED') return '';
  const a = Math.abs(n);
  const v = a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(n / 1e3)}k` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Number(n.toPrecision(3))}`;
  return `${v} ${unit}`;
};
