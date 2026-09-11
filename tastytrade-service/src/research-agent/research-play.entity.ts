import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * One proposed play from a run — recorded whether or not it was executed.
 *
 * Recording rejected plays is the point: scoring only the trades that were
 * taken tells you nothing about whether the gate is throwing away good ones.
 * `submittedPositionId` links to the paper ledger when a play was actually
 * opened; `rejectionReason` says why when it wasn't.
 */
@Entity('research_plays')
export class ResearchPlayEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'integer' })
  runId: number;

  @Index()
  @Column({ type: 'varchar' })
  underlying: string;

  @Column({ type: 'varchar' })
  structure: string;

  /** structural | volMispricing | statistical — scoring rolls up by this. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  edgeType: string | null;

  @Column({ type: 'jsonb' })
  legs: Record<string, unknown>[];

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  netCredit: number;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  maxLoss: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  maxProfit: number | null;

  @Column({ type: 'decimal', precision: 6, scale: 4, nullable: true })
  probabilityOfProfit: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  buyingPowerEffect: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  estimatedFees: number | null;

  @Column({ type: 'boolean', default: false })
  dryRunPassed: boolean;

  @Column({ type: 'varchar', nullable: true })
  conviction: string | null;

  @Column({ type: 'text', nullable: true })
  thesis: string | null;

  @Column({ type: 'text', nullable: true })
  managementPlan: string | null;

  @Column({ type: 'jsonb', nullable: true })
  catalysts: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  risks: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  sources: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  ivContext: Record<string, unknown> | null;

  /** Set when the play was accepted into the paper ledger. */
  @Column({ type: 'integer', nullable: true })
  submittedPositionId: number | null;

  /** Set when it was not — the risk gate, a failed dry-run, or BP. */
  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
