CREATE TABLE `cards` (
	`id` text PRIMARY KEY,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0,
	`difficulty` real DEFAULT 0,
	`created_at` integer DEFAULT (strftime('%s', 'now'))
);
