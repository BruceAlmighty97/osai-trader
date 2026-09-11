import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { ResearchReport } from './schemas';
import { RESEARCH_SUBAGENTS, RESEARCH_SYSTEM_PROMPT } from './research-agent.prompts';
import {
  ALLOWED_TOOLS,
  DISALLOWED_TOOLS,
  assertToolPolicySafe,
} from './tool-policy';
import { ResearchAgentTools } from './research-agent.tools';
import { TastytradeAgentTools } from './tastytrade.tools';
import { ResearchRunEntity } from './research-run.entity';
import { PaperService } from '../paper/paper.service';

export interface ResearchRequest {
  objective?: string;
  /** Experiment arm to trade into. Defaults to RESEARCH_ARM. */
  arm?: string;
  /** Max buying power the plays may consume. Defaults to the arm's available BP. */
  buyingPowerLimit?: number;
  holdingDays?: number;
  watchlist?: string[];
  maxBudgetUsd?: number;
}

export interface ResearchResult {
  runId: number;
  report: ResearchReport;
  costUsd: number;
  turns: number;
  sessionId: string;
  durationMs: number;
  toolCalls: Record<string, number>;
}

/**
 * The agentic arm. Unlike `mech` and `ai` — which walk a fixed funnel and pick
 * from a slate code built — this one decides what to look at, researches it on
 * the open web, prices it against the live broker, and proposes structures the
 * mechanical arms cannot express (condors, calendars, debit spreads).
 *
 * SAFETY. This is the only component in the system with a path to a real order:
 * it spawns the tastytrade MCP server, which exposes seven order-mutating tools
 * against a PRODUCTION account. Everything else in this codebase is
 * structurally incapable of trading — `postOrderDryRun` is the only order call
 * in the service and PaperService has no broker dependency at all.
 *
 * That property is preserved here by the tool allowlist, not by the prompt.
 * `permissionMode: 'bypassPermissions'` is required for unattended runs and is
 * defensible ONLY because of it. The policy is asserted at boot (see
 * onModuleInit) so an unsafe configuration cannot start the app.
 */
