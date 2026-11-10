const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const money = (n: number) => usd.format(n);

/** Compact money for graph labels: $950, $1.2k, $35k, $1.4M */
export const moneyShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `$${Math.round(n / 1e3)}k`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return usd0.format(n);
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
