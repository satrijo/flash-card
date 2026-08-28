// apps/web/src/lib/db.ts

import type { FSRSCard } from "@flashcard/shared";
import Dexie, { type EntityTable } from "dexie";

export interface LocalCard extends FSRSCard {
	id: string;
	front: string;
	back: string;
	category: string;
	createdAt: Date;
	// ts-fsrs butuh field ini, tapi tidak dipakai/di-storage di D1 — selalu 0.
	learning_steps: number;
}

// State gamifikasi lokal (single row, id tetap "user")
export interface GameStats {
	id: "user";
	xp: number;
	streakCount: number;
	streakLastDay: string | null; // YYYY-MM-DD lokal
	todayKey: string | null; // YYYY-MM-DD
	todayCount: number;
	dailyGoal: number;
}

// Kuota harian per habitat (kategori) — bisa diedit user
export interface HabitatQuota {
	category: string; // primary key
	dailyQuota: number;
}

// Key-value kecil: deckVersion, lastSyncAt, ttsEnabled, dll.
export interface MetaEntry {
	key: string;
	value: unknown;
}

const db = new Dexie("FlashcardDB") as Dexie & {
	cards: EntityTable<LocalCard, "id">;
	gameStats: EntityTable<GameStats, "id">;
	habitats: EntityTable<HabitatQuota, "category">;
	meta: EntityTable<MetaEntry, "key">;
};

// Versi lama (1–4) dipertahankan agar upgrade device existing tidak destruktif.
db.version(4).stores({
	cards: "id, due, category",
	syncQueue: "++id",
	gameStats: "id",
});

// v5: sync jadi download-only — syncQueue dihapus, meta + habitats ditambah.
db.version(5)
	.stores({
		cards: "id, due, category",
		gameStats: "id",
		habitats: "category",
		meta: "key",
	})
	.upgrade(async (tx) => {
		// Buang sisa antrean upload dari model lama — tidak pernah dikirim.
		await tx.table("syncQueue").clear();
	});

export { db };
