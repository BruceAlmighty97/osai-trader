import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One row per trading day — how phases share state. Each tick is a separate
 * invocation, so pre-market writes the shortlist here and the 10:00 entry phase
 * reads it back instead of re-deriving everything. Doubles as the audit trail of
 * what the bot was looking at on any given day.
 */
export class AddTradingDay1788670000000 implements MigrationInterface {
  name = 'AddTradingDay1788670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trading_day" (
        "id" SERIAL NOT NULL,
        "date" character varying NOT NULL,
        "shortlist" jsonb NOT NULL DEFAULT '[]',
        "candidatesScanned" integer NOT NULL DEFAULT 0,
        "rejections" jsonb,
        "brief" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trading_day" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_trading_day_date" ON "trading_day" ("date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trading_day_date"`);
    await queryRunner.query(`DROP TABLE "trading_day"`);
  }
}
