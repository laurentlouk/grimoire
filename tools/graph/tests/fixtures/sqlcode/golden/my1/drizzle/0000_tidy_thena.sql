CREATE TABLE `accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sid` serial AUTO_INCREMENT,
	`email` varchar(255) NOT NULL,
	`name` varchar(100),
	`bio` text,
	`age` int NOT NULL,
	`uage` int unsigned,
	`tiny` tinyint,
	`utiny` tinyint unsigned,
	`small` smallint,
	`mid` mediumint,
	`big` bigint NOT NULL,
	`ubig` bigint unsigned,
	`price` decimal(10,2),
	`price2` decimal,
	`uprice` decimal(10,2) unsigned,
	`fl` float,
	`fl2` float(10,2),
	`db` double,
	`db2` double(10,2),
	`active` boolean DEFAULT true,
	`role` enum('admin','member') DEFAULT 'member',
	`meta` json,
	`created` timestamp NOT NULL DEFAULT (now()),
	`created3` timestamp(3) DEFAULT (now()),
	`dt` datetime,
	`dt3` datetime(3),
	`day` date,
	`tm` time(2),
	`yr` year,
	`tt` tinytext,
	`mt` mediumtext,
	`lt` longtext,
	`ch` char(3),
	`bin` binary(16),
	`vbin` varbinary(16),
	`dflt` text,
	`vdflt` varchar(20) DEFAULT 'it''s',
	`n` int DEFAULT 0,
	`f` real DEFAULT 1.5,
	`neg` int DEFAULT -1,
	`upd` timestamp ON UPDATE CURRENT_TIMESTAMP,
	`cid` varchar(20),
	`nowf` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_email_unique` UNIQUE(`email`),
	CONSTRAINT `acc_email_name_uq` UNIQUE(`email`,`name`)
);
--> statement-breakpoint
CREATE TABLE `membership` (
	`a` int NOT NULL,
	`b` int NOT NULL,
	CONSTRAINT `membership_a_b_pk` PRIMARY KEY(`a`,`b`),
	CONSTRAINT `mem_ab` UNIQUE(`a`,`b`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`author_id` int NOT NULL,
	`editor_id` int,
	`title` varchar(255),
	`slug` varchar(100),
	CONSTRAINT `posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `posts_slug_u` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_author_id_accounts_id_fk` FOREIGN KEY (`author_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_editor_id_accounts_id_fk` FOREIGN KEY (`editor_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE set null;--> statement-breakpoint
CREATE INDEX `acc_name_age_idx` ON `accounts` (`name`,`age`);