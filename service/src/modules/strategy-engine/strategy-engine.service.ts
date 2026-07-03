import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { MarketDataService } from '../market-data/market-data.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { OrderManagementService } from '../order-management/order-management.service';
import { RiskManagementService } from '../risk-management/risk-management.service';
import { IbkrService } from '../ibkr/ibkr.service';
import { StrategyDecisionEntity } from './strategy-decision.entity';
import { StrategyToolCallEntity } from './strategy-tool-call.entity';
import { createAgentTools } from './agent-tools';
import { STRATEGY_SYSTEM_PROMPT } from './system-prompt';
import {
  AnalysisTrigger,
  DecisionStatus,
  DecisionType,
  TokenUsage,
} from './strategy-engine.types';

@Injectable()
export class StrategyEngineService {
  private readonly logger = new Logger(StrategyEngineService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly marketData: MarketDataService,
    private readonly portfolio: PortfolioService,
    private readonly orders: OrderManagementService,
    private readonly risk: RiskManagementService,
    private readonly ibkr: IbkrService,
    @InjectRepository(StrategyDecisionEntity)
    private readonly decisionRepo: Repository<StrategyDecisionEntity>,
    @InjectRepository(StrategyToolCallEntity)
    private readonly toolCallRepo: Repository<StrategyToolCallEntity>,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
    this.model = this.configService.get<string>(
      'STRATEGY_MODEL',
      'claude-sonnet-4-6',
    );
  }

  async runAnalysis(
    trigger: AnalysisTrigger = AnalysisTrigger.MANUAL,
    underlying?: string,
  ): Promise<StrategyDecisionEntity> {
    const startTime = Date.now();
    const sessionId = uuidv4();

    this.logger.log(
      `Starting analysis session ${sessionId} — trigger: ${trigger}, underlying: ${underlying ?? 'general'}`,
    );

    if (!this.ibkr.isConnected()) {
      throw new Error('Not connected to IBKR');
    }

    const tools = createAgentTools({
      marketData: this.marketData,
      portfolio: this.portfolio,
      orders: this.orders,
      risk: this.risk,
      ibkr: this.ibkr,
    });

    const userMessage = underlying
      ? `Analyze current market conditions for ${underlying} and determine if any new positions should be opened or existing positions adjusted.`
      : `Review the portfolio and analyze market conditions for high-liquidity underlyings (SPY, QQQ, IWM). Determine if any new positions should be opened or existing positions adjusted.`;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    const tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    let toolCallSequence = 0;
    let decisionRecord = this.decisionRepo.create({
      sessionId,
      trigger,
      underlying: underlying ?? null,
      strategyType: null,
      decision: DecisionType.NO_TRADE,
      reasoning: '',
      proposedTrade: null,
      riskCheckResult: null,
      executionResult: null,
      status: DecisionStatus.PENDING,
      tokenUsage: tokenUsage as unknown as Record<string, number>,
      durationMs: 0,
      errorMessage: null,
    });

    decisionRecord = await this.decisionRepo.save(decisionRecord);

    try {
      let continueLoop = true;

      while (continueLoop) {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          temperature: 0,
          system: [
            {
              type: 'text',
              text: STRATEGY_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: tools.definitions,
          messages,
        });

        tokenUsage.inputTokens += response.usage.input_tokens;
        tokenUsage.outputTokens += response.usage.output_tokens;
        const usageAny = response.usage as unknown as Record<string, number>;
        if (usageAny.cache_creation_input_tokens) {
          tokenUsage.cacheCreationInputTokens += usageAny.cache_creation_input_tokens;
        }
        if (usageAny.cache_read_input_tokens) {
          tokenUsage.cacheReadInputTokens += usageAny.cache_read_input_tokens;
        }

        if (response.stop_reason === 'tool_use') {
          const assistantContent = response.content;
          messages.push({ role: 'assistant', content: assistantContent });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of assistantContent) {
            if (block.type !== 'tool_use') continue;

            toolCallSequence++;
            const callStart = Date.now();

            this.logger.log(
              `Tool call #${toolCallSequence}: ${block.name}(${JSON.stringify(block.input)})`,
            );

            let result: unknown;
            let isError = false;

            try {
              result = await tools.execute(
                block.name,
                block.input as Record<string, unknown>,
              );
            } catch (err) {
              result = { error: err.message };
              isError = true;
              this.logger.error(
                `Tool ${block.name} failed: ${err.message}`,
              );
            }

            const callDuration = Date.now() - callStart;

            await this.toolCallRepo.save({
              decisionId: decisionRecord.id,
              toolName: block.name,
              toolInput: block.input as Record<string, unknown>,
              toolOutput: (typeof result === 'object' ? result : { value: result }) as Record<string, unknown>,
              sequenceNumber: toolCallSequence,
              durationMs: callDuration,
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
              is_error: isError,
            });
          }

          messages.push({ role: 'user', content: toolResults });
        } else {
          continueLoop = false;

          const textBlocks = response.content.filter(
            (b) => b.type === 'text',
          );
          const reasoning = textBlocks
            .map((b) => (b as Anthropic.TextBlock).text)
            .join('\n');

          decisionRecord.reasoning = reasoning;
          decisionRecord.status = DecisionStatus.EXECUTED;

          this.logger.log(`Analysis complete — session ${sessionId}`);
        }
      }
    } catch (err) {
      decisionRecord.status = DecisionStatus.ERROR;
      decisionRecord.errorMessage = err.message;
      this.logger.error(`Analysis failed: ${err.message}`);
    }

    decisionRecord.durationMs = Date.now() - startTime;
    decisionRecord.tokenUsage = tokenUsage as unknown as Record<string, number>;

    await this.decisionRepo.save(decisionRecord);
    return decisionRecord;
  }

  async getDecisions(limit = 20): Promise<StrategyDecisionEntity[]> {
    return this.decisionRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getDecision(id: number): Promise<StrategyDecisionEntity | null> {
    return this.decisionRepo.findOne({
      where: { id },
      relations: ['toolCalls'],
    });
  }

  async getToolCalls(decisionId: number): Promise<StrategyToolCallEntity[]> {
    return this.toolCallRepo.find({
      where: { decisionId },
      order: { sequenceNumber: 'ASC' },
    });
  }
}
