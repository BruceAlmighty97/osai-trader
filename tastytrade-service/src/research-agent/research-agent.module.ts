import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResearchAgentService } from './research-agent.service';
import { ResearchAgentTools } from './research-agent.tools';
import { TastytradeAgentTools } from './tastytrade.tools';
import { ResearchExecutionService } from './research-execution.service';
import { ResearchAgentController } from './research-agent.controller';
import { ResearchScheduler } from './research.scheduler';
import { ResearchRunEntity } from './research-run.entity';
import { ResearchPlayEntity } from './research-play.entity';
import { WatchlistEntity } from '../persistence/entities/watchlist.entity';
import { PaperModule } from '../paper/paper.module';
import { TastytradeModule } from '../tastytrade/tastytrade.module';
import { FinnhubModule } from '../finnhub/finnhub.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

/**
 * The agentic arm — web research + live broker data + Claude, trading into its
 * own paper account.
 *
 * Broker access is in-process (TastytradeAgentTools wrapping this app's own
 * TastytradeService), NOT tastytrade's MCP server. That keeps the codebase-wide
 * property intact: `postOrderDryRun` is the only order call anywhere in this
 * process, so no order-placing capability exists to be gated. See
 * tastytrade.tools.ts and tool-policy.ts.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ResearchRunEntity, ResearchPlayEntity, WatchlistEntity]),
    PaperModule,
    OrchestratorModule,
    TastytradeModule,
    FinnhubModule,
  ],
  controllers: [ResearchAgentController],
  providers: [
    ResearchAgentService,
    ResearchAgentTools,
    TastytradeAgentTools,
    ResearchExecutionService,
    ResearchScheduler,
  ],
  exports: [ResearchAgentService, ResearchExecutionService],
})
export class ResearchAgentModule {}
