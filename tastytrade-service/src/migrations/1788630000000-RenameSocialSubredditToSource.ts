import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Social scanner moved Reddit -> StockTwits. Rename the Reddit-specific
 * `subreddit` column to the generic `source` (e.g. "stocktwits"). The table is
 * empty in production (Reddit never successfully ingested), so this is data-safe.
 */
export class RenameSocialSubredditToSource1788630000000
  implements MigrationInterface
{
  name = 'RenameSocialSubredditToSource1788630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_mentions" RENAME COLUMN "subreddit" TO "source"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_mentions" RENAME COLUMN "source" TO "subreddit"`,
    );
  }
}
