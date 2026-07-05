import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { AnalysisCadence } from '../persistence.types';

/**
 * The universe of securities we want the bot to analyze — replaces the hardcoded
 * watchlist that /strategy/scan would otherwise carry. Each row controls whether
 * and how often a symbol is scanned, and which correlation bucket it belongs to
 * (so ranking can cap stacked correlated risk — see docs/strategy-methodology.md).
 */
@Entity('watchlist')
export class WatchlistEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Underlying ticker, e.g. SPY. One row per symbol. */
  @Index({ unique: true })
  @Column()
  symbol: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  /**
   * Correlation bucket for ranking, e.g. 'us_equity' (SPY/QQQ/IWM), 'gold',
   * 'rates', 'silver'. Symbols in the same bucket are ONE bet — the ranker caps
   * combined exposure rather than treating them as diversification.
   */
  @Column({ type: 'varchar', nullable: true })
  correlationGroup: string | null;

  /** How often to run this symbol through the AI entry pipeline. */
  @Column({ type: 'varchar', default: AnalysisCadence.DAILY })
  cadence: AnalysisCadence;

  /** Pause a symbol without deleting it (excluded from scans when false). */
  @Index()
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Higher = analyzed/preferred first (tie-break for max-N-new-positions/day). */
  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** When the scan last analyzed this symbol — lets the scheduler gate cadence. */
  @Column({ type: 'timestamptz', nullable: true })
  lastAnalyzedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
