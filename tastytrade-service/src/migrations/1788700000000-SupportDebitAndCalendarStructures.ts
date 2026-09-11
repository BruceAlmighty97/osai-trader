import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let the paper ledger hold structures that are not single-expiration credit
 * spreads: iron condors, debit spreads and calendars.
 *
 * The blockers were never about money — they were data-model assumptions:
 *
 * 1. `entryCredit` was assumed positive (PaperService rejected `credit < 0`
 *    outright), so a debit structure could not be recorded at all.
 * 2. "% of max profit" was computed as `(entryCredit - currentDebit) /
 *    entryCredit`, which silently assumes credit == max profit. True for credit
 *    spreads, false for debit spreads — where it returns a NEGATIVE number for a
 *    winning trade, and would have driven the 50% exit rule off a cliff.
 * 3. `expiration` is one column, and a calendar's legs live in two.
 *
 * This migration adds the stored max profit that (2) needs. (1) and (3) are code
 * changes: entry prices are signed now, and per-leg expirations are carried on
 * the legs themselves with `position.expiration` holding the FRONT expiration —
 * which is the right one for the DTE rule anyway, since the front leg expiring
 * is what the trade is about.
 *
 * Existing rows are all credit spreads, so backfilling `entryCredit * 100` is
 * exact rather than an approximation.
 */
export class SupportDebitAndCalendarStructures1788700000000
  implements MigrationInterface
{
  name = 'SupportDebitAndCalendarStructures1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "maxProfit" numeric(12,4)`,
    );
    // Every pre-existing position is a credit spread, where max profit is
    // exactly the credit kept.
    await queryRunner.query(`
      UPDATE "positions"
         SET "maxProfit" = "entryCredit" * 100
       WHERE "maxProfit" IS NULL
         AND "entryCredit" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "positions" DROP COLUMN IF EXISTS "maxProfit"`,
    );
  }
}
