/*
 * Gamifikasi engine — XP, level, streak harian, target harian.
 * Semua state lokal di Dexie `gameStats` (single row id="user"), offline-first.
 */

import { Rating } from "@flashcard/shared";
import { db, type GameStats } from "./db";

export const DEFAULT_DAILY_GOAL = 20;

export const XP_PER_RATING = {
	again: 5,
	hard: 8,
	good: 10,
	easy: 15,
} as const;

export interface LevelInfo {
	level: number;
	levelStartXp: number;
	nextLevelXp: number;
	progressPct: number;
	rankName: string;
}

const RANK_NAMES = ["Pemula", "Terampil", "Mahir", "Pakar", "Legenda"] as const;

export function rankForLevel(level: number): string {
	if (level <= 1) return RANK_NAMES[0];
	const idx = Math.min(level - 2, RANK_NAMES.length - 1);
	const base = RANK_NAMES[idx];
	if (level - 1 >= RANK_NAMES.length) {
		return `${base} ${"⭐".repeat(level - RANK_NAMES.length)}`;
	}
	return base;
}

export interface AwardResult {
	xpGained: number;
	leveledUp: boolean;
	newLevel: number;
	streakCount: number;
}

// Riwayat review harian (meta "reviewHistory") — key YYYY-MM-DD → jumlah review.
type ReviewHistory = Record<string, number>;

export function xpForRating(rating: Rating): number {
	switch (rating) {
		case Rating.Again:
			return XP_PER_RATING.again;
		case Rating.Hard:
			return XP_PER_RATING.hard;
		case Rating.Good:
			return XP_PER_RATING.good;
		case Rating.Easy:
			return XP_PER_RATING.easy;
		case Rating.Manual:
			throw new Error("Rating.Manual tidak dapat diberi XP");
	}
}

// Kunci hari lokal (bukan UTC) — YYYY-MM-DD
export function dayKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function yesterdayKey(key: string): string {
	const parts = key.split("-").map((p) => Number.parseInt(p, 10));
	const y = parts[0];
	const m = parts[1];
	const d = parts[2];
	if (y === undefined || m === undefined || d === undefined) return key;
	const dt = new Date(y, m - 1, d);
	dt.setDate(dt.getDate() - 1);
	return dayKey(dt);
}

// Ambang mulai level L: threshold(L) = 50 * L * (L - 1)
// L1: 0, L2: 100, L3: 300, L4: 600, ...
function xpForLevelStart(level: number): number {
	return 50 * level * (level - 1);
}

export function levelFromXp(xp: number): LevelInfo {
	let level = 1;
	while (xp >= xpForLevelStart(level + 1)) {
		level += 1;
	}
	const levelStartXp = xpForLevelStart(level);
	const nextLevelXp = xpForLevelStart(level + 1);
	const span = nextLevelXp - levelStartXp;
	const progressPct = Math.min(
		100,
		Math.max(0, Math.round(((xp - levelStartXp) / span) * 100)),
	);
	return {
		level,
		levelStartXp,
		nextLevelXp,
		progressPct,
		rankName: rankForLevel(level),
	};
}

// ---------------------------------------------------------------------------
// Kuota harian per habitat
// ---------------------------------------------------------------------------

export const DEFAULT_HABITAT_QUOTA = 10;

export async function getHabitatQuota(category: string): Promise<number> {
	const row = await db.habitats.get(category);
	return row?.dailyQuota ?? DEFAULT_HABITAT_QUOTA;
}

export async function setHabitatQuota(
	category: string,
	quota: number,
): Promise<void> {
	const clamped = Math.max(0, Math.min(999, Math.round(quota)));
	await db.habitats.put({ category, dailyQuota: clamped });
}

/**
 * Jumlah kartu habitat yang direview hari ini.
 * Sumber kebenarannya last_review kartu (lokal, hasil review device ini).
 */
export async function countTodayReviewsByCategory(
	now: Date = new Date(),
): Promise<Record<string, number>> {
	const k = dayKey(now);
	const reviewedCards = await db.cards
		.filter((c) => Boolean(c.last_review))
		.toArray();
	const map: Record<string, number> = {};
	for (const c of reviewedCards) {
		if (c.last_review && dayKey(new Date(c.last_review)) === k) {
			const cat = c.category || "general";
			map[cat] = (map[cat] || 0) + 1;
		}
	}
	return map;
}

export async function ensureGameStats(
	now: Date = new Date(),
): Promise<GameStats> {
	const existing = await db.gameStats.get("user");
	const k = dayKey(now);
	if (existing) {
		if (existing.todayKey !== null && existing.todayKey !== k) {
			existing.todayKey = k;
			existing.todayCount = 0;
			if (
				existing.streakLastDay !== yesterdayKey(k) &&
				existing.streakLastDay !== k
			) {
				existing.streakCount = 0;
			}
			await db.gameStats.put(existing);
		}
		return existing;
	}
	const fresh: GameStats = {
		id: "user",
		xp: 0,
		streakCount: 0,
		streakLastDay: null,
		todayKey: k,
		todayCount: 0,
		dailyGoal: DEFAULT_DAILY_GOAL,
	};
	await db.gameStats.put(fresh);
	return fresh;
}

export async function awardReview(
	rating: Rating,
	now: Date = new Date(),
): Promise<AwardResult> {
	return db.transaction("rw", db.gameStats, db.meta, async () => {
		const stats = await ensureGameStats(now);
		const beforeLevel = levelFromXp(stats.xp).level;

		const xpGained = xpForRating(rating);
		stats.xp += xpGained;

		const k = dayKey(now);
		if (stats.todayKey !== k) {
			stats.todayKey = k;
			stats.todayCount = 0;
		}
		if (stats.streakLastDay !== k) {
			stats.streakCount =
				stats.streakLastDay === yesterdayKey(k) ? stats.streakCount + 1 : 1;
			stats.streakLastDay = k;
		}
		stats.todayCount += 1;

		await db.gameStats.put(stats);

		// Rekam riwayat review harian untuk grafik 7 hari di /statistik.
		const histRow = await db.meta.get("reviewHistory");
		const raw = histRow?.value;
		const hist: ReviewHistory =
			raw && typeof raw === "object" && !Array.isArray(raw)
				? (raw as ReviewHistory)
				: {};
		hist[k] = (hist[k] ?? 0) + 1;
		// Prune: simpan hanya 14 hari terakhir agar meta tidak membengkak.
		const keep = new Set<string>();
		for (let i = 0; i < 14; i++) {
			const y = now.getFullYear();
			const m = now.getMonth() + 1;
			const d = now.getDate();
			const dt = new Date(y, m - 1, d);
			dt.setDate(dt.getDate() - i);
			keep.add(dayKey(dt));
		}
		for (const key of Object.keys(hist)) {
			if (!keep.has(key)) delete hist[key];
		}
		await db.meta.put({ key: "reviewHistory", value: hist });

		const after = levelFromXp(stats.xp);
		return {
			xpGained,
			leveledUp: beforeLevel < after.level,
			newLevel: after.level,
			streakCount: stats.streakCount,
		};
	});
}
