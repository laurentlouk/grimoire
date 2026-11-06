CREATE TABLE `shelves` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text DEFAULT 'unsorted' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shelf_books` (
	`shelf_id` text NOT NULL,
	`book_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`shelf_id`, `book_id`),
	FOREIGN KEY (`shelf_id`) REFERENCES `shelves`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
