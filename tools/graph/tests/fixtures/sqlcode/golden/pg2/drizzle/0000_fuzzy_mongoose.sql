CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."app_role" AS ENUM('a', 'b');--> statement-breakpoint
CREATE TYPE "public"."mood" AS ENUM('sad', 'ok', 'happy');--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid,
	"role" "app"."app_role" DEFAULT 'a' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"first_name" varchar(50),
	"s1" serial NOT NULL,
	"s2" serial NOT NULL,
	"bs" bigserial NOT NULL,
	"ss" "smallserial" NOT NULL,
	"mood" "mood" DEFAULT 'ok',
	"moods" "mood"[],
	"rate" real DEFAULT 1,
	"rate2" real DEFAULT 0.5,
	"rate3" double precision DEFAULT 1000,
	"rate4" integer DEFAULT 1000,
	"iv" interval,
	"iv2" interval day to second(3),
	"day" date DEFAULT '2020-01-01',
	"j" jsonb DEFAULT '{"a":1}'::jsonb,
	"j2" json DEFAULT '[]'::json,
	"price" numeric(12, 4),
	"email_addr" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_firstName_displayName_unique" UNIQUE("first_name","display_name")
);
--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower" ON "users" USING btree (lower("email_addr"));--> statement-breakpoint
CREATE INDEX "users_created_desc" ON "users" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "users_gin" ON "users" USING gin ("j");