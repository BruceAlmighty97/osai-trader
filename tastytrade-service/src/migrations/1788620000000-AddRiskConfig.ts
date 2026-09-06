import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The account-agnostic risk policy (the gate the AI can't override). One 'default'
 * row, seeded with the Moderate profile (percentages so it scales to any account).
 */
export class AddRiskConfig1788620000000 implements MigrationInterface {
  name = 'AddRiskConfig1788620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "risk_config" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL DEFAULT 'default',
        "rules" jsonb NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_risk_config_name" UNIQUE ("name"),
        CONSTRAINT "PK_risk_config" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "risk_config" ("name", "rules")
      VALUES ('default', '{"maxConcurrentPositions":4,"maxRiskPerTradePct":5,"maxPortfolioRiskPct":40,"maxPerUnderlying":1,"killSwitch":false}')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "risk_config"`);
  }
}
