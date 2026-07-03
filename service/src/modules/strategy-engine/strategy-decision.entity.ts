import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { DecisionStatus } from './strategy-engine.types';
import { StrategyToolCallEntity } from './strategy-tool-call.entity';

@Entity('strategy_decisions')
export class StrategyDecisionEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  sessionId: string;

  @Column()
  trigger: string;

  @Column({ type: 'varchar', nullable: true })
  underlying: string | null;

  @Column({ type: 'varchar', nullable: true })
  strategyType: string | null;

  @Column()
  decision: string;

  @Column({ type: 'text' })
  reasoning: string;

  @Column({ type: 'jsonb', nullable: true })
  proposedTrade: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  riskCheckResult: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  executionResult: Record<string, unknown> | null;

  @Column({ default: DecisionStatus.PENDING })
  status: DecisionStatus;

  @Column({ type: 'jsonb' })
  tokenUsage: Record<string, number>;

  @Column({ type: 'integer' })
  durationMs: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => StrategyToolCallEntity, (tc) => tc.decision)
  toolCalls: StrategyToolCallEntity[];
}
