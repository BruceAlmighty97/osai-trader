import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaperAccountEntity } from './paper-account.entity';
import { PositionEntity } from '../persistence/entities/position.entity';
import {
  ExitReason,
  OptionLeg,
  PositionStatus,
} from '../persistence/persistence.types';
import {
  COMMISSION_PER_CONTRACT,
  ClosePositionDto,
  IS_PAPER,
  OpenFromSuggestionDto,
  PaperAccountSummary,
  TRADING_MODE,
} from './paper.types';
import { RiskService } from '../risk/risk.service';

/** The baseline arm — what unqualified calls resolve to. */
const DEFAULT_ACCOUNT = 'mech';
const MULTIPLIER = 100; // options are per-100-shares

@Injectable()
export class PaperService {
  private readonly logger = new Logger(PaperService.name);

  constructor(
    @InjectRepository(PaperAccountEntity)
    private readonly accounts: Repository<PaperAccountEntity>,
    @InjectRepository(PositionEntity)
    private readonly positions: Repository<PositionEntity>,
    private readonly risk: RiskService,
  ) {
    this.logger.log(`TRADING_MODE=${TRADING_MODE} (paper=${IS_PAPER})`);
  }

  /** Lazily create the baseline arm so a fresh DB has something to trade in. */
  async getOrCreateAccount(name = DEFAULT_ACCOUNT): Promise<PaperAccountEntity> {
    let acct = await this.accounts.findOne({ where: { name } });
    if (!acct) {
      if (name !== DEFAULT_ACCOUNT) {
        throw new NotFoundException(`no experiment arm named "${name}"`);
      }
      acct = await this.accounts.save(
        this.accounts.create({
          name: DEFAULT_ACCOUNT,
          description: 'Baseline: highest deterministic score.',
          config: { selector: 'mechanical' },
        }),
      );
      this.logger.log(
        `Created paper arm "${DEFAULT_ACCOUNT}" starting at $${acct.startingBalance}`,
      );
    }
    return acct;
  }

  /** Every arm, newest config first — the A/B roster. */
  async listArms(enabledOnly = false): Promise<PaperAccountEntity[]> {
    const arms = await this.accounts.find({ order: { id: 'ASC' } });
    if (!arms.length) return [await this.getOrCreateAccount()];
    return enabledOnly ? arms.filter((a) => a.enabled) : arms;
  }

  /** Everything but startingBalance is derived from the positions table. */
  async getSummary(accountName?: string): Promise<PaperAccountSummary> {
    const acct = await this.getOrCreateAccount(accountName ?? DEFAULT_ACCOUNT);
    const starting = num(acct.startingBalance);

    const open = await this.positions.find({
      where: { status: PositionStatus.OPEN, accountId: acct.id },
    });
    const closed = await this.positions.find({
      where: { status: PositionStatus.CLOSED, accountId: acct.id },
    });

    const buyingPowerUsed = open.reduce(
      (sum, p) => sum + num(p.maxRisk) * p.quantity,
      0,
    );
    const realizedPnl = closed.reduce((sum, p) => sum + num(p.realizedPnl), 0);

    let wins = 0;
    let losses = 0;
    let scratches = 0;
    for (const p of closed) {
      const pnl = num(p.realizedPnl);
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      else scratches++;
    }

    const settledValue = starting + realizedPnl;
    const decided = wins + losses;

    return {
      name: acct.name,
      accountId: acct.id,
      description: acct.description,
      enabled: acct.enabled,
      config: acct.config ?? {},
      startingBalance: round2(starting),
      rules: await this.risk.getRules(),
      realizedPnl: round2(realizedPnl),
      settledValue: round2(settledValue),
      buyingPowerUsed: round2(buyingPowerUsed),
      buyingPowerAvailable: round2(settledValue - buyingPowerUsed),
      openPositions: open.length,
      closedPositions: closed.length,
      wins,
      losses,
      scratches,
      winRate: decided > 0 ? round2(wins / decided) : null,
    };
  }

