import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { OptionLeg, OrderStatus } from '../persistence.types';

/**
 * Submitted orders + their fill lifecycle. Ported from the legacy IBKR order
 * entity, adapted for tastytrade multi-leg (legs as JSONB, native combo orders).
 * Written later by the execution layer; the table exists now so the schema is
 * stable. `dryRun` distinguishes validation-only orders from real submissions.
 */
@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** tastytrade's order id once accepted (null while pending/dry-run). */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  tastytradeOrderId: string | null;

  /** Underlying symbol, e.g. SPY. */
  @Index()
  @Column()
  symbol: string;

  /** The legs submitted (multi-leg combo). */
  @Column({ type: 'jsonb' })
  legs: OptionLeg[];

  @Column({ default: 'Limit' })
  orderType: string;

  /** Net price: negative = net credit, positive = net debit (tastytrade convention). */
  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  price: number | null;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @Index()
  @Column({ type: 'varchar', default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ type: 'integer', default: 0 })
  filledQuantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  avgFillPrice: number | null;

  /** True when this was a dry-run validation, not a live submission. */
  @Column({ type: 'boolean', default: false })
  dryRun: boolean;

  /** Soft links (no FK constraint) to the position/decision this order serves. */
  @Column({ type: 'integer', nullable: true })
  positionId: number | null;

  @Column({ type: 'integer', nullable: true })
  decisionId: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  submittedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
