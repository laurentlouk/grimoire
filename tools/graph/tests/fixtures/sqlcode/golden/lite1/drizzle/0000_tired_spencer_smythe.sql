CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text(100),
	`bio` text NOT NULL,
	`age` integer NOT NULL,
	`score` real,
	`raw` blob,
	`rawj` blob,
	`rawb` blob,
	`nm` numeric,
	`flag` integer DEFAULT true,
	`flag0` integer DEFAULT false NOT NULL,
	`ts` integer DEFAULT (unixepoch()) NOT NULL,
	`tsms` integer DEFAULT (unixepoch() * 1000),
	`role` text DEFAULT 'member',
	`js` text,
	`dflt` text DEFAULT 'it''s',
	`n` integer DEFAULT 0,
	`f` real DEFAULT 1.5,
	`neg` integer DEFAULT -1,
	`str0` text DEFAULT '',
	`cid` text,
	`upd` integer,
	`gen` integer GENERATED ALWAYS AS (age + 1) VIRTUAL,
	`gens` integer GENERATED ALWAYS AS (age + 2) STORED,
	`ct` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE INDEX `acc_name_age_idx` ON `accounts` (`name`,`age`);--> statement-breakpoint
CREATE UNIQUE INDEX `acc_email_name_uq` ON `accounts` (`email`,`name`);--> statement-breakpoint
CREATE INDEX `partial_idx` ON `accounts` (`bio`) WHERE "accounts"."age" > 5;--> statement-breakpoint
CREATE TABLE `membership` (
	`a` integer NOT NULL,
	`b` integer NOT NULL,
	PRIMARY KEY(`a`, `b`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mem_ab` ON `membership` (`a`,`b`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY NOT NULL,
	`author_id` integer NOT NULL,
	`editor_id` integer,
	`title` text,
	`slug` text,
	FOREIGN KEY (`author_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`editor_id`) REFERENCES `accounts`(`id`) ON UPDATE set null ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_u` ON `posts` (`slug`);--> statement-breakpoint
CREATE TABLE `with_fk` (
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	FOREIGN KEY (`x`,`y`) REFERENCES `membership`(`a`,`b`) ON UPDATE no action ON DELETE cascade
);
