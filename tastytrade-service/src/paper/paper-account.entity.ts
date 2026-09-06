import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Config for the imaginary account. Only static config lives here — cash,
 * realized P&L, buying power and the win/loss record are all DERIVED from the
 * positions table (see PaperService.getSummary) so there's no balance to drift.
 */
@Entity('paper_account')
export class PaperAccountEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', unique: true, default: 'default' })
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 2500 })
  startingBalance: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
