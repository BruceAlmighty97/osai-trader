import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turn the single imaginary account into N experiment arms so changes can be
 * A/B'd against a live baseline instead of argued about.
 *
 * An arm is a paper account plus a `config` blob of overrides (selector, target
 * delta, DTE, credit floor...). Each arm keeps its OWN book, which is the point:
 * once the arms pick differently their positions diverge, and a portfolio-level
 * effect — "did it avoid doubling up on semis?" — is exactly what a shared book
 * would hide.
 *
 * Risk rules deliberately stay global (`risk_config`): they apply to the real
 * account too, so they are not an experiment variable.
 *
 * The pre-existing "default" account becomes the mechanical baseline arm and
 * keeps its positions.
 */
export class AddExperimentArms1788680000000 implements MigrationInterface {
  name = 'AddExperimentArms1788680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "paper_account"
        ADD COLUMN IF NOT EXISTS "enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "description" text,
        ADD COLUMN IF NOT EXISTS "config" jsonb NOT NULL DEFAULT '{}'
    `);

    // The existing lazily-created account becomes the baseline arm, positions intact.
    await queryRunner.query(`
      UPDATE "paper_account"
         SET "name" = 'mech',
             "description" = 'Baseline: highest deterministic score.',
             "config" = '{"selector":"mechanical"}'
       WHERE "name" = 'default'
    `);

    // Seed both arms if absent (fresh DB, or 'default' was never created).
    await queryRunner.query(`
      INSERT INTO "paper_account" ("name", "startingBalance", "enabled", "description", "config")
      VALUES ('mech', 2500, true, 'Baseline: highest deterministic score.', '{"selector":"mechanical"}')
      ON CONFLICT ("name") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "paper_account" ("name", "startingBalance", "enabled", "description", "config")
      VALUES ('ai', 2500, true, 'Claude picks from the same scored slate.', '{"selector":"ai"}')
      ON CONFLICT ("name") DO NOTHING
    `);

    // Positions and decisions become arm-scoped. Nullable so the generic
    // /positions CRUD surface keeps working without an arm.
    await queryRunner.query(
      `ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "accountId" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_positions_accountId" ON "positions" ("accountId")`,
    );
    await queryRunner.query(`
      UPDATE "positions"
         SET "accountId" = (SELECT "id" FROM "paper_account" WHERE "name" = 'mech')
       WHERE "accountId" IS NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "decisions" ADD COLUMN IF NOT EXISTS "accountId" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_decisions_accountId" ON "decisions" ("accountId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_decisions_accountId"`);
    await queryRunner.query(
      `ALTER TABLE "decisions" DROP COLUMN IF EXISTS "accountId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_positions_accountId"`);
    await queryRunner.query(
      `ALTER TABLE "positions" DROP COLUMN IF EXISTS "accountId"`,
    );
    await queryRunner.query(`DELETE FROM "paper_account" WHERE "name" = 'ai'`);
    await queryRunner.query(
      `UPDATE "paper_account" SET "name" = 'default' WHERE "name" = 'mech'`,
    );
    await queryRunner.query(`
      ALTER TABLE "paper_account"
        DROP COLUMN IF EXISTS "config",
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "enabled"
    `);
  }
}
