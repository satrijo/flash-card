import { bandIndex, getUnlockedBands, parseBackContent } from "./bands";
import { db, type LocalCard } from "./db";
import { dayKey, levelFromXp } from "./game";

export interface HabitatStat {
	category: string;
	total: number;
	dueReviews: number;
	readyNew: number;
	mature: number;
	learning: number;
	fresh: number;
	studied: number;
	progressPct: number;
	masteryPct: number;
	retentionPct: number;
	isLocked: boolean;
}

export interface WeakWord {
	id: string;
	front: string;
	pos?: string;
	gloss: string;
	exampleEn?: string;
	exampleId?: string;
	category: string;
	lapses: number;
	state: number;
}

export interface DayStat {
	key: string;
	label: string;
	count: number;
}

export interface AppStats {
	total: number;
	dueNow: number;
	mature: number;
	studiedCount: number;
	retentionRate: number;
	reviewedToday: number;
	streakCount: number;
	level: number;
	rankName: string;
	habitats: HabitatStat[];
	weakWords: WeakWord[];
	week: DayStat[];
}

type ReviewHistory = Record<string, number>;

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"] as const;

export async function computeStats(now: Date = new Date()): Promise<AppStats> {
	const [cards, gs, histRow, unlocked] = await Promise.all([
		db.cards.toArray(),
		db.gameStats.get("user"),
		db.meta.get("reviewHistory"),
		getUnlockedBands(),
	]);

	const nowMs = now.getTime();
	const todayKey = dayKey(now);
	const total = cards.length;

	let dueNow = 0;
	let mature = 0;
	let fresh = 0;
	const weakCandidates: LocalCard[] = [];
	const acc = new Map<
		string,
		{
			category: string;
			total: number;
			dueReviews: number;
			readyNew: number;
			mature: number;
			learning: number;
			fresh: number;
		}
	>();

	// Single-pass O(N) loop untuk seluruh agregasi data
	for (const c of cards) {
		const cat = c.category || "general";
		let h = acc.get(cat);
		if (!h) {
			h = {
				category: cat,
				total: 0,
				dueReviews: 0,
				readyNew: 0,
				mature: 0,
				learning: 0,
				fresh: 0,
			};
			acc.set(cat, h);
		}
		h.total++;

		const isDue =
			c.due instanceof Date
				? c.due.getTime() <= nowMs
				: new Date(c.due).getTime() <= nowMs;

		if (c.state === 0 && !c.last_review) {
			fresh++;
			h.fresh++;
			h.readyNew++;
			if (isDue) dueNow++;
		} else if (c.state === 2 && c.stability >= 21) {
			mature++;
			h.mature++;
			if (isDue) {
				dueNow++;
				h.dueReviews++;
			}
		} else {
			// state 1 (Learning), state 3 (Relearning), atau state 2 stability < 21
			h.learning++;
			if (isDue) {
				dueNow++;
				h.dueReviews++;
			}
		}

		if (c.lapses >= 2) {
			weakCandidates.push(c);
		}
	}

	const studiedCount = total - fresh;
	// Tingkat retensi dihitung dari kartu yang sudah dipelajari
	const retentionRate =
		studiedCount > 0 ? Math.round((mature / studiedCount) * 100) : 100;

	const habitats: HabitatStat[] = Array.from(acc.values())
		.map((h) => {
			const studied = h.total - h.fresh;
			const isLocked = bandIndex(h.category) > 0 && !unlocked.has(h.category);
			const progressPct =
				h.total > 0
					? Math.min(100, Math.round((studied / h.total) * 100 * 10) / 10)
					: 0;
			const masteryPct =
				h.total > 0
					? Math.min(100, Math.round((h.mature / h.total) * 100 * 10) / 10)
					: 0;
			const retentionPct =
				studied > 0 ? Math.round((h.mature / studied) * 100) : 100;

			return {
				...h,
				studied,
				progressPct,
				masteryPct,
				retentionPct,
				isLocked,
			};
		})
		.sort((a, b) => {
			if (a.category === "general") return -1;
			if (b.category === "general") return 1;
			const bx = bandIndex(a.category);
			const by = bandIndex(b.category);
			if (bx !== -1 || by !== -1) {
				if (bx === -1) return 1;
				if (by === -1) return -1;
				return bx - by;
			}
			return a.category.localeCompare(b.category);
		});

	// Kata sering lupa — lapses tinggi, stability rendah dulu
	const weakWords: WeakWord[] = weakCandidates
		.sort((a, b) => b.lapses - a.lapses || a.stability - b.stability)
		.slice(0, 15)
		.map((c) => {
			const parsed = parseBackContent(c.back);
			return {
				id: c.id,
				front: c.front,
				pos: parsed.pos,
				gloss: parsed.gloss,
				exampleEn: parsed.exampleEn,
				exampleId: parsed.exampleId,
				category: c.category || "general",
				lapses: c.lapses,
				state: c.state,
			};
		});

	// Riwayat 7 hari
	const raw = histRow?.value;
	const hist: ReviewHistory =
		raw && typeof raw === "object" && !Array.isArray(raw)
			? (raw as ReviewHistory)
			: {};

	const reviewedToday =
		hist[todayKey] ?? (gs?.todayKey === todayKey ? gs.todayCount : 0);

	const week: DayStat[] = [];
	for (let i = 6; i >= 0; i--) {
		const y = now.getFullYear();
		const m = now.getMonth() + 1;
		const d = now.getDate();
		const dt = new Date(y, m - 1, d);
		dt.setDate(dt.getDate() - i);
		const key = dayKey(dt);
		const label =
			i === 0 ? "Hari ini" : i === 1 ? "Kemarin" : HARI[dt.getDay()];
		const count = hist[key] ?? (key === todayKey ? (gs?.todayCount ?? 0) : 0);
		week.push({ key, label, count });
	}

	const levelInfo = levelFromXp(gs?.xp ?? 0);

	return {
		total,
		dueNow,
		mature,
		studiedCount,
		retentionRate,
		reviewedToday,
		streakCount: gs?.streakCount ?? 0,
		level: levelInfo.level,
		rankName: levelInfo.rankName,
		habitats,
		weakWords,
		week,
	};
}
