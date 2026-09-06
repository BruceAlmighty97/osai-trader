import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Imaginary "paper" account config. Cash/P&L/BP/W-L are derived from the
 * positions table, so this table only holds startingBalance. Seeds one default
 * account at $2500.
 */
export class AddPaperAccount1788610000000 implements MigrationInterface {
  name = 'AddPaperAccount1788610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "paper_account" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL DEFAULT 'default',
        "startingBalance" numeric(12,4) NOT NULL DEFAULT 2500,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_paper_account_name" UNIQUE ("name"),
        CONSTRAINT "PK_paper_account" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "paper_account" ("name", "startingBalance")
      VALUES ('default', 2500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "paper_account"`);
  }
}
