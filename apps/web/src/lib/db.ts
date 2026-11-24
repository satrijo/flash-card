// apps/web/src/lib/db.ts

import type { FSRSCard } from "@flashcard/shared";
import Dexie, { type EntityTable } from "dexie";

export interface LocalCard extends FSRSCard {
	id: string;
	front: string;
	back: string;
	category: string;
	createdAt: Date;
	// Disimpan di D1 juga (kolom learning_steps) — review menulisnya via buildFsrsUpdate.
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

// Pesan obrolan komunitas realtime lokal
export interface CommunityMessage {
	id: string;
	username: string;
	deviceId: string;
	content: string;
	flashcardRef?: {
		front: string;
		back: string;
		category: string;
	};
	timestamp: number;
}

// Log kata individual dalam sesi latihan
export interface PracticeCardLog {
	id: string;
	front: string;
	back: string;
	category: string;
	rating: number; // 1=Again, 2=Hard, 3=Good, 4=Easy
}

// Riwayat sesi latihan kosakata lengkap
export interface PracticeSessionRecord {
	id?: number;
	timestamp: number;
	tahap?: string;
	wordsCount: number;
	reviewCount: number;
	xpGained: number;
	ratings: {
		again: number;
		hard: number;
		good: number;
		easy: number;
	};
	cards: PracticeCardLog[];
}

const db = new Dexie("FlashcardDB") as Dexie & {
	cards: EntityTable<LocalCard, "id">;
	gameStats: EntityTable<GameStats, "id">;
	habitats: EntityTable<HabitatQuota, "category">;
	meta: EntityTable<MetaEntry, "key">;
	communityMessages: EntityTable<CommunityMessage, "id">;
	practiceHistory: EntityTable<PracticeSessionRecord, "id">;
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

// v6: Community Chat messages table
db.version(6).stores({
	cards: "id, due, category",
	gameStats: "id",
	habitats: "category",
	meta: "key",
	communityMessages: "id, timestamp",
});

// v7: Riwayat Sesi Latihan Kosakata
db.version(7).stores({
	cards: "id, due, category",
	gameStats: "id",
	habitats: "category",
	meta: "key",
	communityMessages: "id, timestamp",
	practiceHistory: "++id, timestamp, tahap",
});

export { db };
