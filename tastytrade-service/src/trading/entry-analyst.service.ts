import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { SelectorChoice, SpreadPlan } from './entry.types';
import { PaperAccountSummary } from '../paper/paper.types';
import { PositionEntity } from '../persistence/entities/position.entity';
import { ENTRY_ANALYST_SYSTEM_PROMPT } from './entry-analyst.prompt';

/**
 * The model may only choose from the slate the code built. It cannot name a
 * symbol, invent a strike, or move an expiration — `pick` is an index, so the
 * worst it can do is choose a spread we already priced and validated, or pass.
 */
const CHOICE_SCHEMA = {
  type: 'object',
  properties: {
    pick: {
      type: ['integer', 'null'],
      description:
        'Index of the chosen plan in the slate, or null to open nothing today.',
    },
    rationale: {
      type: 'string',
      description: 'Why this plan (or why nothing). Two or three sentences.',
    },
    portfolioFit: {
      type: 'string',
      description:
        'How the pick interacts with the positions already open — real economic overlap, not just the correlation tag.',
    },
    concerns: {
      type: 'string',
      description: 'What would make this trade go wrong.',
    },
  },
  required: ['pick', 'rationale', 'portfolioFit', 'concerns'],
  additionalProperties: false,
};

export interface AnalystInput {
  date: string;
  slate: SpreadPlan[];
  account: PaperAccountSummary;
  open: PositionEntity[];
  riskBudget: number;
}

/**
 * The AI entry selector. Code narrows the field, prices concrete spreads and
 * scores them; this layer applies the judgment that is genuinely hard to write
 * down — how a candidate sits against the book we already hold, whether the
 * score leader is actually the best risk-adjusted choice, and whether today is
 * a day to sit out.
 *
 * Deliberately bounded: no tools, no arithmetic, no strike invention, and the
 * deterministic risk gate still runs on whatever comes back.
 */
