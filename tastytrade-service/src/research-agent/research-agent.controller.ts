import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResearchAgentService, ResearchRequest } from './research-agent.service';
import { ResearchExecutionService } from './research-execution.service';
import { ResearchRunEntity } from './research-run.entity';
import { ResearchPlayEntity } from './research-play.entity';

/**
 * Runs take 2-6 minutes, which is longer than most proxies tolerate. The
 * scheduled path is fire-and-forget; this controller exists for development and
 * for inspecting past runs.
 */
@ApiTags('research agent')
@Controller('research')
export class ResearchAgentController {
  constructor(
    private readonly research: ResearchAgentService,
    private readonly execution: ResearchExecutionService,
    @InjectRepository(ResearchRunEntity)
    private readonly runs: Repository<ResearchRunEntity>,
    @InjectRepository(ResearchPlayEntity)
    private readonly plays: Repository<ResearchPlayEntity>,
  ) {}

  @Post('run')
  @ApiOperation({
    summary: 'Run the research agent now (SLOW — 2-6 min)',
    description:
      'Set submit=false to research without touching the paper ledger — useful for reviewing what it would have done.',
  })
  @ApiQuery({ name: 'submit', required: false, type: Boolean })
  async run(@Body() dto: ResearchRequest, @Query('submit') submit?: string) {
    const result = await this.research.run(dto);
    const arm = dto.arm ?? 'research';
    const execution =
      submit === 'false'
        ? { submitted: 0, skipped: result.report.plays.length, dryRun: true }
        : await this.execution.submit(result.runId, result.report, arm);
    return {
      runId: result.runId,
      costUsd: result.costUsd,
      turns: result.turns,
      durationMs: result.durationMs,
      tokens: result.tokens,
      toolCalls: result.toolCalls,
      execution,
      report: result.report,
    };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Past research runs, newest first' })
  listRuns(@Query('limit') limit = '20') {
    return this.runs.find({
      order: { id: 'DESC' },
      take: Math.min(Number(limit) || 20, 100),
      select: [
        'id', 'status', 'objective', 'model', 'costUsd', 'turns', 'durationMs',
        'totalTokens', 'bestPlay', 'candidatesScreened', 'playsProposed',
        'playsSubmitted', 'errorMessage', 'createdAt',
      ],
    });
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'One run, with its full report' })
  getRun(@Param('id', ParseIntPipe) id: number) {
    return this.runs.findOne({ where: { id } });
  }

  @Get('runs/:id/plays')
  @ApiOperation({ summary: 'Plays proposed by a run, including ones not submitted' })
  getPlays(@Param('id', ParseIntPipe) id: number) {
    return this.plays.find({ where: { runId: id }, order: { id: 'ASC' } });
  }
}
