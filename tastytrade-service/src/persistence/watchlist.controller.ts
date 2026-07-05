import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WatchlistService } from './watchlist.service';
import { CreateWatchlistItemDto } from './dto/create-watchlist-item.dto';
import { UpdateWatchlistItemDto } from './dto/update-watchlist-item.dto';
import { WatchlistEntity } from './entities/watchlist.entity';
import { AnalysisCadence } from './persistence.types';

@ApiTags('watchlist')
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Post()
  @ApiOperation({ summary: 'Add a symbol to the watchlist' })
  add(@Body() dto: CreateWatchlistItemDto): Promise<WatchlistEntity> {
    return this.watchlist.add(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List watchlist symbols (optionally filtered)' })
  @ApiQuery({ name: 'enabled', required: false, example: 'true' })
  @ApiQuery({ name: 'cadence', required: false, enum: AnalysisCadence })
  findAll(
    @Query('enabled') enabled?: string,
    @Query('cadence') cadence?: AnalysisCadence,
  ): Promise<WatchlistEntity[]> {
    return this.watchlist.findAll({
      enabled: enabled === undefined ? undefined : enabled === 'true',
      cadence,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one watchlist entry by id' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<WatchlistEntity> {
    return this.watchlist.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a watchlist entry (enable/disable, cadence, priority)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWatchlistItemDto,
  ): Promise<WatchlistEntity> {
    return this.watchlist.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a symbol from the watchlist' })
  remove(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ deleted: true; id: number }> {
    return this.watchlist.remove(id);
  }
}