@Injectable()
export class EntryAnalystService {
  private readonly logger = new Logger(EntryAnalystService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.model = config.get<string>('ENTRY_MODEL', 'claude-opus-5');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!this.client) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — AI entry selection will fall back to the mechanical score',
      );
    }
  }

  get available(): boolean {
    return this.client !== null;
  }

  /**
   * Ask the model to pick one plan from the slate. Never throws: any failure
   * degrades to the mechanical top pick, with the reason recorded.
   */
  async choose(input: AnalystInput): Promise<SelectorChoice> {
    const fallback = (reason: string): SelectorChoice => ({
      source: 'mechanical',
      pick: 0,
      rationale: `Mechanical top score (AI unavailable: ${reason})`,
      fallbackReason: reason,
    });

    if (!this.client) return fallback('no ANTHROPIC_API_KEY');

    const started = Date.now();
    const userMessage = this.buildUserMessage(input);

    this.logger.log(
      `entry-analyst: asking ${this.model} to choose from ${input.slate.length} plans ` +
        `[${input.slate.map((p) => p.symbol).join(', ')}] against ${input.open.length} open position(s)`,
    );
    this.logger.debug(`entry-analyst: prompt\n${userMessage}`);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: CHOICE_SCHEMA },
        },
        system: [
          {
            type: 'text',
            text: ENTRY_ANALYST_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      } as Anthropic.MessageCreateParamsNonStreaming);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`entry-analyst: model call failed — ${msg}`);
      return fallback(`model call failed: ${msg}`);
    }

    const durationMs = Date.now() - started;
    const tokenUsage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    };

    const textBlock = response.content.find((b) => b.type === 'text') as
      | Anthropic.TextBlock
      | undefined;

    let parsed: any = null;
    try {
      parsed = textBlock ? JSON.parse(textBlock.text) : null;
    } catch (err) {
      this.logger.error(
        `entry-analyst: unparseable JSON response — ${err instanceof Error ? err.message : err}`,
      );
    }
    if (!parsed) return fallback('unparseable response');

    // Trust nothing: the index must actually address a plan we built.
    const raw = parsed.pick;
    let pick: number | null = null;
    if (raw !== null && raw !== undefined) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n >= input.slate.length) {
        this.logger.error(
          `entry-analyst: pick ${JSON.stringify(raw)} out of range for slate of ` +
            `${input.slate.length} — falling back to mechanical`,
        );
        return { ...fallback(`pick out of range: ${JSON.stringify(raw)}`), tokenUsage, durationMs };
      }
      pick = n;
    }

    const choice: SelectorChoice = {
      source: 'ai',
      pick,
      rationale: clean(parsed.rationale),
      portfolioFit: nonEmpty(parsed.portfolioFit),
      concerns: nonEmpty(parsed.concerns),
      model: this.model,
      tokenUsage,
      durationMs,
    };

    const what =
      pick === null ? 'PASS (open nothing)' : `${input.slate[pick].symbol} [#${pick}]`;
    this.logger.log(
      `entry-analyst: chose ${what} in ${durationMs}ms ` +
        `(in:${tokenUsage.input} out:${tokenUsage.output} ` +
        `cacheRead:${tokenUsage.cacheRead} stop:${response.stop_reason})`,
    );
    this.logger.log(`entry-analyst: rationale — ${choice.rationale}`);
    if (choice.portfolioFit) {
      this.logger.log(`entry-analyst: portfolio fit — ${choice.portfolioFit}`);
    }
    if (choice.concerns) {
      this.logger.log(`entry-analyst: concerns — ${choice.concerns}`);
    }

    return choice;
  }

  /** The day's facts. Everything numeric is precomputed — the model does no math. */
  private buildUserMessage(input: AnalystInput): string {
    const { date, slate, account, open, riskBudget } = input;

    const book = open.length
      ? open
          .map((p) => {
            const strikes = (p.legs ?? [])
              .map((l) => `${l.strike}${l.right}`)
              .join('/');
            return (
              `- ${p.symbol} ${p.strategy} ${strikes} exp ${p.expiration} ` +
              `x${p.quantity}, credit ${p.entryCredit}, risk $${p.maxRisk}`
            );
          })
          .join('\n')
      : '- (none — the account is entirely in cash)';

    const plans = slate
      .map((p, i) => {
        const sentiment =
          p.bullish === null && p.bearish === null
            ? 'n/a'
            : `${p.bullish ?? 0} bullish / ${p.bearish ?? 0} bearish`;
        return [
          `[${i}] ${p.symbol}${p.correlationGroup ? ` (group: ${p.correlationGroup})` : ' (ungrouped single stock)'}`,
          `    bull put spread ${p.shortStrike}/${p.longStrike}P, exp ${p.expiration} (${p.dte} DTE)`,
          `    underlying ${p.underlyingPrice}, short strike is ${pct((p.underlyingPrice - p.shortStrike) / p.underlyingPrice)} below spot`,
          `    short delta ${p.shortDelta.toFixed(3)}, width ${p.width}`,
          `    credit $${(p.credit * 100).toFixed(0)} / max risk $${(p.riskPerShare * 100).toFixed(0)} (credit is ${pct(p.creditToWidth)} of width)`,
          `    IV rank ${p.ivRank ?? 'n/a'}, quote spread ${pct(p.avgRelSpread)}, StockTwits ${sentiment}`,
          `    deterministic score ${p.score.toFixed(1)}/100 ` +
            `(r/r ${p.scoreParts.creditToWidth.toFixed(2)}, delta fit ${p.scoreParts.deltaFit.toFixed(2)}, ` +
            `IVR ${p.scoreParts.ivRank.toFixed(2)}, liquidity ${p.scoreParts.liquidity.toFixed(2)})`,
        ].join('\n');
      })
      .join('\n\n');

    return [
      `Date: ${date} (ET)`,
      '',
      'ACCOUNT',
      `- Settled value: $${account.settledValue}`,
      `- Buying power available: $${account.buyingPowerAvailable}`,
      `- Open positions: ${account.openPositions} of ${account.rules.maxConcurrentPositions} allowed`,
      `- Risk budget for this trade: $${riskBudget.toFixed(0)} (${account.rules.maxRiskPerTradePct}% of settled value)`,
      `- Closed record: ${account.wins}W / ${account.losses}L / ${account.scratches}S` +
        (account.winRate === null ? '' : ` (${pct(account.winRate)} win rate)`),
      '',
      'CURRENTLY HELD',
      book,
      '',
      `SLATE — ${slate.length} spread(s), already priced and validated, ordered by deterministic score:`,
      '',
      plans,
      '',
      'Choose one index from the slate, or null to open nothing today.',
    ].join('\n');
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
/**
 * Structured output sometimes comes back double-escaped ("\\u2014", "\\/"),
 * which JSON.parse leaves as literal backslash sequences. These strings land in
 * the decision audit and the position notes, so unescape them before storing.
 */
function clean(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\\//g, '/')
    .trim();
}
function nonEmpty(v: unknown): string | undefined {
  const s = clean(v);
  return s.length ? s : undefined;
}
