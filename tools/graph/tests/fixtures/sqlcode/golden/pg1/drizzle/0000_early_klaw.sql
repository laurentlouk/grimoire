CREATE TYPE "public"."role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" varchar(100),
	"vc" varchar,
	"bio" text NOT NULL,
	"age" integer NOT NULL,
	"big" bigint NOT NULL,
	"big2" bigint,
	"small" smallint,
	"score" double precision,
	"rl" real,
	"price" numeric(10, 2),
	"price2" numeric,
	"dec" numeric(5),
	"active" boolean DEFAULT true,
	"role" "role" DEFAULT 'member',
	"meta" jsonb,
	"meta2" json,
	"created" timestamp DEFAULT now() NOT NULL,
	"tz" timestamp (3) with time zone DEFAULT now(),
	"tz0" timestamp with time zone,
	"ts6" timestamp (6),
	"day" date,
	"tm" time(2) with time zone,
	"tm0" time,
	"tags" text[],
	"tags2" integer[] DEFAULT '{}'::int[] NOT NULL,
	"dflt" text DEFAULT 'it''s',
	"n" integer DEFAULT 0,
	"f" real DEFAULT 1.5,
	"neg" integer DEFAULT -1,
	"ch" char(3),
	"ch1" char,
	"txt" text DEFAULT now()::text,
	"upd" timestamp,
	"cid" text,
	"gen" integer GENERATED ALWAYS AS (age + 1) STORED,
	"ident" integer GENERATED ALWAYS AS IDENTITY (sequence name "accounts_ident_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"str0" text DEFAULT '',
	"bigdef" bigint DEFAULT 9007199254740991,
	"tsdef" timestamp DEFAULT '2020-01-01 00:00:00',
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"a" integer NOT NULL,
	"b" integer NOT NULL,
	CONSTRAINT "membership_a_b_pk" PRIMARY KEY("a","b"),
	CONSTRAINT "mem_ab" UNIQUE("a","b")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_id" integer NOT NULL,
	"editor_id" integer,
	"title" text,
	"slug" text,
	CONSTRAINT "posts_slug_u" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "with_fk" (
	"x" integer NOT NULL,
	"y" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_editor_id_accounts_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE set null;--> statement-breakpoint
ALTER TABLE "with_fk" ADD CONSTRAINT "with_fk_x_y_membership_a_b_fk" FOREIGN KEY ("x","y") REFERENCES "public"."membership"("a","b") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acc_name_age_idx" ON "accounts" USING btree ("name","age");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_email_name_uq" ON "accounts" USING btree ("email","name");--> statement-breakpoint
CREATE INDEX "partial_idx" ON "accounts" USING btree ("bio") WHERE "accounts"."active";