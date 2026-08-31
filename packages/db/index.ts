// packages/db/index.ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  front: text("front").notNull().unique(),
  back: text("back").notNull(),
  category: text("category").default("general").notNull(),
  due: integer("due", { mode: "timestamp" }).notNull(),

  // Tambahkan .notNull() setelah default(0)
  stability: real("stability").default(0).notNull(),
  difficulty: real("difficulty").default(0).notNull(),

  // FSRS State enum numeric (0=New, 1=Learning, 2=Review, 3=Relearning)
  state: integer("state").default(0).notNull(),
  elapsed_days: real("elapsed_days").default(0).notNull(),
  scheduled_days: real("scheduled_days").default(0).notNull(),
  learning_steps: integer("learning_steps").default(0).notNull(),
  reps: integer("reps").default(0).notNull(),
  lapses: integer("lapses").default(0).notNull(),
  last_review: integer("last_review", { mode: "timestamp" }),

  createdAt: integer("created_at", { mode: "timestamp" })
    .default(sql`(strftime('%s', 'now'))`)
    .notNull(),
});

export const communityMessages = sqliteTable("community_messages", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  deviceId: text("device_id").notNull(),
  content: text("content").notNull(),
  flashcardRef: text("flashcard_ref"),
  createdAt: integer("created_at").notNull(),
});

export const communityPresence = sqliteTable("community_presence", {
  deviceId: text("device_id").primaryKey(),
  username: text("username").notNull(),
  activity: text("activity").default("Online").notNull(),
  lastSeen: integer("last_seen").notNull(),
});

export const userHandles = sqliteTable("user_handles", {
  handle: text("handle").primaryKey(),
  deviceId: text("device_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const userCloudBackups = sqliteTable("user_cloud_backups", {
  handle: text("handle").primaryKey(),
  deviceId: text("device_id").notNull(),
  backupData: text("backup_data").notNull(),
  cardsCount: integer("cards_count").default(0).notNull(),
  streakCount: integer("streak_count").default(0).notNull(),
  xpCount: integer("xp_count").default(0).notNull(),
  updatedAt: integer("updated_at").notNull(),
});
