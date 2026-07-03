import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderLifecycleStatus } from './order.types';

@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  orderId: number;

  @Column()
  symbol: string;

  @Column()
  secType: string;

  @Column()
  action: string;

  @Column()
  quantity: number;

  @Column()
  orderType: string;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  limitPrice: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  stopPrice: number | null;

  @Column({ default: 'SMART' })
  exchange: string;

  @Column({ default: 'USD' })
  currency: string;

  @Column({ type: 'varchar', nullable: true })
  expiration: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  strike: number | null;

  @Column({ type: 'varchar', nullable: true })
  right: string | null;

  @Column({ default: OrderLifecycleStatus.PENDING })
  status: OrderLifecycleStatus;

  @Column({ default: 0 })
  filledQuantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  avgFillPrice: number;

  @Column({ default: 0 })
  remaining: number;

  @Column({ type: 'varchar', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  submittedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
