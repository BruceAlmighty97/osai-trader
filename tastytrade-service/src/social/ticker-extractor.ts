import { MatchType } from './social.types';

export interface ExtractedTicker {
  symbol: string;
  matchType: MatchType;
}

/**
 * Common ALL-CAPS words that look like tickers but aren't — used to filter BARE
 * matches (cashtags bypass this). This is a heuristic denylist for Phase A; a
 * real symbol-universe validation lands in Phase C. Kept deliberately broad on
 * finance/Reddit jargon since bare-ticker noise is the main false-positive source.
 */
const STOPLIST = new Set<string>([
  // finance / options jargon
  'CEO', 'CFO', 'COO', 'CTO', 'IPO', 'ETF', 'ETFS', 'IV', 'HV', 'PE', 'EPS',
  'DD', 'TA', 'FA', 'PT', 'ATH', 'ATL', 'OTM', 'ITM', 'ATM', 'DTE', 'EOD',
  'EOW', 'EOM', 'EOY', 'PUT', 'PUTS', 'CALL', 'CALLS', 'BUY', 'SELL', 'HOLD',
  'LONG', 'SHORT', 'GAIN', 'LOSS', 'RISK', 'BULL', 'BEAR', 'YOLO', 'FD', 'FDS',
  'ROI', 'GDP', 'CPI', 'FED', 'FOMC', 'SEC', 'IRS', 'IRA', 'USD', 'USA', 'US',
  'MOON', 'HODL', 'SPAC', 'IPO', 'NAV', 'AUM', 'YTD',
  // Reddit / internet speak
  'WSB', 'FOMO', 'IMO', 'IMHO', 'TLDR', 'TL', 'DR', 'AKA', 'FYI', 'PSA', 'AMA',
  'NGL', 'IIRC', 'LOL', 'LMAO', 'WTF', 'IDK', 'TBH', 'EDIT', 'OP', 'ELI',
  // everyday English all-caps that slip through (esp. caps-lock rants)
  'THE', 'AND', 'FOR', 'ARE', 'YOU', 'NOT', 'BUT', 'ALL', 'CAN', 'NOW', 'NEW',
  'GET', 'GOT', 'HAS', 'HAD', 'WAS', 'WILL', 'WITH', 'THIS', 'THAT', 'THEY',
  'WHAT', 'WHEN', 'FROM', 'JUST', 'LIKE', 'ONLY', 'ALSO', 'INTO', 'THAN',
  'THEN', 'OVER', 'SOME', 'MORE', 'MOST', 'EVEN', 'GOOD', 'MAKE', 'MUCH',
  'WAY', 'WHY', 'HOW', 'OMG', 'RIP', 'ANY', 'ONE', 'TWO', 'OUT', 'OFF', 'YES',
  'NO', 'OK', 'GO', 'IT', 'ON', 'IN', 'IF', 'OR', 'SO', 'AT', 'BE', 'AN',
  'AI', 'API', 'URL', 'USA',
  'IS', 'UP', 'AM', 'AS', 'MY', 'WE', 'HE', 'BY', 'DO', 'TO', 'OF', 'ME', 'HI',
  'OH', 'WHO', 'ITS', 'OUR', 'HIS', 'HER', 'HEY', 'YEP', 'NAH', 'LMK', 'BRO',
  'HAPPY', 'MONEY', 'LOVE', 'HATE', 'BIG', 'TOP', 'WIN', 'WON', 'RED', 'SAD',
  'BAD', 'YET', 'PER', 'DAY', 'BUSY', 'SEE', 'SAY', 'SAW', 'LET', 'PUT', 'END',
]);

const CASHTAG_RE = /\$([A-Za-z]{1,5})\b/g;
const BARE_RE = /\b([A-Z]{2,5})\b/g;

/**
 * Extract candidate tickers from text.
 * - `$SPY` cashtags are trusted (self-disambiguating).
 * - Bare ALL-CAPS tokens are kept only if not in the stoplist (noisier).
 * Dedupes per call, preferring the CASHTAG match type when a symbol appears both
 * ways. Returns at most one entry per distinct symbol.
 */
export function extractTickers(...texts: (string | null | undefined)[]): ExtractedTicker[] {
  const found = new Map<string, MatchType>(); // symbol → best matchType
  const joined = texts.filter(Boolean).join('\n');
  if (!joined) return [];

  for (const m of joined.matchAll(CASHTAG_RE)) {
    const sym = m[1].toUpperCase();
    found.set(sym, MatchType.CASHTAG);
  }

  for (const m of joined.matchAll(BARE_RE)) {
    const sym = m[1].toUpperCase();
    if (STOPLIST.has(sym)) continue;
    if (!found.has(sym)) found.set(sym, MatchType.BARE); // don't downgrade a cashtag
  }

  return [...found.entries()].map(([symbol, matchType]) => ({ symbol, matchType }));
}

/** Exposed for testing/inspection. */
export const _stoplist = STOPLIST;
