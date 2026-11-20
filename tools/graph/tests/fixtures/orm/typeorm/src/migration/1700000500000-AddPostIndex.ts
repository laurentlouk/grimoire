import { MigrationInterface, QueryRunner } from "typeorm";

const INDEX = 'CREATE INDEX "IDX_post_title" ON "post" ("title")'

export class AddPostIndex1700000500000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(INDEX);
        await queryRunner.query("ALTER TABLE \"post\" ADD \"publishedAt\" " + "TIMESTAMP WITH TIME ZONE");
        const table = "post"
        await queryRunner.query(`ALTER TABLE "${table}" ADD "draft" boolean`);
        await queryRunner.query(`UPDATE "user" SET "role" = 'CANARY-TYPEORM-UPDATE'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_post_title"`);
    }
}