  /** Record an AI-suggested play as an open imaginary position. */
  async openFromSuggestion(dto: OpenFromSuggestionDto): Promise<PositionEntity> {
    const contracts = dto.contracts ?? 1;
    if (!Number.isInteger(contracts) || contracts < 1) {
      throw new BadRequestException('contracts must be a positive integer');
    }
    if (!dto.legs?.length) {
      throw new BadRequestException('legs must not be empty');
    }
    const credit = num(dto.creditPerSpread); // per share
    const maxRiskPerShare = num(dto.maxRiskPerSpread); // per share
    if (credit < 0) throw new BadRequestException('creditPerSpread must be >= 0');
    if (maxRiskPerShare <= 0) {
      throw new BadRequestException('maxRiskPerSpread must be > 0');
    }
    const symbol = dto.symbol.toUpperCase();
    // Defined risk in dollars: per-share risk * 100 * units.
    const riskPerUnit = maxRiskPerShare * MULTIPLIER;
    const positionRisk = riskPerUnit * contracts;

    // Arm-scoped: the gate sees only THIS arm's book, so arms can hold the same
    // symbol without blocking each other.
    const acct = await this.getOrCreateAccount(dto.account ?? DEFAULT_ACCOUNT);
    const summary = await this.getSummary(acct.name);
    const open = await this.positions.find({
      where: { status: PositionStatus.OPEN, accountId: acct.id },
    });
    const gate = await this.risk.check({
      accountValue: summary.settledValue,
      buyingPowerAvailable: summary.buyingPowerAvailable,
      openPositions: open.map((p) => ({
        symbol: p.symbol,
        risk: num(p.maxRisk) * p.quantity,
      })),
      symbol,
      proposedRisk: positionRisk,
    });
    if (!gate.ok) {
      throw new BadRequestException(`Risk gate rejected trade: ${gate.reason}`);
    }

    const legs: OptionLeg[] = dto.legs.map((l) => ({
      action: l.action,
      right: l.right,
      strike: l.strike,
      quantity: 1,
      // Persisted so mark-to-market can re-quote the exact contract later.
      ...(l.streamerSymbol ? { streamerSymbol: l.streamerSymbol } : {}),
    }));

    const position = this.positions.create({
      symbol,
      strategy: dto.strategy,
      expiration: dto.expiration,
      legs,
      quantity: contracts,
      entryCredit: credit,
      maxRisk: riskPerUnit, // $ per spread unit (matches getSummary/bpUsed)
      status: PositionStatus.OPEN,
      accountId: acct.id,
      openDecisionId: dto.decisionId ?? null,
      notes: dto.notes ?? null,
      openedAt: new Date(),
    });
    const saved = await this.positions.save(position);
    this.logger.log(
      `Opened paper ${dto.strategy} on ${saved.symbol} x${contracts} @ ${credit} credit ` +
        `(id=${saved.id}, arm=${acct.name})`,
    );
    return saved;
  }

  /** Close an open position at a given debit and realize the P&L. */
  async close(id: number, dto: ClosePositionDto): Promise<PositionEntity> {
    const position = await this.positions.findOne({ where: { id } });
    if (!position) throw new NotFoundException(`position ${id} not found`);
    if (position.status !== PositionStatus.OPEN) {
      throw new BadRequestException(`position ${id} is already closed`);
    }
    const closeDebit = num(dto.closeDebitPerSpread);
    if (closeDebit < 0) {
      throw new BadRequestException('closeDebitPerSpread must be >= 0');
    }

    const qty = position.quantity;
    const entryCredit = num(position.entryCredit);
    const contractsTotal = position.legs.length * qty;
    const commission = COMMISSION_PER_CONTRACT * contractsTotal; // open only
    const realizedPnl =
      (entryCredit - closeDebit) * MULTIPLIER * qty - commission;

    position.status = PositionStatus.CLOSED;
    position.closedAt = new Date();
    position.exitReason = dto.exitReason ?? ExitReason.MANUAL;
    position.realizedPnl = round2(realizedPnl);
    const saved = await this.positions.save(position);
    this.logger.log(
      `Closed paper position ${id} @ ${closeDebit} debit → P&L $${saved.realizedPnl}`,
    );
    return saved;
  }

  /** Positions for one arm. Pass accountName=null to list across all arms. */
  async listPositions(
    status?: PositionStatus,
    accountName?: string | null,
  ): Promise<PositionEntity[]> {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (accountName !== null) {
      const acct = await this.getOrCreateAccount(accountName ?? DEFAULT_ACCOUNT);
      where.accountId = acct.id;
    }
    return this.positions.find({ where, order: { openedAt: 'DESC' } });
  }
}

/** TypeORM returns `decimal` columns as strings — coerce safely. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
