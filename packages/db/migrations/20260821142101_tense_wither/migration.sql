PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cards` (
	`id` text PRIMARY KEY,
	`front` text NOT NULL UNIQUE,
	`back` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`due` integer NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`state` integer DEFAULT 0 NOT NULL,
	`elapsed_days` real DEFAULT 0 NOT NULL,
	`scheduled_days` real DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`last_review` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_cards`(`id`, `front`, `back`, `category`, `due`, `stability`, `difficulty`, `state`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `last_review`, `created_at`) SELECT `id`, `front`, `back`, `category`, `due`, `stability`, `difficulty`, `state`, `elapsed_days`, `scheduled_days`, `reps`, `lapses`, `last_review`, `created_at` FROM `cards`;--> statement-breakpoint
DROP TABLE `cards`;--> statement-breakpoint
ALTER TABLE `__new_cards` RENAME TO `cards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;