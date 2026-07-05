import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  ExitReason,
  OptionLeg,
  PositionStatus,
  StrategyType,
} from '../persistence.types';

/**
 * The canonical record of a holding — OUR source of truth for what we own.
 *
 * The tastytrade sandbox wipes positions nightly, so the management loop reads
 * open positions from THIS table (not the broker) and re-fetches live quotes for
 * the legs' `streamerSymbol`s to value them. See docs/persistence-and-db.md.
 */
@Entity('positions')
export class PositionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Underlying symbol, e.g. SPY. */
  @Index()
  @Column()
  symbol: string;

  @Column({ type: 'varchar' })
  strategy: StrategyType;

  /** Expiration of the legs (all legs share one expiration for our spreads). */
  @Column({ type: 'varchar' })
  expiration: string;

  /** The legs of the spread, incl. DXLink streamer symbols for live re-quoting. */
  @Column({ type: 'jsonb' })
  legs: OptionLeg[];

  /** Number of spread units held. */
  @Column({ type: 'integer', default: 1 })
  quantity: number;

  /** Net credit received per spread unit at entry (positive = credit taken in). */
  @Column({ type: 'decimal', precision: 12, scale: 4 })
  entryCredit: number;

  /** Defined max risk per spread unit = (width - credit) * 100. */
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  maxRisk: number | null;

  @Index()
  @Column({ type: 'varchar', default: PositionStatus.OPEN })
  status: PositionStatus;

  /** Realized P&L once closed (total across all units). */
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  realizedPnl: number | null;

  @Column({ type: 'varchar', nullable: true })
  exitReason: ExitReason | null;

  /** Soft links (no FK constraint) to the audit/execution rows. */
  @Column({ type: 'integer', nullable: true })
  openDecisionId: number | null;

  @Column({ type: 'integer', nullable: true })
  openOrderId: number | null;

  @Column({ type: 'integer', nullable: true })
  closeOrderId: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz' })
  openedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