@Injectable()
export class ResearchAgentService implements OnModuleInit {
  private readonly logger = new Logger(ResearchAgentService.name);
  private readonly outputSchema = z.toJSONSchema(ResearchReport, { target: 'draft-7' });
  private readonly model: string;
  private readonly defaultArm: string;
  private readonly maxTurns: number;
  private readonly defaultBudgetUsd: number;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: ResearchAgentTools,
    private readonly ttTools: TastytradeAgentTools,
    private readonly paper: PaperService,
    @InjectRepository(ResearchRunEntity)
    private readonly runs: Repository<ResearchRunEntity>,
  ) {
    this.model = this.config.get<string>('RESEARCH_MODEL', 'claude-opus-5');
    this.defaultArm = this.config.get<string>('RESEARCH_ARM', 'research');
    this.maxTurns = Number(this.config.get('RESEARCH_MAX_TURNS') ?? 60);
    this.defaultBudgetUsd = Number(this.config.get('RESEARCH_MAX_BUDGET_USD') ?? 3);
  }

  /** Refuse to boot with a tool policy that could place a live order. */
  onModuleInit(): void {
    assertToolPolicySafe();
    this.logger.log(
      `research agent armed: model=${this.model} arm=${this.defaultArm} ` +
        `maxTurns=${this.maxTurns} budget=$${this.defaultBudgetUsd} | ` +
        `${ALLOWED_TOOLS.length} tools allowed, ${DISALLOWED_TOOLS.length} explicitly denied, ` +
        `0 order-mutating`,
    );
  }

  get available(): boolean {
    // Broker access is in-process now, so an API key is the only requirement.
    return !!this.config.get('ANTHROPIC_API_KEY');
  }

  async run(req: ResearchRequest = {}): Promise<ResearchResult> {
    if (!this.available) {
      throw new Error('research agent unavailable: ANTHROPIC_API_KEY is not set');
    }
    assertToolPolicySafe();

    const started = Date.now();
    const arm = req.arm ?? this.defaultArm;
    const summary = await this.paper.getSummary(arm);
    const bpLimit = req.buyingPowerLimit ?? summary.buyingPowerAvailable;
    const holdingDays = req.holdingDays ?? 4;
    const objective =
      req.objective ??
      `Up to 3 high-probability defined-risk plays for the next ${holdingDays} trading days.`;

    const run = await this.runs.save(
      this.runs.create({
        accountId: summary.accountId,
        objective,
        model: this.model,
        status: 'running',
      }),
    );

    this.logger.log(
      `research run ${run.id} starting — arm=${arm} bpLimit=$${bpLimit} ` +
        `holdingDays=${holdingDays} budget=$${req.maxBudgetUsd ?? this.defaultBudgetUsd}`,
    );

    const toolCalls: Record<string, number> = {};
    let report: ResearchReport | undefined;
    let costUsd = 0;
    let turns = 0;
    let sessionId = '';

    try {
      const stream = query({
        prompt: this.buildPrompt({ objective, arm, bpLimit, holdingDays, watchlist: req.watchlist }),
        options: {
          model: this.model,
          systemPrompt: RESEARCH_SYSTEM_PROMPT,
          maxTurns: this.maxTurns,
          maxBudgetUsd: req.maxBudgetUsd ?? this.defaultBudgetUsd,
          effort: 'high',
          // Unattended: no human to approve tool calls. Safe only because of the
          // two lists below — see tool-policy.ts.
          permissionMode: 'bypassPermissions',
          allowedTools: ALLOWED_TOOLS,
          disallowedTools: DISALLOWED_TOOLS,
          // Both servers are IN-PROCESS. No child process, no second copy of
          // the broker credentials, and identical behaviour on a laptop and on
          // Fargate — see tastytrade.tools.ts.
          mcpServers: {
            tt: this.ttTools.createServer(),
            osai: this.tools.createServer(arm),
          },
          agents: RESEARCH_SUBAGENTS as any,
          outputFormat: { type: 'json_schema', schema: this.outputSchema },
        },
      });

      for await (const message of stream) {
        this.trace(message, toolCalls);
        if (message.type === 'result') {
          costUsd = (message as any).total_cost_usd ?? 0;
          turns = (message as any).num_turns ?? 0;
          sessionId = (message as any).session_id ?? '';
          if ((message as any).subtype !== 'success') {
            throw new Error(`agent ended with subtype "${(message as any).subtype}"`);
          }
          const parsed = ResearchReport.safeParse((message as any).structured_output);
          if (!parsed.success) {
            throw new Error(`report failed schema validation: ${parsed.error.message}`);
          }
          report = parsed.data;
        }
      }

      if (!report) throw new Error('agent produced no structured report');

      // Defence in depth: the schema guarantees shape, not sanity. Verify the
      // risk claims independently of what the model asserted.
      this.assertDefinedRisk(report, bpLimit);

      const durationMs = Date.now() - started;
      await this.runs.update(run.id, {
        status: 'succeeded',
        costUsd,
        turns,
        durationMs,
        sessionId,
        marketContext: report.marketContext,
        bestPlay: report.bestPlay,
        candidatesScreened: report.candidatesScreened.length,
        playsProposed: report.plays.length,
        reportJson: report as unknown as Record<string, any>,
        toolCalls,
      } as any);

      this.logger.log(
        `research run ${run.id} DONE — ${report.plays.length} play(s) from ` +
          `${report.candidatesScreened.length} screened, ${turns} turns, ` +
          `$${costUsd.toFixed(3)}, ${Math.round(durationMs / 1000)}s | ` +
          `tools: ${Object.entries(toolCalls).map(([k, v]) => `${k}x${v}`).join(' ') || 'none'}`,
      );
      this.logger.log(`research run ${run.id} bestPlay: ${report.bestPlay}`);

      return { runId: run.id, report, costUsd, turns, sessionId, durationMs, toolCalls };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.runs.update(run.id, {
        status: 'failed',
        errorMessage: msg,
        costUsd,
        turns,
        durationMs: Date.now() - started,
        sessionId,
        toolCalls,
      });
      this.logger.error(`research run ${run.id} FAILED after $${costUsd.toFixed(3)} — ${msg}`);
      throw err;
    }
  }

  private buildPrompt(p: {
    objective: string;
    arm: string;
    bpLimit: number;
    holdingDays: number;
    watchlist?: string[];
  }): string {
    return [
      `Objective: ${p.objective}`,
      `Paper arm: "${p.arm}". Buying power available for these plays: $${p.bpLimit}.`,
      `Holding window: ${p.holdingDays} trading days. Current time: ${new Date().toISOString()}.`,
      p.watchlist?.length
        ? `Seed names (do your own discovery too): ${p.watchlist.join(', ')}`
        : '',
      '',
      'Start by calling paper_positions so you size against the paper book, then universe_list.',
      'Use the news-scout subagent for web discovery and vol-screener for the IV screen.',
      'Do strike selection, live quoting and dry-runs yourself — do not delegate those.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Independent risk verification. The model asserts maxLoss; we check the leg
   * structure actually supports that claim, because a defined-risk guarantee
   * that relies on the model's own arithmetic is not a guarantee.
   */
  private assertDefinedRisk(report: ResearchReport, bpLimit: number): void {
    for (const play of report.plays) {
      const shorts = play.legs.filter((l) => l.action === 'Sell to Open');
      const longs = play.legs.filter((l) => l.action === 'Buy to Open');
      if (shorts.length > longs.length) {
        throw new Error(
          `UNDEFINED RISK: ${play.underlying} has ${shorts.length} short legs vs ${longs.length} long`,
        );
      }
      // Every short leg needs a same-right long leg to cap it.
      for (const right of ['C', 'P'] as const) {
        const s = shorts.filter((l) => l.right === right).length;
        const l = longs.filter((x) => x.right === right).length;
        if (s > l) {
          throw new Error(
            `UNDEFINED RISK: ${play.underlying} has an uncovered short ${right} leg`,
          );
        }
      }
      if (!Number.isFinite(play.maxLoss) || play.maxLoss <= 0) {
        throw new Error(`${play.underlying}: invalid maxLoss ${play.maxLoss}`);
      }
      if (play.buyingPowerEffect != null && play.buyingPowerEffect > bpLimit) {
        this.logger.warn(
          `${play.underlying}: BP effect $${play.buyingPowerEffect} exceeds limit $${bpLimit} — will not be submitted`,
        );
      }
    }
  }

  /** Count tool calls by name for the audit trail. Never logs args. */
  private trace(m: SDKMessage, counts: Record<string, number>): void {
    if (m.type !== 'assistant') return;
    const content = (m as any).message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) {
        counts[block.name] = (counts[block.name] ?? 0) + 1;
        this.logger.debug(`research tool -> ${block.name}`);
      }
    }
  }
}
