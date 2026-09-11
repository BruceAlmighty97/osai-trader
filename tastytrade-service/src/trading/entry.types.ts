/**
 * Shared shapes for the entry phase. Lives in its own file so the mechanical
 * selector (entry.service) and the AI selector (entry-analyst.service) can both
 * import them without a circular dependency.
 */

/**
 * Fully-resolved knobs for one experiment arm: the ENTRY_* env defaults with the
 * arm's `config` overrides applied on top.
 */
export interface ArmParams {
  selector: 'mechanical' | 'ai' | 'agent';
  model?: string;
  targetDelta: number;
  widthPct: number;
  minCreditToWidth: number;
  targetDte: number;
  maxNewPerRun: number;
  maxQuoteSpreadPct: number;
  /**
   * Absolute bid/ask width, in dollars, below which a leg is never rejected for
   * being "wide". Relative spread is meaningless on a $0.15 option.
   */
  maxQuoteSpreadAbs: number;
  slateSize: number;
}

/** Weighted components of a plan's deterministic score, each normalized 0-1. */
export interface ScoreParts {
  /** Risk/reward: credit as a fraction of width. */
  creditToWidth: number;
  /** How close the achieved short delta landed to the target. */
  deltaFit: number;
  /** Premium richness — where IV rank sits in the tradeable band. */
  ivRank: number;
  /** Execution quality — how tight the two legs' quotes are. */
  liquidity: number;
}

/**
 * A concrete, fully-priced spread built from live chain data. Everything the
 * selectors need to compare candidates against each other — critically, the
 * strikes and economics are computed in CODE, never by the model.
 */
export interface SpreadPlan {
  symbol: string;
  correlationGroup: string | null;
  expiration: string;
  dte: number;
  underlyingPrice: number;
  shortStrike: number;
  longStrike: number;
  /** DXLink symbols, persisted on the legs so mark-to-market can re-quote them. */
  shortStreamerSymbol?: string;
  longStreamerSymbol?: string;
  shortDelta: number;
  width: number;
  /** Net credit per share (short mid − long mid). */
  credit: number;
  /** Defined risk per share = width − credit. */
  riskPerShare: number;
  creditToWidth: number;
  /** Mean relative quote spread across both legs — lower is better execution. */
  avgRelSpread: number;
  ivRank: number | null;
  /** StockTwits crowd lean, carried through for the AI's qualitative read. */
  bullish: number | null;
  bearish: number | null;
  /** Deterministic 0-100 score. The baseline the AI has to beat. */
  score: number;
  scoreParts: ScoreParts;
}

/** What a selector — mechanical or AI — decided to do with a slate. */
export interface SelectorChoice {
  source: 'mechanical' | 'ai';
  /** Index into the scored slate, or null to pass on the day. */
  pick: number | null;
  rationale: string;
  concerns?: string;
  portfolioFit?: string;
  model?: string;
  tokenUsage?: Record<string, number>;
  durationMs?: number;
  /** Set when the AI was asked but could not answer; we fell back to the score. */
  fallbackReason?: string;
}
