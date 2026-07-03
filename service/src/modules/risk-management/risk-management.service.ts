import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskConfigEntity } from './risk-config.entity';
import {
  RiskConfigData,
  UpdateRiskConfigDto,
  DEFAULT_RISK_CONFIG,
} from './risk-config.types';

@Injectable()
export class RiskManagementService implements OnModuleInit {
  private readonly logger = new Logger(RiskManagementService.name);

  constructor(
    @InjectRepository(RiskConfigEntity)
    private readonly riskConfigRepo: Repository<RiskConfigEntity>,
  ) {}

  async onModuleInit() {
    await this.ensureConfigExists();
  }

  private async ensureConfigExists(): Promise<void> {
    const existing = await this.riskConfigRepo.findOne({ where: {} });
    if (!existing) {
      this.logger.log('No risk config found — seeding defaults');
      await this.riskConfigRepo.save({ config: DEFAULT_RISK_CONFIG });
    }
  }

  async getConfig(): Promise<RiskConfigData> {
    const entity = await this.riskConfigRepo.findOne({ where: {} });
    return entity?.config ?? DEFAULT_RISK_CONFIG;
  }

  async updateConfig(updates: UpdateRiskConfigDto): Promise<RiskConfigData> {
    let entity = await this.riskConfigRepo.findOne({ where: {} });
    if (!entity) {
      entity = this.riskConfigRepo.create({ config: DEFAULT_RISK_CONFIG });
    }

    entity.config = { ...entity.config, ...updates };
    await this.riskConfigRepo.save(entity);

    this.logger.log(`Risk config updated: ${JSON.stringify(updates)}`);
    return entity.config;
  }

  async resetConfig(): Promise<RiskConfigData> {
    let entity = await this.riskConfigRepo.findOne({ where: {} });
    if (!entity) {
      entity = this.riskConfigRepo.create({ config: DEFAULT_RISK_CONFIG });
    } else {
      entity.config = DEFAULT_RISK_CONFIG;
    }

    await this.riskConfigRepo.save(entity);
    this.logger.log('Risk config reset to defaults');
    return entity.config;
  }

  // --- Pre-trade validation ---

  async validateTrade(trade: {
    positionSize: number;
    notionalValue: number;
    currentOpenPositions: number;
    portfolioDelta: number;
    portfolioGamma: number;
    buyingPowerUsage: number;
    marginUsage: number;
    dailyLoss: number;
    weeklyLoss: number;
    dataAgeSeconds: number;
  }): Promise<{ approved: boolean; violations: string[] }> {
    const config = await this.getConfig();
    const violations: string[] = [];

    if (!config.tradingEnabled) {
      violations.push('Trading is disabled (kill switch)');
    }

    if (trade.positionSize > config.maxPositionSize) {
      violations.push(
        `Position size ${trade.positionSize} exceeds max ${config.maxPositionSize}`,
      );
    }

    if (trade.notionalValue > config.maxNotionalPerTrade) {
      violations.push(
        `Notional value $${trade.notionalValue} exceeds max $${config.maxNotionalPerTrade}`,
      );
    }

    if (trade.currentOpenPositions >= config.maxOpenPositions) {
      violations.push(
        `Open positions ${trade.currentOpenPositions} at max ${config.maxOpenPositions}`,
      );
    }

    if (Math.abs(trade.portfolioDelta) > config.maxPortfolioDelta) {
      violations.push(
        `Portfolio delta ${trade.portfolioDelta} exceeds max ${config.maxPortfolioDelta}`,
      );
    }

    if (Math.abs(trade.portfolioGamma) > config.maxPortfolioGamma) {
      violations.push(
        `Portfolio gamma ${trade.portfolioGamma} exceeds max ${config.maxPortfolioGamma}`,
      );
    }

    if (trade.buyingPowerUsage > config.maxBuyingPowerUsage) {
      violations.push(
        `Buying power usage ${(trade.buyingPowerUsage * 100).toFixed(1)}% exceeds max ${(config.maxBuyingPowerUsage * 100).toFixed(1)}%`,
      );
    }

    if (trade.marginUsage > config.maxMarginUsage) {
      violations.push(
        `Margin usage ${(trade.marginUsage * 100).toFixed(1)}% exceeds max ${(config.maxMarginUsage * 100).toFixed(1)}%`,
      );
    }

    if (trade.dailyLoss > config.maxDailyLoss) {
      violations.push(
        `Daily loss $${trade.dailyLoss} exceeds max $${config.maxDailyLoss}`,
      );
    }

    if (trade.weeklyLoss > config.maxWeeklyLoss) {
      violations.push(
        `Weekly loss $${trade.weeklyLoss} exceeds max $${config.maxWeeklyLoss}`,
      );
    }

    if (trade.dataAgeSeconds > config.dataFreshnessMaxAge) {
      violations.push(
        `Market data is ${trade.dataAgeSeconds}s old, max allowed ${config.dataFreshnessMaxAge}s`,
      );
    }

    return {
      approved: violations.length === 0,
      violations,
    };
  }
}
