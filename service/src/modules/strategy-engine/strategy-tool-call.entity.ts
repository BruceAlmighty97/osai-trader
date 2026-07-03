import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { StrategyDecisionEntity } from './strategy-decision.entity';

@Entity('strategy_tool_calls')
export class StrategyToolCallEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => StrategyDecisionEntity, (d) => d.toolCalls)
  @JoinColumn({ name: 'decisionId' })
  decision: StrategyDecisionEntity;

  @Column()
  decisionId: number;

  @Column()
  toolName: string;

  @Column({ type: 'jsonb' })
  toolInput: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  toolOutput: Record<string, unknown>;

  @Column({ type: 'integer' })
  sequenceNumber: number;

  @Column({ type: 'integer' })
  durationMs: number;

  @CreateDateColumn()
  createdAt: Date;
}
