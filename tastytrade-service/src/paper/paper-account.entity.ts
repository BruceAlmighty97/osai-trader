import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Per-arm overrides. Anything unset falls back to the ENTRY_* env defaults. */
export interface ArmConfig {
  /** Who picks one spread off the scored slate. */
  selector?: 'mechanical' | 'ai';
  /** Model for the AI selector, when this arm uses one. */
  model?: string;
  targetDelta?: number;
  targetDte?: number;
  widthPct?: number;
  minCreditToWidth?: number;
  maxQuoteSpreadPct?: number;
  slateSize?: number;
  maxNewPerRun?: number;
}

/**
 * One experiment arm — an imaginary account with its own book and its own
 * config. Only static config lives here: cash, realized P&L, buying power and
 * the win/loss record are all DERIVED from the positions table (see
 * PaperService.getSummary) so there's no balance to drift.
 *
 * Risk rules are NOT an arm variable — they live in the global `risk_config`
 * because they apply to the real account too.
 */
@Entity('paper_account')
export class PaperAccountEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Short arm key, e.g. 'mech' or 'ai'. Addressable via ?account=. */
  @Column({ type: 'varchar', unique: true, default: 'default' })
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 2500 })
  startingBalance: number;

  /** Disabled arms keep their history but stop trading. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** What this arm is testing, in one line. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: ArmConfig;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
