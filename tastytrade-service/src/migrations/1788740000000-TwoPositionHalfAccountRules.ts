import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sizing change (2026-09-16): two concurrent positions, each allowed up to
 * half of NLV; one per underlying and one per correlated group so the pair is
 * never the same bet. Replaces the playbook's 5% / 30% / five-position profile
 * seeded by 1788720000000. Only the listed keys are touched.
 */
export class TwoPositionHalfAccountRules1788740000000 implements MigrationInterface {
  name = 'TwoPositionHalfAccountRules1788740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = "rules" || '{"maxConcurrentPositions":2,"maxRiskPerTradePct":50,"maxPortfolioRiskPct":100,"maxPerUnderlying":1,"maxPerCorrelationGroup":1}'::jsonb
      WHERE "name" = 'default'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = "rules" || '{"maxConcurrentPositions":5,"maxRiskPerTradePct":5,"maxPortfolioRiskPct":30,"maxPerUnderlying":1,"maxPerCorrelationGroup":2}'::jsonb
      WHERE "name" = 'default'
    `);
  }
}
