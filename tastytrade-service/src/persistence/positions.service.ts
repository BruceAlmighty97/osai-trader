import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PositionEntity } from './entities/position.entity';
import { RecordPositionDto } from './dto/record-position.dto';
import { ClosePositionDto } from './dto/close-position.dto';
import { PositionStatus, StrategyType } from './persistence.types';

/**
 * CRUD over the canonical positions table — OUR source of truth for holdings.
 * The sandbox forgets positions nightly; this table remembers them so the
 * management loop can value + exit them. See docs/persistence-and-db.md.
 */
@Injectable()
export class PositionsService {
  private readonly logger = new Logger(PositionsService.name);

  constructor(
    @InjectRepository(PositionEntity)
    private readonly positions: Repository<PositionEntity>,
  ) {}

  /** Record a new open position. */
  async record(dto: RecordPositionDto): Promise<PositionEntity> {
    if (!dto.symbol) throw new BadRequestException('symbol is required');
    if (!Object.values(StrategyType).includes(dto.strategy)) {
      throw new BadRequestException(
        `strategy must be one of: ${Object.values(StrategyType).join(', ')}`,
      );
    }
    if (!Array.isArray(dto.legs) || dto.legs.length === 0) {
      throw new BadRequestException('legs must be a non-empty array');
    }
    if (dto.entryCredit == null || Number.isNaN(Number(dto.entryCredit))) {
      throw new BadRequestException('entryCredit is required and must be numeric');
    }

    const position = this.positions.create({
      symbol: dto.symbol.toUpperCase(),
      strategy: dto.strategy,
      expiration: dto.expiration,
      legs: dto.legs,
      quantity: dto.quantity ?? 1,
      entryCredit: Number(dto.entryCredit),
      maxRisk: dto.maxRisk != null ? Number(dto.maxRisk) : null,
      status: PositionStatus.OPEN,
      openDecisionId: dto.openDecisionId ?? null,
      openOrderId: dto.openOrderId ?? null,
      notes: dto.notes ?? null,
      openedAt: dto.openedAt ? new Date(dto.openedAt) : new Date(),
    });

    const saved = await this.positions.save(position);
    this.logger.log(
      `Recorded position #${saved.id}: ${saved.symbol} ${saved.strategy} ` +
        `x${saved.quantity} @ ${saved.entryCredit} credit`,
    );
    return saved;
  }

  /** List positions, optionally filtered by status (open/closed). */
  async findAll(status?: PositionStatus): Promise<PositionEntity[]> {
    const where = status ? { status } : {};
    return this.positions.find({ where, order: { openedAt: 'DESC' } });
  }

  async findOne(id: number): Promise<PositionEntity> {
    const position = await this.positions.findOne({ where: { id } });
    if (!position) throw new NotFoundException(`Position #${id} not found`);
    return position;
  }

  /** Close an open position: mark closed + record the exit outcome. */
  async close(id: number, dto: ClosePositionDto): Promise<PositionEntity> {
    const position = await this.findOne(id);
    if (position.status === PositionStatus.CLOSED) {
      throw new ConflictException(`Position #${id} is already closed`);
    }

    position.status = PositionStatus.CLOSED;
    position.exitReason = dto.exitReason;
    position.realizedPnl = dto.realizedPnl != null ? Number(dto.realizedPnl) : null;
    position.closeOrderId = dto.closeOrderId ?? position.closeOrderId;
    position.closedAt = dto.closedAt ? new Date(dto.closedAt) : new Date();
    if (dto.notes) position.notes = dto.notes;

    const saved = await this.positions.save(position);
    this.logger.log(
      `Closed position #${saved.id} (${saved.exitReason}), ` +
        `realized P&L ${saved.realizedPnl ?? 'n/a'}`,
    );
    return saved;
  }
}
