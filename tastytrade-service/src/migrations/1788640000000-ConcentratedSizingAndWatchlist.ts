import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Strategy re-orientation: concentrated sizing (4 positions at 25% each, fully
 * deployed) instead of the original 5%/40% profile, plus the seeded watchlist
 * universe that sizing implies.
 *
 * Why these symbols: at ~$625 risk/position you can buy spread WIDTH in a single
 * contract, so the penny-wide index ETFs (SPY/QQQ/IWM) are the best execution —
 * 5-wide x 1 contract is ~$500 risk for $2 of commissions. Cheap ETFs would need
 * 6+ contracts for the same risk and 6x the commissions. The non-equity names are
 * there for correlation: SPY/QQQ/IWM are one bet, and at 25%/position a single
 * gap could otherwise max out every open spread at once.
 */
export class ConcentratedSizingAndWatchlist1788640000000
  implements MigrationInterface
{
  name = 'ConcentratedSizingAndWatchlist1788640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = '{"maxConcurrentPositions":4,"maxRiskPerTradePct":25,"maxPortfolioRiskPct":100,"maxPerUnderlying":1,"killSwitch":false}'
      WHERE "name" = 'default'
    `);

    // Upsert (not DO NOTHING): an earlier seed left the metals split across
    // 'gold' / 'silver' / 'precious_metals', which would let a per-group cap
    // treat three correlated positions as diversification. Normalize them.
    await queryRunner.query(`
      INSERT INTO "watchlist" ("symbol", "description", "correlationGroup", "cadence", "enabled", "priority")
      VALUES
        ('SPY', 'S&P 500 ETF — penny-wide, weeklies',        'us_equity',       'daily', true, 100),
        ('QQQ', 'Nasdaq 100 ETF — penny-wide, weeklies',     'us_equity',       'daily', true,  90),
        ('IWM', 'Russell 2000 ETF — penny-wide, weeklies',   'us_equity',       'daily', true,  80),
        ('GLD', 'Gold ETF — equity diversifier',             'precious_metals', 'daily', true,  70),
        ('TLT', '20+yr Treasuries — rates diversifier',      'rates',           'daily', true,  60),
        ('XLE', 'Energy sector — commodity diversifier',     'energy',          'daily', true,  50),
        ('GDX', 'Gold miners — high IV, tracks gold',        'precious_metals', 'daily', true,  40),
        ('SLV', 'Silver ETF — high IV',                      'precious_metals', 'daily', true,  30)
      ON CONFLICT ("symbol") DO UPDATE SET
        "description"      = EXCLUDED."description",
        "correlationGroup" = EXCLUDED."correlationGroup",
        "priority"         = EXCLUDED."priority",
        "enabled"          = EXCLUDED."enabled"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove what this migration introduced; the rest predate it.
    await queryRunner.query(`
      DELETE FROM "watchlist" WHERE "symbol" IN ('XLE','GDX')
    `);
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = '{"maxConcurrentPositions":4,"maxRiskPerTradePct":5,"maxPortfolioRiskPct":40,"maxPerUnderlying":1,"killSwitch":false}'
      WHERE "name" = 'default'
    `);
  }
}
