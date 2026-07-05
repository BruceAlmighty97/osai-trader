import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { DecisionTrigger } from '../persistence.types';

/**
 * Audit trail of every AI analysis — the durable record of what the bot decided
 * and why. Ported from the legacy IBKR strategy-decision entity, adapted for the
 * tastytrade /strategy/suggest output. Written later by the strategy layer; the
 * table exists now so the schema is stable.
 */
@Entity('decisions')
export class DecisionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Underlying analyzed, e.g. SPY. Null for a portfolio-wide decision. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  symbol: string | null;

  @Column({ type: 'varchar', default: DecisionTrigger.MANUAL })
  trigger: DecisionTrigger;

  /** Chosen strategy or 'no_trade'. */
  @Column({ type: 'varchar', nullable: true })
  strategy: string | null;

  @Column({ type: 'text', nullable: true })
  marketAssessment: string | null;

  @Column({ type: 'text', nullable: true })
  rationale: string | null;

  /** The full structured suggestion (legs, target credit, max risk, caveats). */
  @Column({ type: 'jsonb', nullable: true })
  proposedTrade: Record<string, unknown> | null;

  /** The market snapshot the AI reasoned over (price/chain/greeks). */
  @Column({ type: 'jsonb', nullable: true })
  snapshot: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @Column({ type: 'jsonb', nullable: true })
  tokenUsage: Record<string, number> | null;

  @Column({ type: 'integer', nullable: true })
  durationMs: number | null;

  @Column({ type: 'varchar', nullable: true })
  stopReason: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
