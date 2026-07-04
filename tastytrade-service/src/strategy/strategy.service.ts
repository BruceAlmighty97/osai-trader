import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { TastytradeService } from '../tastytrade/tastytrade.service';
import { STRATEGY_SYSTEM_PROMPT } from './system-prompt';

// JSON schema the model must fill — structured outputs guarantee a valid shape.
const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    strategy: {
      type: 'string',
      enum: [
        'bull_put_spread',
        'bear_call_spread',
        'iron_condor',
        'iron_butterfly',
        'covered_call',
        'no_trade',
      ],
    },
    marketAssessment: { type: 'string' },
    rationale: { type: 'string' },
    legs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['Sell to Open', 'Buy to Open'] },
          right: { type: 'string', enum: ['P', 'C'] },
          strike: { type: 'number' },
          targetDelta: { type: 'number' },
        },
        required: ['action', 'right', 'strike'],
        additionalProperties: false,
      },
    },
    targetCreditPerSpread: { type: 'number' },
    maxRiskPerSpread: { type: 'number' },
    expiration: { type: 'string' },
    caveats: { type: 'string' },
  },
  required: ['strategy', 'marketAssessment', 'rationale', 'legs', 'expiration'],
  additionalProperties: false,
};

@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tt: TastytradeService,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
    // Skill default: claude-opus-4-8 unless explicitly overridden.
    this.model = this.config.get<string>('STRATEGY_MODEL', 'claude-opus-4-8');
  }

  async suggest(
    symbol: string,
    dte = 35,
  ): Promise<Record<string, unknown>> {
    const started = Date.now();
    const snapshot = await this.tt.getGreeksSnapshot(symbol, dte);

    const userMessage =
      `Suggest ONE options strategy from the playbook for ${snapshot.symbol}, ` +
      `expiration ${snapshot.expiration} (${snapshot.dte} DTE). ` +
      `Underlying price ≈ ${snapshot.underlyingPrice}. Data is delayed (sandbox). ` +
      `Strike ladder with greeks:\n${JSON.stringify(snapshot.contracts)}`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SUGGESTION_SCHEMA },
      },
      system: [
        {
          type: 'text',
          text: STRATEGY_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const textBlock = response.content.find((b) => b.type === 'text') as
      | Anthropic.TextBlock
      | undefined;

    let suggestion: unknown = null;
    try {
      suggestion = textBlock ? JSON.parse(textBlock.text) : null;
    } catch (err) {
      this.logger.error(`Failed to parse suggestion JSON: ${err}`);
    }

    this.logger.log(
      `Strategy suggestion for ${symbol} in ${Date.now() - started}ms ` +
        `(in:${response.usage.input_tokens} out:${response.usage.output_tokens})`,
    );

    return {
      symbol: snapshot.symbol,
      model: this.model,
      suggestion,
      snapshot,
      usage: response.usage,
      stopReason: response.stop_reason,
    };
  }
}
