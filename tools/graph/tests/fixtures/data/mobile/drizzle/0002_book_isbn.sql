ALTER TABLE `books` ADD `isbn` text;--> statement-breakpoint
CREATE UNIQUE INDEX `books_isbn_unique` ON `books` (`isbn`);
