import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PositionEntity } from './entities/position.entity';
import { OrderEntity } from './entities/order.entity';
import { DecisionEntity } from './entities/decision.entity';
import { WatchlistEntity } from './entities/watchlist.entity';
import { PositionsService } from './positions.service';
import { PositionsController } from './positions.controller';
import { WatchlistService } from './watchlist.service';
import { WatchlistController } from './watchlist.controller';

/**
 * The durable-memory layer: our Postgres is the system of record (not the
 * broker). Registers all three tables — positions (canonical holdings, with a
 * manual write path), plus orders + decisions (schema stable now, written by the
 * execution/strategy layers later). See docs/persistence-and-db.md.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PositionEntity,
      OrderEntity,
      DecisionEntity,
      WatchlistEntity,
    ]),
  ],
  controllers: [PositionsController, WatchlistController],
  providers: [PositionsService, WatchlistService],
  exports: [PositionsService, WatchlistService, TypeOrmModule],
})
export class PersistenceModule {}
