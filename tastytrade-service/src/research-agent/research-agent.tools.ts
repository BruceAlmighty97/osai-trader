import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { WatchlistEntity } from '../persistence/entities/watchlist.entity';
import { PaperService } from '../paper/paper.service';
import { MarketCalendarService } from '../orchestrator/market-calendar.service';
import { PositionStatus } from '../persistence/persistence.types';
import { buildOccSymbol } from './occ';
import {
  CORE_ETFS,
  expectedMove,
  proxiesForThemes,
  SECTOR_PROXIES,
  spreadMath,
} from './universe';

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
});

/**
 * Project logic exposed to the agent as in-process MCP tools.
 *
 * Everything here is deterministic and read-only. The division of labour is the
 * same one that works elsewhere in this codebase: CODE COMPUTES, THE MODEL
 * CHOOSES. Expected move, OCC padding and spread economics are exactly the kind
 * of arithmetic a model gets subtly wrong, and a 100x IV-units error or a
 * mispadded strike is silently catastrophic rather than loudly wrong.
 */
@Injectable()
export class ResearchAgentTools {
  private readonly logger = new Logger(ResearchAgentTools.name);

  constructor(
    @InjectRepository(WatchlistEntity)
    private readonly watchlist: Repository<WatchlistEntity>,
    private readonly paper: PaperService,
    private readonly calendar: MarketCalendarService,
  ) {}

  /** Built per run so the arm name can be closed over. */
  createServer(armName: string) {
    return createSdkMcpServer({
      name: 'osai',
      version: '1.0.0',
      tools: [
        tool(
          'universe_list',
          'The standing candidate universe: the project watchlist unioned with core liquid ETFs. Always available regardless of news flow.',
          {},
          async () => {
            const rows = await this.watchlist.find();
            const symbols = [
              ...new Set([...rows.map((r) => r.symbol.toUpperCase()), ...CORE_ETFS]),
            ].sort();
            this.logger.log(`tool universe_list -> ${symbols.length} symbols`);
            return ok({
              count: symbols.length,
              symbols,
              note: 'Screen this whole list with get_market_metrics in chunks of <=25. Web discovery ADDS names, it does not replace this.',
            });
          },
        ),

        tool(
          'sector_proxies',
          'Map macro themes (oil, yields, inflation, semis, defense, gold, crypto, retail) to the instruments that express them.',
          { themes: z.array(z.string()).describe('Free-text themes from news, e.g. ["OPEC supply","CPI"]') },
          async ({ themes }) => {
            const res = proxiesForThemes(themes);
            this.logger.log(
              `tool sector_proxies(${themes.join('|')}) -> ${res.symbols.length} symbols` +
                (res.unmatched.length ? ` (unmatched: ${res.unmatched.join(', ')})` : ''),
            );
            return ok({ ...res, availableThemes: Object.keys(SECTOR_PROXIES) });
          },
        ),

        tool(
          'expected_move',
          'Expected move for a holding window: price x IV x sqrt(DTE/252). Use the IV of the CHOSEN expiry, not the 30-day index. Returns 1x, 1.3x and 1.5x bands.',
          {
            price: z.number().positive(),
            iv: z.number().positive().describe('Either 0.41 or 41 — both accepted'),
            dte: z.number().nonnegative().describe('Calendar days to the chosen expiration'),
          },
          async ({ price, iv, dte }) => ok(expectedMove(price, iv, dte)),
        ),

        tool(
          'build_occ_symbol',
          'Build a correctly padded OCC option symbol. Always use this instead of constructing one yourself — the padding rules are where errors hide.',
          {
            root: z.string(),
            expiration: z.string().describe('YYYY-MM-DD'),
            right: z.enum(['C', 'P']),
            strike: z.number().positive(),
          },
          async (args) => {
            const occ = buildOccSymbol(args);
            return ok({ occSymbol: occ });
          },
        ),

        tool(
          'spread_math',
          'Compute net credit, max loss, max profit, breakevens, POP and return-on-risk from leg mids and deltas. Single source of truth, shared with the paper engine — do not compute these yourself.',
          {
            legs: z.array(
              z.object({
                action: z.enum(['Sell to Open', 'Buy to Open']),
                right: z.enum(['C', 'P']),
                strike: z.number(),
                mid: z.number(),
                delta: z.number().nullable().optional(),
                quantity: z.number().int().positive().optional(),
              }),
            ),
          },
          async ({ legs }) => ok(spreadMath(legs as any)),
        ),

        tool(
          'paper_positions',
          'The research arm\'s CURRENT paper book and remaining buying power. Size against this, never against the live broker account (which is a different thing entirely).',
          {},
          async () => {
            const summary = await this.paper.getSummary(armName);
            const open = await this.paper.listPositions(PositionStatus.OPEN, armName);
            this.logger.log(
              `tool paper_positions -> arm=${armName} open=${open.length} bpAvail=$${summary.buyingPowerAvailable}`,
            );
            return ok({
              arm: armName,
              settledValue: summary.settledValue,
              buyingPowerAvailable: summary.buyingPowerAvailable,
              buyingPowerUsed: summary.buyingPowerUsed,
              openPositions: open.length,
              maxConcurrentPositions: summary.rules.maxConcurrentPositions,
              maxRiskPerTradePct: summary.rules.maxRiskPerTradePct,
              maxRiskPerTradeUsd:
                Math.round(
                  ((summary.settledValue * summary.rules.maxRiskPerTradePct) / 100) * 100,
                ) / 100,
              positions: open.map((p) => ({
                id: p.id,
                symbol: p.symbol,
                strategy: p.strategy,
                expiration: p.expiration,
                legs: p.legs,
                entryCredit: p.entryCredit,
                maxRisk: p.maxRisk,
              })),
              note: 'A deterministic risk gate runs AFTER you: max positions, per-underlying and per-correlation-group caps. Do not attempt to enforce them yourself, but do not propose a play whose maxLoss exceeds maxRiskPerTradeUsd — it will be rejected.',
            });
          },
        ),

        tool(
          'holding_window',
          'Trading days and NYSE closures across a holding window, so expirations are chosen against a real calendar rather than assumed.',
          { days: z.number().int().positive().max(60).default(4) },
          async ({ days }) => {
            const out: { date: string; tradingDay: boolean; earlyClose: boolean }[] = [];
            const cur = new Date();
            for (let i = 0; i <= days + 10 && out.length <= days + 10; i++) {
              const d = new Date(cur.getTime() + i * 86_400_000);
              out.push({
                date: etDate(d),
                tradingDay: this.calendar.isTradingDay(d),
                earlyClose: this.calendar.isEarlyClose(d),
              });
            }
            const tradingDays = out.filter((d) => d.tradingDay).map((d) => d.date);
            return ok({
              today: etDate(cur),
              requestedHoldingDays: days,
              tradingDays: tradingDays.slice(0, days + 6),
              closures: out.filter((d) => !d.tradingDay).map((d) => d.date),
              earlyCloses: out.filter((d) => d.earlyClose).map((d) => d.date),
              note: 'Macro dates (CPI/PPI/FOMC) are NOT in this calendar — get those from the web and avoid expiries that land on an FOMC decision day.',
            });
          },
        ),
      ],
    });
  }
}

function etDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
