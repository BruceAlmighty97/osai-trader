import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWatchlist1783203037125 implements MigrationInterface {
    name = 'AddWatchlist1783203037125'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "watchlist" ("id" SERIAL NOT NULL, "symbol" character varying NOT NULL, "description" character varying, "correlationGroup" character varying, "cadence" character varying NOT NULL DEFAULT 'daily', "enabled" boolean NOT NULL DEFAULT true, "priority" integer NOT NULL DEFAULT '0', "notes" text, "lastAnalyzedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0c8c0dbcc8d379117138e71ad5b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1894aa53b5ada263a16c1a38b7" ON "watchlist" ("symbol") `);
        await queryRunner.query(`CREATE INDEX "IDX_bd9746f668552ac8be535b779c" ON "watchlist" ("enabled") `);

        // Seed the starter watchlist (6 liquid ETFs) from docs/strategy-methodology.md.
        // correlationGroup buckets correlated risk: SPY/QQQ/IWM are ONE "long US
        // equity" bet; GLD/TLT/SLV are the real diversifiers. All seeded 'daily'
        // (the cheaper cadence) with priority reflecting liquidity/anchor order.
        await queryRunner.query(`
            INSERT INTO "watchlist" ("symbol", "description", "correlationGroup", "cadence", "priority") VALUES
              ('SPY', 'S&P 500 ETF — most liquid options; anchor', 'us_equity', 'daily', 100),
              ('QQQ', 'Nasdaq 100 ETF — tech-heavy, slightly higher IV', 'us_equity', 'daily', 90),
              ('IWM', 'Russell 2000 ETF — small caps, higher IV', 'us_equity', 'daily', 80),
              ('GLD', 'Gold ETF — macro/rates diversifier', 'gold', 'daily', 70),
              ('TLT', '20yr Treasuries ETF — rates exposure', 'rates', 'daily', 60),
              ('SLV', 'Silver ETF — commodity, higher IV', 'silver', 'daily', 50)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_bd9746f668552ac8be535b779c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1894aa53b5ada263a16c1a38b7"`);
        await queryRunner.query(`DROP TABLE "watchlist"`);
    }

}
