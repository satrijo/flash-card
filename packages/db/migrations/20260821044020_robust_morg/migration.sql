ALTER TABLE `cards` ADD `state` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `elapsed_days` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `scheduled_days` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `reps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `lapses` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `last_review` integer;