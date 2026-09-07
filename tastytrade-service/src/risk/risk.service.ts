import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskConfigEntity } from './risk-config.entity';
import { WatchlistEntity } from '../persistence/entities/watchlist.entity';
import {
  DEFAULT_RULES,
  RiskCheckContext,
  RiskCheckResult,
  RiskRules,
  UpdateRulesDto,
} from './risk.types';

const DEFAULT_CONFIG = 'default';

/**
 * Owns the risk policy AND enforces the pre-trade gate. Shared by the paper
 * engine now and the live engine later — one source of truth for both.
 */
@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    @InjectRepository(RiskConfigEntity)
    private readonly configs: Repository<RiskConfigEntity>,
    @InjectRepository(WatchlistEntity)
    private readonly watchlist: Repository<WatchlistEntity>,
  ) {}

  async getOrCreateConfig(): Promise<RiskConfigEntity> {
    let cfg = await this.configs.findOne({ where: { name: DEFAULT_CONFIG } });
    if (!cfg) {
      cfg = await this.configs.save(
        this.configs.create({ name: DEFAULT_CONFIG, rules: DEFAULT_RULES }),
      );
      this.logger.log('Seeded default risk config (Moderate profile).');
    }
    return cfg;
  }

  async getRules(): Promise<RiskRules> {
    return (await this.getOrCreateConfig()).rules;
  }

  async updateRules(patch: UpdateRulesDto): Promise<RiskRules> {
    const cfg = await this.getOrCreateConfig();
    cfg.rules = { ...cfg.rules, ...patch };
    const saved = await this.configs.save(cfg);
    this.logger.log(`Risk rules updated: ${JSON.stringify(saved.rules)}`);
    return saved.rules;
  }

  /**
   * The gate. Given the account state + a proposed trade (all $), decide whether
   * it's allowed. Percentage caps are resolved against `accountValue` here, so
   * the same policy scales across accounts of any size.
   *
   * Every decision is logged with its reason — when a trade doesn't happen, the
   * log is the only record of why.
   */
  async check(ctx: RiskCheckContext): Promise<RiskCheckResult> {
    const held = ctx.openPositions.map((p) => p.symbol).join(',') || 'none';
    const where =
      `${ctx.symbol} risk=$${round2(ctx.proposedRisk)} ` +
      `acct=$${round2(ctx.accountValue)} bpAvail=$${round2(ctx.buyingPowerAvailable)} ` +
      `open=[${held}]`;
    const result = await this.evaluate(ctx);
    if (result.ok) {
      this.logger.log(`Risk gate PASSED — ${where}`);
    } else {
      this.logger.warn(`Risk gate REJECTED — ${where} — ${result.reason}`);
    }
    return result;
  }

  private async evaluate(ctx: RiskCheckContext): Promise<RiskCheckResult> {
    const rules = await this.getRules();

    if (rules.killSwitch) {
      return { ok: false, reason: 'kill switch is on — new positions blocked' };
    }
    if (ctx.openPositions.length >= rules.maxConcurrentPositions) {
      return {
        ok: false,
        reason: `at max concurrent positions (${rules.maxConcurrentPositions})`,
      };
    }
    const inSymbol = ctx.openPositions.filter(
      (p) => p.symbol === ctx.symbol,
    ).length;
    if (inSymbol >= rules.maxPerUnderlying) {
      return {
        ok: false,
        reason: `at max positions for ${ctx.symbol} (${rules.maxPerUnderlying})`,
      };
    }

    // Correlated concentration: SPY + QQQ + IWM are one bet, and maxPerUnderlying
    // won't catch that. Groups come from the watchlist, so callers don't have to
    // know about correlation at all.
    const groupCap = rules.maxPerCorrelationGroup ?? 1;
    if (groupCap > 0) {
      const groups = await this.correlationGroups();
      const proposedGroup = groups.get(ctx.symbol);
      // No group (unknown symbol / ungrouped) → nothing to correlate against.
      if (proposedGroup) {
        const peers = ctx.openPositions.filter(
          (p) => groups.get(p.symbol) === proposedGroup,
        );
        if (peers.length >= groupCap) {
          return {
            ok: false,
            reason:
              `at max positions for correlation group "${proposedGroup}" ` +
              `(${groupCap}) — already holding ${peers
                .map((p) => p.symbol)
                .join(', ')}`,
          };
        }
      }
    }
    const perTradeCap = (ctx.accountValue * rules.maxRiskPerTradePct) / 100;
    if (ctx.proposedRisk > perTradeCap) {
      return {
        ok: false,
        reason: `risk $${round2(ctx.proposedRisk)} exceeds per-trade cap $${round2(perTradeCap)} (${rules.maxRiskPerTradePct}%)`,
      };
    }
    const portfolioCap = (ctx.accountValue * rules.maxPortfolioRiskPct) / 100;
    const currentRisk = ctx.openPositions.reduce((s, p) => s + p.risk, 0);
    if (currentRisk + ctx.proposedRisk > portfolioCap) {
      return {
        ok: false,
        reason: `portfolio risk $${round2(currentRisk + ctx.proposedRisk)} exceeds cap $${round2(portfolioCap)} (${rules.maxPortfolioRiskPct}%)`,
      };
    }
    if (ctx.proposedRisk > ctx.buyingPowerAvailable) {
      return {
        ok: false,
        reason: `insufficient buying power: needs $${round2(ctx.proposedRisk)}, available $${round2(ctx.buyingPowerAvailable)}`,
      };
    }
    return { ok: true };
  }

  /** symbol -> correlationGroup, from the watchlist (small table, read per check). */
  private async correlationGroups(): Promise<Map<string, string>> {
    const rows = await this.watchlist.find();
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.correlationGroup) map.set(r.symbol, r.correlationGroup);
    }
    return map;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
