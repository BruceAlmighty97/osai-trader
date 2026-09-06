import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RiskRules } from './risk.types';

/**
 * The single, account-agnostic risk policy. One row ('default') governs both the
 * paper account and (later) the live account. JSONB so rules can be added
 * without a migration each time.
 */
@Entity('risk_config')
export class RiskConfigEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, default: 'default' })
  name: string;

  @Column({ type: 'jsonb' })
  rules: RiskRules;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
