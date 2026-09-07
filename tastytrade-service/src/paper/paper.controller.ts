import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PaperService } from './paper.service';
import {
  ClosePositionDto,
  OpenFromSuggestionDto,
  PaperAccountSummary,
} from './paper.types';
import { PositionEntity } from '../persistence/entities/position.entity';
import { PositionStatus } from '../persistence/persistence.types';

/**
 * The imaginary account: real market metrics in, DB-only "fills" out. Never
 * touches a broker. See docs/paper-trading.md.
 */
@ApiTags('paper trading')
@Controller('paper')
export class PaperController {
  constructor(private readonly paper: PaperService) {}

  @Get('accounts')
  @ApiOperation({
    summary: 'A/B scoreboard — every experiment arm side by side',
  })
  async accounts(): Promise<PaperAccountSummary[]> {
    const arms = await this.paper.listArms();
    return Promise.all(arms.map((a) => this.paper.getSummary(a.name)));
  }

  @Get('account')
  @ApiOperation({ summary: 'One arm: balance, P&L, W/L' })
  @ApiQuery({
    name: 'account',
    required: false,
    description: "Arm key, e.g. 'mech' or 'ai'. Defaults to the baseline arm.",
  })
  account(@Query('account') account?: string): Promise<PaperAccountSummary> {
    return this.paper.getSummary(account);
  }

  @Post('positions/from-suggestion')
  @ApiOperation({ summary: 'Record a /strategy/suggest play into the ledger' })
  openFromSuggestion(
    @Body() dto: OpenFromSuggestionDto,
  ): Promise<PositionEntity> {
    return this.paper.openFromSuggestion(dto);
  }

  @Get('positions')
  @ApiOperation({ summary: 'List imaginary positions' })
  @ApiQuery({ name: 'status', required: false, enum: PositionStatus })
  @ApiQuery({
    name: 'account',
    required: false,
    description: "Arm key. Omit for the baseline arm; 'all' for every arm.",
  })
  positions(
    @Query('status') status?: PositionStatus,
    @Query('account') account?: string,
  ): Promise<PositionEntity[]> {
    return this.paper.listPositions(status, account === 'all' ? null : account);
  }

  @Patch('positions/:id/close')
  @ApiOperation({ summary: 'Close a position and realize the win/loss' })
  close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ClosePositionDto,
  ): Promise<PositionEntity> {
    return this.paper.close(id, dto);
  }
}
