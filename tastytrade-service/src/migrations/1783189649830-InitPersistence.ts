import { MigrationInterface, QueryRunner } from "typeorm";

export class InitPersistence1783189649830 implements MigrationInterface {
    name = 'InitPersistence1783189649830'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "positions" ("id" SERIAL NOT NULL, "symbol" character varying NOT NULL, "strategy" character varying NOT NULL, "expiration" character varying NOT NULL, "legs" jsonb NOT NULL, "quantity" integer NOT NULL DEFAULT '1', "entryCredit" numeric(12,4) NOT NULL, "maxRisk" numeric(12,4), "status" character varying NOT NULL DEFAULT 'open', "realizedPnl" numeric(12,4), "exitReason" character varying, "openDecisionId" integer, "openOrderId" integer, "closeOrderId" integer, "notes" text, "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "closedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_17e4e62ccd5749b289ae3fae6f3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a93efc672c7635dd4f50925af4" ON "positions" ("symbol") `);
        await queryRunner.query(`CREATE INDEX "IDX_fac15950ad2aefd486b6931cbe" ON "positions" ("status") `);
        await queryRunner.query(`CREATE TABLE "orders" ("id" SERIAL NOT NULL, "tastytradeOrderId" character varying, "symbol" character varying NOT NULL, "legs" jsonb NOT NULL, "orderType" character varying NOT NULL DEFAULT 'Limit', "price" numeric(12,4), "quantity" integer NOT NULL DEFAULT '1', "status" character varying NOT NULL DEFAULT 'pending', "filledQuantity" integer NOT NULL DEFAULT '0', "avgFillPrice" numeric(12,4), "dryRun" boolean NOT NULL DEFAULT false, "positionId" integer, "decisionId" integer, "errorMessage" text, "submittedAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_10f7fe4effb425276c0d944aae" ON "orders" ("tastytradeOrderId") `);
        await queryRunner.query(`CREATE INDEX "IDX_90792f050aed15682318b108f8" ON "orders" ("symbol") `);
        await queryRunner.query(`CREATE INDEX "IDX_775c9f06fc27ae3ff8fb26f2c4" ON "orders" ("status") `);
        await queryRunner.query(`CREATE TABLE "decisions" ("id" SERIAL NOT NULL, "symbol" character varying, "trigger" character varying NOT NULL DEFAULT 'manual', "strategy" character varying, "marketAssessment" text, "rationale" text, "proposedTrade" jsonb, "snapshot" jsonb, "model" character varying, "tokenUsage" jsonb, "durationMs" integer, "stopReason" character varying, "errorMessage" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_48eee6fa229cd5e43648f6a2ec3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_705e284422cf0ec222eb79b8b7" ON "decisions" ("symbol") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_705e284422cf0ec222eb79b8b7"`);
        await queryRunner.query(`DROP TABLE "decisions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_775c9f06fc27ae3ff8fb26f2c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_90792f050aed15682318b108f8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_10f7fe4effb425276c0d944aae"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fac15950ad2aefd486b6931cbe"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a93efc672c7635dd4f50925af4"`);
        await queryRunner.query(`DROP TABLE "positions"`);
    }

}
