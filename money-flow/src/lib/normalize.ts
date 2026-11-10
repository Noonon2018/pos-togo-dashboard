/**
 * Turn a raw bank description into a stable counterparty key.
 *   "AMAZON MKTP US*2K3J45 AMZN.COM/BILL WA"   -> "AMAZON"
 *   "ZELLE PAYMENT TO JOHN DOE JPM99AB12"      -> "JOHN DOE"
 *   "ORIG CO NAME:GUSTO ORIG ID:123 DESC DATE" -> "GUSTO"
 * The rules are heuristics; the UI lets the user rename/merge anything these miss.
 */

/** Known merchants: first matching pattern wins (order matters: UBER EATS before UBER). */
const KNOWN: [RegExp, string][] = [
  [/\bATM\b.*\b(WITHDRAWAL|W\/D|CASH)\b|\bCASH WITHDRAWAL/, 'ATM CASH'],
  [/\bAUTOPAY PAYMENT|\bPAYMENT RECEIVED|\bPAYMENT - THANK YOU|\bPAYMENT THANK YOU/, 'CARD PAYMENT RECEIVED'],
  [/\bINTEREST (PAYMENT|PAID|EARNED)/, 'INTEREST'],
  [/\bREMOTE ONLINE DEPOSIT|\bMOBILE (CHECK )?DEPOSIT/, 'CHECK DEPOSIT (MOBILE)'],
  [/\bCOINBASE/, 'COINBASE'],
  [/\bROBINHOOD/, 'ROBINHOOD'],
  [/\bAMAZON PRIME|\bPRIME VIDEO|\bAMZN DIGITAL/, 'AMAZON PRIME'],
  [/\bAMAZON|\bAMZN/, 'AMAZON'],
  [/\bUBER\s*\*?\s*EATS/, 'UBER EATS'],
  [/\bUBER\b/, 'UBER'],
  [/\bLYFT\b/, 'LYFT'],
  [/\bDOORDASH|\bDD \*?DOORDASH/, 'DOORDASH'],
  [/\bGRUBHUB/, 'GRUBHUB'],
  [/\bNETFLIX/, 'NETFLIX'],
  [/\bSPOTIFY/, 'SPOTIFY'],
  [/\bHULU\b/, 'HULU'],
  [/\bDISNEY ?PLUS|\bDISNEY\+/, 'DISNEY+'],
  [/\bAPPLE\.COM|\bAPPLE COM BILL|\bITUNES/, 'APPLE'],
  [/\bGOOGLE \*?(YOUTUBE|YT)/, 'YOUTUBE'],
  [/\bGOOGLE\b/, 'GOOGLE'],
  [/\bMICROSOFT|\bMSFT\b/, 'MICROSOFT'],
  [/\bOPENAI|\bCHATGPT/, 'OPENAI'],
  [/\bANTHROPIC|\bCLAUDE\.AI/, 'ANTHROPIC'],
  [/\bWAL-?MART|\bWM SUPERCENTER/, 'WALMART'],
  [/\bTARGET\b/, 'TARGET'],
  [/\bCOSTCO/, 'COSTCO'],
  [/\bSAMS ?CLUB|\bSAM'S CLUB/, "SAM'S CLUB"],
  [/\bH-?E-?B\b/, 'H-E-B'],
  [/\bKROGER/, 'KROGER'],
  [/\bSYSCO/, 'SYSCO'],
  [/\bRESTAURANT DEPOT|\bJETRO/, 'RESTAURANT DEPOT'],
  [/\bHOME DEPOT/, 'HOME DEPOT'],
  [/\bLOWE'?S\b/, "LOWE'S"],
  [/\bSHELL\b/, 'SHELL'],
  [/\bEXXON|\bMOBIL\b/, 'EXXONMOBIL'],
  [/\bCHEVRON/, 'CHEVRON'],
  [/\bSTARBUCKS/, 'STARBUCKS'],
  [/\bMCDONALD/, "MCDONALD'S"],
  [/\bCOMCAST|\bXFINITY/, 'XFINITY'],
  [/\bAT&T|\bATT\b/, 'AT&T'],
  [/\bT-?MOBILE/, 'T-MOBILE'],
  [/\bVERIZON/, 'VERIZON'],
  [/\bRELIANT ENERGY|\bRELIANT\b/, 'RELIANT ENERGY'],
  [/\bCENTERPOINT/, 'CENTERPOINT ENERGY'],
  [/\bGEICO/, 'GEICO'],
  [/\bSTATE FARM/, 'STATE FARM'],
  [/\bPROGRESSIVE/, 'PROGRESSIVE'],
  [/\bGUSTO\b/, 'GUSTO'],
  [/\bADP\b/, 'ADP'],
  [/\bIRS\b|\bUSATAXPYMT/, 'IRS'],
  [/\bSQUARE INC|\bSQ \*?DEP|\bSQUARE DEP/, 'SQUARE (DEPOSIT)'],
  [/\bTOAST,? INC|\bTOAST DEP/, 'TOAST (DEPOSIT)'],
  [/\bCLOVER\b/, 'CLOVER'],
  [/\bVENMO/, 'VENMO'],
  [/\bCASH APP|\bSQUARE CASH/, 'CASH APP'],
  [/\bPAYPAL/, 'PAYPAL'],
];

/** Leading boilerplate that says *how* money moved, not *who*. */
const PREFIXES: RegExp[] = [
  /^(POS|DEBIT CARD|CHECK ?CARD|VISA|DBT CRD|CARD|RECURRING( CARD)?|PRE-?AUTHORIZED)( PURCHASE| PAYMENT| DEBIT)*( WITH PIN)?\s*(\d{2}\/\d{2})?\s*/,
  /^PURCHASE( AUTHORIZED ON \d{1,2}\/\d{1,2})?\s*/,
  /^(ACH|ELECTRONIC|EFT|ONLINE|MOBILE|EXTERNAL)( (DEBIT|CREDIT|WITHDRAWAL|DEPOSIT|PAYMENT|PMT|TRANSFER|XFER))+\s*/,
  /^(ONLINE |MOBILE )?(TRANSFER|XFER)( (TO|FROM))?\s*/,
  /^ZELLE( (PAYMENT|TRANSFER))?( (TO|FROM))?\s*/,
  /^(DEPOSIT|WITHDRAWAL)( FROM| TO)?\s*/,
  /^(BILL ?PAY(MENT)?|ONLINE PAYMENT|PAYMENT)( (TO|SENT|RECEIVED))?\s*/,
  /^(SQ|TST|SP|PP|PAYPAL|DD|IN|BT)\s?\*\s*/,
];

export function normalizeCounterparty(description: string): string {
  let s = ` ${description.toUpperCase()} `.replace(/\s+/g, ' ');

  // Chase / BofA ACH format: "ORIG CO NAME:XYZ ORIG ID:..." -> XYZ
  const orig = s.match(/ORIG CO NAME:\s*(.+?)\s+(ORIG ID|CO ENTRY|DESC DATE|IND ID|SEC:|TRACE)/);
  if (orig) s = ` ${orig[1]} `;

  // BofA-style ACH: "TX COMPTROLLER DES:SALES TAX ID:..." -> "TX COMPTROLLER"
  const des = s.match(/^ (.+?) DES:/);
  if (des) s = ` ${des[1]} `;

  // App-store billing: "GOOGLE *CLAUDE BY AN G.CO/HELPPAY#" -> "GOOGLE PLAY: CLAUDE BY AN"
  // (otherwise every subscription paid through Google collapses into one "GOOGLE" node)
  const store = s.match(/\bGOOGLE \*\s*(.+?)(?=\s+(G\.CO|\d{3}-\d{3}-\d{4}|[A-Z]{2} CARD|CARD \d)|\s*$)/);
  if (store && !/^(YOUTUBE|YT|GSUITE|WORKSPACE|CLOUD|ADS)\b/.test(store[1])) return `GOOGLE PLAY: ${store[1].trim()}`;

  for (const [re, name] of KNOWN) if (re.test(s)) return name;

  // Transfers between accounts: keep account type + last 4 digits, drop direction so both
  // sides ("TO CHK ...9021" / "FROM CHK ...9021") land on the same key.
  if (/\b(TRANSFER|XFER)\b/.test(s)) {
    const last4 = s.match(/(?:\.{2,}|X{2,}|\*{2,}|#|ENDING IN )\s*(\d{4})\b/);
    const type = s.match(/\b(CHK|CHECKING|SAV|SAVINGS|MMA|MONEY MARKET|CREDIT CARD|CARD|LOC)\b/);
    if (last4 || type) {
      const t = type ? type[1].replace('CHECKING', 'CHK').replace('SAVINGS', 'SAV') : 'ACCT';
      return `TRANSFER ${t}${last4 ? ` ${last4[1]}` : ''}`;
    }
  }

  s = s.trim();
  for (let pass = 0; pass < 3; pass++) for (const re of PREFIXES) s = s.replace(re, '');

  s = s
    // processor prefix that survived (e.g. "SQ *THAI BASIL")
    .replace(/^[A-Z]{2,3} ?\*\s*/, '')
    // card-network tails: "... CHECKCARD 0912"
    .replace(/\s(CHECK ?CARD|DEBIT CARD|POS|PURCHASE)\b.*$/, '')
    // "MERCHANT #1234 CITY ST ..." — a store number separates the name from the location
    .replace(/(\S)\s+#\s*\d+\b.*$/, '$1')
    // everything after a "*" is usually an order/reference code
    .replace(/\*.*$/, '')
    // reference / confirmation / id tails
    .replace(/\b(CONF(IRMATION)?|REF|ID|TRACE|TRN|TXN|WEB ID|PPD ID|CCD ID|INDN|CO ID|SEQ|AUTH|TRANSACTION)\b\s*[#:]?\s*\S+.*$/, '')
    .replace(/\bON \d{1,2}\/\d{1,2}(\/\d{2,4})?\b.*$/, '')
    // dates, card fragments, long numbers, phone numbers, URLs
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\b(X{2,}|\*{2,})\d+\b/g, ' ')
    .replace(/\b(CARD|ACCT|ACCOUNT|ENDING( IN)?)\s*#?\s*\d+\b/g, ' ')
    .replace(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b[A-Z]*\d[A-Z\d]{5,}\b/g, ' ') // mixed alnum codes like JPM99AB12
    .replace(/\s(?=[A-Z0-9]{8,}$)[A-Z]*\d[A-Z0-9]*$/, '') // trailing ref like BACGAUY8IDQ7
    .replace(/\bHTTPS?:?\/*\S*/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    // trailing US state code (keeps the city: "HOUSTON TX" -> "HOUSTON")
    .replace(/\s(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s*$/, '')
    .replace(/[^A-Z0-9&'.+\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-]+|[\s.\-]+$/g, '')
    .trim();

  return s || description.trim().toUpperCase() || 'UNKNOWN';
}

/** Resolve counterparty through user aliases (follows chains, guards against cycles). */
export function resolveAlias(key: string, aliases: Record<string, string>): string {
  let cur = key;
  const seen = new Set<string>();
  while (aliases[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = aliases[cur];
  }
  return cur;
}
