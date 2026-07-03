import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { StrategyEngineService } from './strategy-engine.service';
import { RunAnalysisDto, AnalysisTrigger } from './strategy-engine.types';

@ApiTags('Strategy Engine')
@Controller('strategy')
export class StrategyEngineController {
  constructor(private readonly strategyService: StrategyEngineService) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Trigger a market analysis and trading decision' })
  async analyze(@Body() dto: RunAnalysisDto) {
    return this.strategyService.runAnalysis(
      dto.trigger ?? AnalysisTrigger.MANUAL,
      dto.underlying,
    );
  }

  @Get('decisions')
  @ApiOperation({ summary: 'List recent strategy decisions' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getDecisions(@Query('limit') limit?: number) {
    return this.strategyService.getDecisions(limit ?? 20);
  }

  @Get('decisions/:id')
  @ApiOperation({ summary: 'Get a specific decision with tool calls' })
  async getDecision(@Param('id', ParseIntPipe) id: number) {
    const decision = await this.strategyService.getDecision(id);
    if (!decision) throw new NotFoundException(`Decision ${id} not found`);
    return decision;
  }

  @Get('decisions/:id/tool-calls')
  @ApiOperation({ summary: 'Get the tool call audit trail for a decision' })
  async getToolCalls(@Param('id', ParseIntPipe) id: number) {
    return this.strategyService.getToolCalls(id);
  }
}
