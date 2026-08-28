/*
 * Sync manager — DOWNLOAD-ONLY, top-down.
 * Server = perpustakaan kartu bersama; progress tidak pernah di-upload.
 *
 * Alur (sesuai workflows/auto-sync.md):
 *   mount → online? → GET /api/deck/version
 *     sama dengan meta.deckVersion  → selesai
 *     beda / belum ada              → batched download (gate penuh jika first visit,
 *                                     senyap + toast jika kunjungan berikutnya)
 */

import { createEmptyCard } from "@flashcard/shared";
import { db, type LocalCard } from "./db";

export const SYNC_BATCH_SIZE = 100;

export type SyncPhase =
	| "idle"
	| "checking"
	| "downloading"
	| "done"
	| "offline"
	| "error";

export interface SyncState {
	phase: SyncPhase;
	downloaded: number;
	total: number; // estimasi dari /deck/version atau seed; 0 saat belum diketahui
	error?: string;
}

type Listener = (state: SyncState) => void;

let state: SyncState = { phase: "idle", downloaded: 0, total: 0 };
const listeners = new Set<Listener>();
let started = false;

function setState(patch: Partial<SyncState>) {
	state = { ...state, ...patch };
	for (const fn of listeners) fn(state);
}

export function subscribeSync(fn: Listener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function getSyncState(): SyncState {
	return state;
}

async function getMeta(key: string): Promise<unknown> {
	const row = await db.meta.get(key);
	return row?.value;
}

function apiUrl(): string {
	// Sumber yang sama dengan lib/api.ts
	return (
		(import.meta.env?.VITE_API_URL as string | undefined) ||
		"http://localhost:8787"
	);
}

/**
 * Muat kosakata dari seed lokal (/seed-deck.json) saat offline / API belum tersedia.
 */
export async function loadBundledSeed(): Promise<boolean> {
	try {
		setState({
			phase: "downloading",
			downloaded: 0,
			total: 0,
			error: undefined,
		});
		const res = await fetch("/seed-deck.json");
		if (!res.ok) return false;
		const items = (await res.json()) as Array<
			| [string, string, string]
			| { front: string; back: string; category?: string }
		>;
		if (!Array.isArray(items) || items.length === 0) return false;

		const now = new Date();
		const total = items.length;
		setState({ total });

		const fresh: LocalCard[] = [];
		for (const item of items) {
			const front = Array.isArray(item) ? item[0] : item.front;
			const back = Array.isArray(item) ? item[1] : item.back;
			const category = Array.isArray(item)
				? item[2]
				: item.category || "general";
			const empty = createEmptyCard(now);
			fresh.push({
				id: crypto.randomUUID(),
				front: String(front).trim(),
				back: String(back).trim(),
				category: String(category).trim() || "general",
				due: now,
				stability: empty.stability,
				difficulty: empty.difficulty,
				state: empty.state,
				elapsed_days: empty.elapsed_days,
				scheduled_days: empty.scheduled_days,
				learning_steps: 0,
				reps: empty.reps,
				lapses: empty.lapses,
				createdAt: now,
			});
		}

		const BATCH = 500;
		for (let i = 0; i < fresh.length; i += BATCH) {
			await db.cards.bulkPut(fresh.slice(i, i + BATCH));
			setState({ downloaded: Math.min(fresh.length, i + BATCH) });
		}

		await db.meta.bulkPut([
			{ key: "deckVersion", value: "bundled-seed-v1" },
			{ key: "lastSyncAt", value: new Date().toISOString() },
		]);
		setState({ phase: "done", downloaded: total, total });
		return true;
	} catch {
		return false;
	}
}

/**
 * Jalankan siklus sync. Aman dipanggil berulang — hanya satu yang jalan.
 * `force` = abaikan version-check dan download ulang seluruh deck.
 */
export async function runSync(options?: { force?: boolean }): Promise<void> {
	if (started) return;
	const cardCount = await db.cards.count();

	if (!navigator.onLine) {
		if (cardCount === 0) {
			const seeded = await loadBundledSeed();
			if (!seeded) {
				setState({ phase: "offline" });
			}
		} else {
			setState({ phase: "done", downloaded: cardCount, total: cardCount });
		}
		return;
	}

	started = true;
	try {
		setState({ phase: "checking", downloaded: 0, total: 0, error: undefined });

		let needDownload = options?.force === true;
		let total = 0;
		let seenVersion = "";

		if (!needDownload) {
			let res: Response;
			try {
				res = await fetch(`${apiUrl()}/api/deck/version`);
			} catch (fetchErr) {
				// API server down / unreachable — fallback ke seed lokal jika kosong
				if (cardCount === 0) {
					const seeded = await loadBundledSeed();
					if (seeded) return;
				} else {
					setState({ phase: "done", downloaded: cardCount, total: cardCount });
					return;
				}
				throw fetchErr;
			}

			if (!res.ok) {
				if (cardCount === 0) {
					const seeded = await loadBundledSeed();
					if (seeded) return;
				} else {
					setState({ phase: "done", downloaded: cardCount, total: cardCount });
					return;
				}
				throw new Error(`version check gagal (${res.status})`);
			}

			const data = (await res.json()) as { version: string; count: number };
			total = data.count;
			seenVersion = data.version;
			const localVersion = await getMeta("deckVersion");
			needDownload = localVersion !== data.version;
		}

		if (!needDownload) {
			setState({ phase: "done", total });
			return;
		}

		setState({ phase: "downloading", downloaded: 0, total });

		// Merge per front: konten (back/category) mengikuti server sebagai sumber
		// arti; progress FSRS lokal dipertahankan.
		const localByFront = new Map<string, LocalCard>();
		for (const c of await db.cards.toArray()) {
			localByFront.set(c.front.toLowerCase(), c);
		}

		let offset = 0;
		for (;;) {
			const res = await fetch(
				`${apiUrl()}/api/deck/cards?offset=${offset}&limit=${SYNC_BATCH_SIZE}`,
			);
			if (!res.ok) throw new Error(`download gagal (${res.status})`);
			const data = (await res.json()) as {
				cards: Array<Record<string, unknown>>;
				hasMore: boolean;
			};

			const normalized = data.cards.map((c) => normalizeCard(c));
			const fresh: LocalCard[] = [];
			const merged: LocalCard[] = [];
			for (const c of normalized) {
				const key = c.front.toLowerCase();
				const local = localByFront.get(key);
				if (local) {
					const m: LocalCard = {
						...local,
						front: c.front,
						back: c.back,
						category: c.category,
					};
					merged.push(m);
					localByFront.set(key, m);
				} else {
					fresh.push(c);
					localByFront.set(key, c);
				}
			}
			if (fresh.length > 0) await db.cards.bulkPut(fresh);
			if (merged.length > 0) await db.cards.bulkPut(merged);

			offset += data.cards.length;
			setState({ downloaded: offset });

			if (!data.hasMore) break;
		}

		// Simpan versi HANYA setelah seluruh deck berhasil didownload —
		// jika gagal di tengah, siklus berikutnya mengulang dari awal (idempoten).
		await db.meta.bulkPut([
			{ key: "deckVersion", value: seenVersion },
			{ key: "lastSyncAt", value: new Date().toISOString() },
		]);
		setState({ phase: "done", downloaded: offset, total });
	} catch (error) {
		if (cardCount > 0) {
			// Jika kartu lokal ada, jangan biarkan error memblokir user
			setState({ phase: "done", downloaded: cardCount, total: cardCount });
		} else {
			setState({
				phase: "error",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	} finally {
		started = false;
	}
}

function normalizeCard(c: Record<string, unknown>): LocalCard {
	return {
		id: String(c.id),
		front: String(c.front),
		back: String(c.back),
		category:
			typeof c.category === "string" && c.category.length > 0
				? c.category
				: "general",
		due: new Date(c.due as string),
		stability: Number(c.stability ?? 0),
		difficulty: Number(c.difficulty ?? 0),
		state: Number(c.state ?? 0),
		elapsed_days: Number(c.elapsed_days ?? 0),
		scheduled_days: Number(c.scheduled_days ?? 0),
		reps: Number(c.reps ?? 0),
		lapses: Number(c.lapses ?? 0),
		learning_steps: 0,
		last_review: c.last_review ? new Date(c.last_review as string) : undefined,
		createdAt: new Date(c.createdAt as string),
	};
}
