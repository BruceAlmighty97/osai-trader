import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSocialMentions1783279744744 implements MigrationInterface {
    name = 'AddSocialMentions1783279744744'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "social_mentions" ("id" SERIAL NOT NULL, "symbol" character varying NOT NULL, "subreddit" character varying NOT NULL, "sourceType" character varying NOT NULL DEFAULT 'post', "sourceId" character varying NOT NULL, "matchType" character varying NOT NULL DEFAULT 'cashtag', "author" character varying, "upvotes" integer NOT NULL DEFAULT '0', "permalink" character varying, "title" text, "bodyText" text, "sentiment" character varying, "contentStatus" character varying NOT NULL DEFAULT 'live', "createdUtc" TIMESTAMP WITH TIME ZONE, "sampledAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastCheckedAt" TIMESTAMP WITH TIME ZONE, "deletedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_social_symbol_source" UNIQUE ("symbol", "sourceId"), CONSTRAINT "PK_0688ae36b91a990b31240acea17" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0c15b88d0d45eda91707df1625" ON "social_mentions" ("symbol") `);
        await queryRunner.query(`CREATE INDEX "IDX_e0130d29710f4174030f003449" ON "social_mentions" ("subreddit") `);
        await queryRunner.query(`CREATE INDEX "IDX_44dc172d728dd087698d6aa950" ON "social_mentions" ("contentStatus") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_44dc172d728dd087698d6aa950"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e0130d29710f4174030f003449"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0c15b88d0d45eda91707df1625"`);
        await queryRunner.query(`DROP TABLE "social_mentions"`);
    }

}
