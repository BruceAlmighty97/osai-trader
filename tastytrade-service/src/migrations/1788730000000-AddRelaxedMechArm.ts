import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fourth experiment arm — "mech-relaxed" — the same mechanical funnel as
 * `mech` with the credit gates loosened, so the cost of the playbook's credit
 * floor is measured rather than argued.
 *
 * Why: at the playbook's 0.15-0.25 short delta a vertical pays ~15-18% of
 * width (its own greeks tables agree, 03 §4.2), so the 25% floor (02 T4) and
 * the $0.30 gross minimum (01 A6) leave the strict arms near-dormant. This arm
 * overrides three knobs and nothing else:
 *   minCreditToWidth   0.25 -> 0.18   (what real chains pay at ~0.20Δ)
 *   minCreditAbs       0.30 -> 0.20   (fees become ~12.5% of credit, not 8%)
 *   thinCreditMaxDelta 0.20 -> 0.25   (the 25-33% band's "sit further out"
 *                                      condition would otherwise reject
 *                                      everything this arm can reach)
 * Delta band, DTE window, EM rule, sizing and exits are all the playbook's.
 * Same $2,500 start as the other arms so returns stay directly comparable.
 * Global risk rules apply unchanged.
 */
export class AddRelaxedMechArm1788730000000 implements MigrationInterface {
  name = 'AddRelaxedMechArm1788730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "paper_account" ("name", "startingBalance", "enabled", "description", "config")
      VALUES ('mech-relaxed', 2500, true,
              'Mechanical funnel with the credit floor relaxed (18% of width, $0.20 gross) — measures what the playbook floor costs.',
              '{"selector":"mechanical","minCreditToWidth":0.18,"minCreditAbs":0.2,"thinCreditMaxDelta":0.25}')
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "paper_account" WHERE "name" = 'mech-relaxed'`,
    );
  }
}
