import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * One agent run — the durable record of what the research desk saw and decided.
 *
 * `reportJson` holds the whole validated report including `candidatesScreened`,
 * which is the actual tuning signal: the rejections tell you which filter is
 * throttling the funnel. `sessionId` lets the SDK resume a run for a follow-up
 * ("size META for $500") without paying to re-research from scratch.
 */
@Entity('research_runs')
export class ResearchRunEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Arm this run trades into. */
  @Index()
  @Column({ type: 'integer', nullable: true })
  accountId: number | null;

  @Column({ type: 'text' })
  objective: string;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @Column({ type: 'varchar', nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', default: 'running' })
  status: 'running' | 'succeeded' | 'failed';

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  costUsd: number | null;

  @Column({ type: 'integer', nullable: true })
  turns: number | null;

  @Column({ type: 'integer', nullable: true })
  durationMs: number | null;

  @Column({ type: 'text', nullable: true })
  marketContext: string | null;

  @Column({ type: 'text', nullable: true })
  bestPlay: string | null;

  /** How many names were looked at, and how many survived. */
  @Column({ type: 'integer', nullable: true })
  candidatesScreened: number | null;

  @Column({ type: 'integer', default: 0 })
  playsProposed: number;

  @Column({ type: 'integer', default: 0 })
  playsSubmitted: number;

  /** Full validated ResearchReport. */
  @Column({ type: 'jsonb', nullable: true })
  reportJson: Record<string, unknown> | null;

  /** Every tool the agent called, in order — the audit trail. Never args. */
  @Column({ type: 'jsonb', nullable: true })
  toolCalls: Record<string, number> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
