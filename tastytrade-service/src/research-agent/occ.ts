/**
 * Option symbol conversions.
 *
 * Two formats matter and they are NOT interchangeable:
 *
 *   OCC       "META  260914P00625000"  — root padded to 6, YYMMDD, C/P,
 *                                        strike x1000 in 8 digits. What
 *                                        tastytrade's REST/order API wants.
 *   Streamer  ".META260914P625"        — DXLink. What streamSnapshot subscribes
 *                                        to, and what we persist on a position
 *                                        leg so mark-to-market can re-quote it.
 *
 * The research agent reports OCC symbols; our paper ledger needs streamer
 * symbols. Without this conversion every agent-opened position would come back
 * "unpriced" forever, since mark-to-market has no other way to quote a leg.
 *
 * The padding is where bugs live — hence the exhaustive tests: short roots
 * (F, GM), 6-char roots (GOOGL is 5, BRK.B), and fractional strikes (622.5,
 * 59.5) which must not gain or lose a decimal.
 */

export interface OptionSymbolParts {
  root: string;
  /** YYYY-MM-DD */
  expiration: string;
  right: 'C' | 'P';
  strike: number;
}

/** "META", "2026-09-14", "P", 625 -> "META  260914P00625000" */
export function buildOccSymbol(p: OptionSymbolParts): string {
  const root = p.root.toUpperCase().trim();
  if (!root || root.length > 6) {
    throw new Error(`invalid option root: "${p.root}"`);
  }
  const yymmdd = toYymmdd(p.expiration);
  const right = p.right.toUpperCase();
  if (right !== 'C' && right !== 'P') {
    throw new Error(`invalid right: "${p.right}"`);
  }
  if (!Number.isFinite(p.strike) || p.strike <= 0) {
    throw new Error(`invalid strike: ${p.strike}`);
  }
  // x1000 then zero-pad to 8. Math.round avoids 62249.999... from float math.
  const strike = String(Math.round(p.strike * 1000)).padStart(8, '0');
  return `${root.padEnd(6, ' ')}${yymmdd}${right}${strike}`;
}

/** "META  260914P00625000" -> parts */
export function parseOccSymbol(occ: string): OptionSymbolParts {
  // Root is everything before the 6-digit date; tolerate absent padding.
  const m = /^([A-Z.]{1,6})\s*(\d{6})([CP])(\d{8})$/.exec(occ.toUpperCase().trim());
  if (!m) throw new Error(`unparseable OCC symbol: "${occ}"`);
  const [, root, yymmdd, right, strike] = m;
  return {
    root,
    expiration: fromYymmdd(yymmdd),
    right: right as 'C' | 'P',
    strike: Number(strike) / 1000,
  };
}

/**
 * "META", "2026-09-14", "P", 625 -> ".META260914P625"
 *
 * DXLink strikes are NOT zero-padded and keep a decimal only when they need
 * one: 59.5 stays ".XLE261023P59.5" but 625 must be ".META260914P625", never
 * "P625.0" — a trailing ".0" yields no quote at all, silently.
 */
export function toStreamerSymbol(p: OptionSymbolParts): string {
  const root = p.root.toUpperCase().trim();
  const yymmdd = toYymmdd(p.expiration);
  const strike = trimStrike(p.strike);
  return `.${root}${yymmdd}${p.right.toUpperCase()}${strike}`;
}

/** "META  260914P00625000" -> ".META260914P625" */
export function occToStreamer(occ: string): string {
  return toStreamerSymbol(parseOccSymbol(occ));
}

/** ".XLE261023P59.5" -> parts */
export function parseStreamerSymbol(sym: string): OptionSymbolParts {
  const m = /^\.([A-Z.]{1,6})(\d{6})([CP])([0-9.]+)$/.exec(sym.toUpperCase().trim());
  if (!m) throw new Error(`unparseable streamer symbol: "${sym}"`);
  const [, root, yymmdd, right, strike] = m;
  return {
    root,
    expiration: fromYymmdd(yymmdd),
    right: right as 'C' | 'P',
    strike: Number(strike),
  };
}

function trimStrike(strike: number): string {
  // Options tick in fractions of a cent at most; 3dp is more than enough and
  // avoids 59.500000000000004 from float arithmetic.
  const s = strike.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

function toYymmdd(expiration: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiration.trim());
  if (!m) throw new Error(`expiration must be YYYY-MM-DD, got "${expiration}"`);
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

function fromYymmdd(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2));
  // Option chains do not go back to the 1900s; a 2-digit year is always 20xx.
  return `20${String(yy).padStart(2, '0')}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}
