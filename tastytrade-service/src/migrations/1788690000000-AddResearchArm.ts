import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Third experiment arm — "research" — managed by an actual Claude agent with
 * web research plus live broker data, alongside the mechanical `mech` and the
 * slate-picking `ai`.
 *
 * Starting balance is $2,500, matching the other two. The spec suggested $5,000
 * so MU-sized condors are testable, but equal balances keep percentage returns
 * directly comparable across all three arms, which is the entire point of the
 * A/B. Raising it is one UPDATE if condor sizing turns out to be the binding
 * constraint.
 *
 * The arm carries no entry config: `selector` is irrelevant here because this
 * arm never runs the mechanical entry funnel. Exit thresholds still apply — the
 * management phase manages every arm's book identically.
 */
export class AddResearchArm1788690000000 implements MigrationInterface {
  name = 'AddResearchArm1788690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "paper_account" ("name", "startingBalance", "enabled", "description", "config")
      VALUES ('research', 2500, true,
              'Claude agent: web research + live broker data, proposes its own structures.',
              '{"selector":"agent"}')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "research_runs" (
        "id" SERIAL NOT NULL,
        "accountId" integer,
        "objective" text NOT NULL,
        "model" character varying,
        "sessionId" character varying,
        "status" character varying NOT NULL DEFAULT 'running',
        "costUsd" numeric(10,4),
        "turns" integer,
        "durationMs" integer,
        "marketContext" text,
        "bestPlay" text,
        "candidatesScreened" integer,
        "playsProposed" integer NOT NULL DEFAULT 0,
        "playsSubmitted" integer NOT NULL DEFAULT 0,
        "reportJson" jsonb,
        "toolCalls" jsonb,
        "errorMessage" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_research_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_research_runs_accountId" ON "research_runs" ("accountId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "research_plays" (
        "id" SERIAL NOT NULL,
        "runId" integer NOT NULL,
        "underlying" character varying NOT NULL,
        "structure" character varying NOT NULL,
        "edgeType" character varying,
        "legs" jsonb NOT NULL,
        "netCredit" numeric(12,4) NOT NULL,
        "maxLoss" numeric(12,4) NOT NULL,
        "maxProfit" numeric(12,4),
        "probabilityOfProfit" numeric(6,4),
        "buyingPowerEffect" numeric(12,4),
        "estimatedFees" numeric(10,4),
        "dryRunPassed" boolean NOT NULL DEFAULT false,
        "conviction" character varying,
        "thesis" text,
        "managementPlan" text,
        "catalysts" jsonb,
        "risks" jsonb,
        "sources" jsonb,
        "ivContext" jsonb,
        "submittedPositionId" integer,
        "rejectionReason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_research_plays" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_research_plays_runId" ON "research_plays" ("runId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_research_plays_underlying" ON "research_plays" ("underlying")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_research_plays_edgeType" ON "research_plays" ("edgeType")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "research_plays"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "research_runs"`);
    await queryRunner.query(`DELETE FROM "paper_account" WHERE "name" = 'research'`);
  }
}
