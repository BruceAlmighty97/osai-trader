import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the correlation-group cap to the live risk rules. maxPerUnderlying stops a
 * second SPY spread but not SPY + QQQ + IWM — three positions that are one bet,
 * worth 75% of the account at 25%/position. jsonb merge so the other rules stay.
 */
export class AddMaxPerCorrelationGroupRule1788650000000
  implements MigrationInterface
{
  name = 'AddMaxPerCorrelationGroupRule1788650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = "rules" || '{"maxPerCorrelationGroup":1}'::jsonb
      WHERE "name" = 'default'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "risk_config"
      SET "rules" = "rules" - 'maxPerCorrelationGroup'
      WHERE "name" = 'default'
    `);
  }
}
