import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** One qualified candidate on a day's shortlist, with the data it qualified on. */
export interface ShortlistCandidate {
  symbol: string;
  /** Where it came from: the fixed universe or dynamic discovery. */
  source: 'watchlist' | 'trending';
  correlationGroup: string | null;
  ivRank: number | null;
  liquidityRating: number | null;
  iv30: number | null;
  /** StockTwits crowd lean (survivors only — expensive data goes last). */
  bullish: number | null;
  bearish: number | null;
}

/**
 * One row per trading day — how phases share state. Each tick is a separate
 * invocation (and would be a separate process if we ever go serverless), so
 * pre-market writes the shortlist here and the 10:00 entry phase reads it back
 * rather than re-deriving everything. Also the audit trail for what the bot was
 * looking at on any given day. See docs/trading-day.md.
 */
@Entity('trading_day')
export class TradingDayEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** ET calendar date, YYYY-MM-DD. One row per day. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  date: string;

  /** Ranked, qualified candidates produced by pre-market. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  shortlist: ShortlistCandidate[];

  /** How many candidates were considered before filtering. */
  @Column({ type: 'integer', default: 0 })
  candidatesScanned: number;

  /** Why candidates were dropped, e.g. {"low IV rank":34,"earnings":17}. */
  @Column({ type: 'jsonb', nullable: true })
  rejections: Record<string, number> | null;

  /** Free-text morning brief (AI-written later). */
  @Column({ type: 'text', nullable: true })
  brief: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
