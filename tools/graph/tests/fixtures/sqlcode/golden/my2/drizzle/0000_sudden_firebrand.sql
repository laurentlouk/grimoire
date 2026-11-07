CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`id2` bigint unsigned AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`d1` double unsigned,
	`f1` float unsigned,
	`d2` double(10,2) unsigned,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`d3` datetime DEFAULT CURRENT_TIMESTAMP,
	`status` enum('a','b c','d''e') DEFAULT 'a',
	`rate` float DEFAULT 1,
	`flag` boolean DEFAULT false,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_status_unique` UNIQUE(`email`,`status`)
);
--> statement-breakpoint
CREATE INDEX `st` ON `users` (`status`);