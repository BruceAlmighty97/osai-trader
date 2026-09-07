import { BadRequestException, Controller, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TraderService } from './trader.service';
import { PhaseResult, TradingPhase } from './trading.types';

@ApiTags('trading')
@Controller('trading')
export class TradingController {
  constructor(private readonly trader: TraderService) {}

  /**
   * Run a trading-day phase on demand, bypassing the schedule. Invaluable for
   * development — you don't have to wait for the 10:00 window to exercise entry.
   */
  @Post('run')
  @ApiOperation({
    summary: 'Manually run a trading-day phase (bypasses the schedule)',
  })
  @ApiQuery({ name: 'phase', enum: TradingPhase, example: TradingPhase.ENTRY })
  run(@Query('phase') phase: TradingPhase): Promise<PhaseResult> {
    const valid = Object.values(TradingPhase);
    if (!phase || !valid.includes(phase)) {
      throw new BadRequestException(
        `phase must be one of: ${valid.join(', ')}`,
      );
    }
    return this.trader.runPhase(phase, {
      now: new Date(),
      trigger: 'manual',
    });
  }
}
