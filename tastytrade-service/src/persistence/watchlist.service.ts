import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistEntity } from './entities/watchlist.entity';
import { CreateWatchlistItemDto } from './dto/create-watchlist-item.dto';
import { UpdateWatchlistItemDto } from './dto/update-watchlist-item.dto';
import { AnalysisCadence } from './persistence.types';

/** Manages the universe of symbols the scan pipeline analyzes. */
@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    @InjectRepository(WatchlistEntity)
    private readonly watchlist: Repository<WatchlistEntity>,
  ) {}

  /** Add a symbol to the watchlist. */
  async add(dto: CreateWatchlistItemDto): Promise<WatchlistEntity> {
    if (!dto.symbol) throw new BadRequestException('symbol is required');
    if (dto.cadence && !Object.values(AnalysisCadence).includes(dto.cadence)) {
      throw new BadRequestException(
        `cadence must be one of: ${Object.values(AnalysisCadence).join(', ')}`,
      );
    }
    const symbol = dto.symbol.toUpperCase();

    if (await this.watchlist.findOne({ where: { symbol } })) {
      throw new ConflictException(`${symbol} is already on the watchlist`);
    }

    const item = this.watchlist.create({
      symbol,
      description: dto.description ?? null,
      correlationGroup: dto.correlationGroup ?? null,
      cadence: dto.cadence ?? AnalysisCadence.DAILY,
      enabled: dto.enabled ?? true,
      priority: dto.priority ?? 0,
      notes: dto.notes ?? null,
    });
    const saved = await this.watchlist.save(item);
    this.logger.log(`Added ${saved.symbol} to watchlist (${saved.cadence})`);
    return saved;
  }

  /** List watchlist entries, optionally filtered. Ordered by priority desc. */
  async findAll(filters?: {
    enabled?: boolean;
    cadence?: AnalysisCadence;
  }): Promise<WatchlistEntity[]> {
    const where: Record<string, unknown> = {};
    if (filters?.enabled !== undefined) where.enabled = filters.enabled;
    if (filters?.cadence) where.cadence = filters.cadence;
    return this.watchlist.find({
      where,
      order: { priority: 'DESC', symbol: 'ASC' },
    });
  }

  async findOne(id: number): Promise<WatchlistEntity> {
    const item = await this.watchlist.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Watchlist item #${id} not found`);
    return item;
  }

  /** Partial update (enable/disable, change cadence, priority, etc.). */
  async update(
    id: number,
    dto: UpdateWatchlistItemDto,
  ): Promise<WatchlistEntity> {
    const item = await this.findOne(id);
    if (dto.cadence && !Object.values(AnalysisCadence).includes(dto.cadence)) {
      throw new BadRequestException(
        `cadence must be one of: ${Object.values(AnalysisCadence).join(', ')}`,
      );
    }
    Object.assign(item, {
      description: dto.description ?? item.description,
      correlationGroup: dto.correlationGroup ?? item.correlationGroup,
      cadence: dto.cadence ?? item.cadence,
      enabled: dto.enabled ?? item.enabled,
      priority: dto.priority ?? item.priority,
      notes: dto.notes ?? item.notes,
    });
    return this.watchlist.save(item);
  }

  async remove(id: number): Promise<{ deleted: true; id: number }> {
    const item = await this.findOne(id);
    await this.watchlist.remove(item);
    this.logger.log(`Removed ${item.symbol} from watchlist`);
    return { deleted: true, id };
  }
}
