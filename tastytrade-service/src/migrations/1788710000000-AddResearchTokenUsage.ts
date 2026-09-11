import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record what a research run actually spent, in tokens as well as dollars.
 *
 * `tokenUsage` holds a per-model breakdown because one run spends on THREE
 * models: Opus for the main agent loop, plus Sonnet for each of the news-scout
 * and vol-screener subagents. The SDK's flat `usage` field is documented as
 * main-agent-loop-only and excludes subagents, so it understates a run — it is
 * stored alongside the per-model totals rather than instead of them, so the two
 * can be compared when a run looks unexpectedly expensive.
 *
 * `totalTokens` is denormalized for cheap querying/sorting: input + output +
 * cache read + cache write. Thinking tokens are reported but NOT added, since
 * they are already counted inside output tokens.
 */
export class AddResearchTokenUsage1788710000000 implements MigrationInterface {
  name = 'AddResearchTokenUsage1788710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "research_runs" ADD COLUMN IF NOT EXISTS "tokenUsage" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "research_runs" ADD COLUMN IF NOT EXISTS "totalTokens" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "research_runs" DROP COLUMN IF EXISTS "totalTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "research_runs" DROP COLUMN IF EXISTS "tokenUsage"`,
    );
  }
}
