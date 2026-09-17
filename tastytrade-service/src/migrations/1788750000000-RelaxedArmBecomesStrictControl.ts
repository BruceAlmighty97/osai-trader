import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The book is verticals (2026-09-16), so the ENTRY_* defaults now carry the
 * vertical-tuned credit gates (18% floor, 22% target, $0.25 gross) that the
 * `mech-relaxed` arm was created to test. The A/B flips: `mech` and `ai` run
 * on the new defaults, and this arm becomes `mech-strict`, pinning the
 * playbook's 25% / 33% / $0.30 / thin-credit-Δ-0.20 as the control. Same row,
 * same (empty) book, renamed and re-configured.
 */
export class RelaxedArmBecomesStrictControl1788750000000 implements MigrationInterface {
  name = 'RelaxedArmBecomesStrictControl1788750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "paper_account"
      SET "name" = 'mech-strict',
          "description" = 'Mechanical funnel pinned to the playbook credit gates (25% of width, $0.30 gross) — the control for the vertical-tuned defaults.',
          "config" = '{"selector":"mechanical","minCreditToWidth":0.25,"targetCreditToWidth":0.33,"minCreditAbs":0.3,"thinCreditMaxDelta":0.2}'
      WHERE "name" = 'mech-relaxed'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "paper_account"
      SET "name" = 'mech-relaxed',
          "description" = 'Mechanical funnel with the credit floor relaxed (18% of width, $0.20 gross) — measures what the playbook floor costs.',
          "config" = '{"selector":"mechanical","minCreditToWidth":0.18,"minCreditAbs":0.2,"thinCreditMaxDelta":0.25}'
      WHERE "name" = 'mech-strict'
    `);
  }
}
