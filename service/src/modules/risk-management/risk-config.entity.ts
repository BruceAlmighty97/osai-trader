import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RiskConfigData } from './risk-config.types';

@Entity('risk_config')
export class RiskConfigEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'jsonb' })
  config: RiskConfigData;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
