import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Strategy pivot to the 7-14 DTE defined-risk playbook (docs/playbook/).
 *
 * The risk_config row is seeded once and never re-read from DEFAULT_RULES, so
 * changing the code default alone would leave a deployed database on the old
 * concentrated profile (4 x 25%, fully deployed). This applies playbook RULES
 * S1-S5 to the existing row: 5% max loss per position, 30% of NLV in use, five
 * positions, two per correlated group. Only the listed keys are touched;
 * killSwitch and anything added later are preserved.
 */
export class PlaybookRiskRules1788720000000 implements MigrationInterface {
  name = 'PlaybookRiskRules1788720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = "rules" || '{"maxConcurrentPositions":5,"maxRiskPerTradePct":5,"maxPortfolioRiskPct":30,"maxPerUnderlying":1,"maxPerCorrelationGroup":2}'::jsonb
      WHERE "name" = 'default'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = "rules" || '{"maxConcurrentPositions":4,"maxRiskPerTradePct":25,"maxPortfolioRiskPct":100,"maxPerUnderlying":1,"maxPerCorrelationGroup":1}'::jsonb
      WHERE "name" = 'default'
    `);
  }
}
