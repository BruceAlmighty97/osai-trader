/**
 * Deterministic candidate generation inputs (spec §2.1a and §2.1c).
 *
 * Kept as code, not prompt, on purpose: the model should not be deciding which
 * ETF proxies "oil" — that mapping is a fact, and putting facts in the prompt
 * makes them expensive to change and impossible to test.
 */

/**
 * Core liquid ETFs that are always in the universe regardless of news flow.
 * These are unioned with the project's existing `watchlist` table rather than
 * duplicating it — the watchlist is already curated with correlation groups and
 * is what the mechanical arms trade.
 */
export const CORE_ETFS = [
  'SPY', 'QQQ', 'IWM', 'DIA',
  'XLE', 'XLF', 'XLK', 'XLV', 'XLI', 'XLU', 'XLP', 'XLY',
  'GLD', 'SLV', 'USO', 'UNG', 'TLT', 'HYG', 'VXX',
];

/**
 * Macro theme -> instruments that express it. When the news scout reports a
 * theme, these get added to the screen automatically.
 */
export const SECTOR_PROXIES: Record<string, string[]> = {
  oil: ['USO', 'XLE', 'XOP', 'VLO', 'MPC', 'OXY', 'CVX'],
  yields: ['TLT', 'IEF', 'HYG', 'XLF', 'KRE'],
  inflation: ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT'],
  semis: ['SMH', 'SOXL', 'MU', 'NVDA', 'AMD', 'INTC', 'QCOM'],
  defense: ['ITA', 'LMT', 'RTX', 'NOC', 'AVAV'],
  gold: ['GLD', 'GDX', 'SLV', 'UUP'],
  crypto: ['IBIT', 'MSTR', 'COIN'],
  retail: ['XRT', 'XLY'],
};

/** Free-text theme words the scout might return, mapped to a proxy bucket. */
const THEME_ALIASES: Record<string, string> = {
  crude: 'oil', opec: 'oil', 'middle east': 'oil', energy: 'oil', petroleum: 'oil',
  '10-year': 'yields', treasury: 'yields', 'treasury auction': 'yields',
  rates: 'yields', bond: 'yields', bonds: 'yields',
  cpi: 'inflation', ppi: 'inflation', inflation: 'inflation', fomc: 'inflation',
  semiconductor: 'semis', semiconductors: 'semis', memory: 'semis',
  'ai capex': 'semis', chips: 'semis',
  geopolitics: 'defense', war: 'defense', military: 'defense', defence: 'defense',
  dollar: 'gold', bullion: 'gold',
  bitcoin: 'crypto', ethereum: 'crypto',
  consumer: 'retail', 'consumer discretionary': 'retail',
};

/** Resolve free-text themes to a deduped symbol list. Unknown themes are ignored. */
export function proxiesForThemes(themes: string[]): {
  symbols: string[];
  matched: string[];
  unmatched: string[];
} {
  const out = new Set<string>();
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const raw of themes) {
    const t = raw.toLowerCase().trim();
    const bucket = SECTOR_PROXIES[t]
      ? t
      : THEME_ALIASES[t] ??
        Object.keys(THEME_ALIASES).find((k) => t.includes(k)) ??
        Object.keys(SECTOR_PROXIES).find((k) => t.includes(k));
    const key = bucket ? (SECTOR_PROXIES[bucket] ? bucket : THEME_ALIASES[bucket]) : undefined;
    if (key && SECTOR_PROXIES[key]) {
      matched.push(`${raw} -> ${key}`);
      SECTOR_PROXIES[key].forEach((s) => out.add(s));
    } else {
      unmatched.push(raw);
    }
  }
  return { symbols: [...out], matched, unmatched };
}

/**
 * Expected move over a holding window.
 *
 * EM = price x IV x sqrt(DTE / 252), using the IV of the CHOSEN expiry rather
 * than the 30-day index — the whole point is to place strikes relative to the
 * move actually priced into the expiry being traded.
 *
 * 252 (trading days) not 365: IV is quoted annualized over trading days, and
 * using calendar days here understates the move by ~20%.
 */
export function expectedMove(price: number, iv: number, dte: number) {
  // Accept IV as either 0.41 or 41 and normalize — the metrics endpoint and the
  // chain disagree about this, and a 100x error here is silently catastrophic.
  const vol = iv > 3 ? iv / 100 : iv;
  const em1 = price * vol * Math.sqrt(Math.max(dte, 0) / 252);
  return {
    ivUsed: vol,
    em1: round2(em1),
    em1_3: round2(em1 * 1.3),
    em1_5: round2(em1 * 1.5),
    lower1: round2(price - em1),
    upper1: round2(price + em1),
    lower1_3: round2(price - em1 * 1.3),
    upper1_3: round2(price + em1 * 1.3),
  };
}

export interface SpreadLegInput {
  action: 'Sell to Open' | 'Buy to Open';
  right: 'C' | 'P';
  strike: number;
  mid: number;
  delta?: number | null;
  quantity?: number;
}

/**
 * Single source of truth for spread economics — shared with the paper engine so
 * the agent's claimed numbers and the ledger's numbers cannot disagree.
 *
 * Sign convention: netCredit > 0 means we receive money.
 */
export function spreadMath(legs: SpreadLegInput[]) {
  if (!legs.length) throw new Error('no legs');

  let netCredit = 0;
  for (const l of legs) {
    const q = l.quantity ?? 1;
    netCredit += (l.action === 'Sell to Open' ? 1 : -1) * l.mid * q;
  }

  // Width per right: the vertical distance between the short and long legs.
  const widthFor = (right: 'C' | 'P') => {
    const side = legs.filter((l) => l.right === right);
    if (side.length < 2) return 0;
    const strikes = side.map((l) => l.strike);
    return Math.max(...strikes) - Math.min(...strikes);
  };
  const widest = Math.max(widthFor('C'), widthFor('P'));

  const isCredit = netCredit > 0;
  // Defined-risk verticals/condors: only one side of a condor can lose.
  const maxLoss = isCredit
    ? (widest - netCredit) * 100
    : Math.abs(netCredit) * 100;
  const maxProfit = isCredit ? netCredit * 100 : (widest - Math.abs(netCredit)) * 100;

  const breakevens: number[] = [];
  const puts = legs.filter((l) => l.right === 'P');
  const calls = legs.filter((l) => l.right === 'C');
  const shortPut = puts.find((l) => l.action === 'Sell to Open');
  const shortCall = calls.find((l) => l.action === 'Sell to Open');
  if (shortPut && isCredit) breakevens.push(round2(shortPut.strike - netCredit));
  if (shortCall && isCredit) breakevens.push(round2(shortCall.strike + netCredit));

  // POP for a credit spread ~ 1 - |short delta|. For a condor, subtract both.
  const shortDeltas = legs
    .filter((l) => l.action === 'Sell to Open' && typeof l.delta === 'number')
    .map((l) => Math.abs(l.delta as number));
  const pop = shortDeltas.length
    ? Math.max(0, Math.min(1, 1 - shortDeltas.reduce((a, b) => a + b, 0)))
    : null;

  return {
    netCredit: round2(netCredit),
    width: round2(widest),
    maxLoss: round2(maxLoss),
    maxProfit: round2(maxProfit),
    breakevens,
    probabilityOfProfit: pop === null ? null : round2(pop),
    returnOnRisk: maxLoss > 0 ? round2(maxProfit / maxLoss) : null,
    creditToWidth: widest > 0 ? round2(netCredit / widest) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
