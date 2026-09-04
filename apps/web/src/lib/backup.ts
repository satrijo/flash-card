// apps/web/src/lib/backup.ts
// Cadangan & pemulihan progres lokal (export/import JSON) — satu-satunya
// jaring pengaman karena progres hanya tersimpan di perangkat ini.

import {
	db,
	type GameStats,
	type HabitatQuota,
	type LocalCard,
	type MetaEntry,
} from "./db";

export interface BackupFile {
	app: "kata";
	version: 1;
	exportedAt: string;
	data: {
		cards: LocalCard[];
		gameStats: GameStats | null;
		habitats: HabitatQuota[];
		meta: MetaEntry[];
	};
}

// Kunci meta yang tidak boleh ikut dipulihkan: deckVersion/lastSyncAt
// mengontrol unduhan deck — memulihkannya bisa menekan unduhan versi baru.
const SYNC_META_KEYS: readonly string[] = ["deckVersion", "lastSyncAt"];

export async function buildBackup(): Promise<BackupFile> {
	const [cards, gameStats, habitats, meta] = await Promise.all([
		db.cards.toArray(),
		db.gameStats.get("user"),
		db.habitats.toArray(),
		db.meta.toArray(),
	]);
	return {
		app: "kata",
		version: 1,
		exportedAt: new Date().toISOString(),
		data: {
			cards,
			gameStats: gameStats ?? null,
			habitats,
			meta: meta.filter((entry) => !SYNC_META_KEYS.includes(entry.key)),
		},
	};
}

// JSON round-trip mengubah Date jadi string ISO — kembalikan ke Date agar
// query due (below(now)) tetap bekerja setelah restore.
export function reviveDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

export async function importBackup(file: BackupFile): Promise<void> {
	if (!isBackupFile(file)) {
		throw new Error("File cadangan tidak valid");
	}
	const { cards, gameStats, habitats, meta } = file.data;
	await db.transaction(
		"rw",
		db.cards,
		db.gameStats,
		db.habitats,
		db.meta,
		async () => {
			await db.cards.clear();
			await db.cards.bulkPut(
				cards.map((card) => ({
					...card,
					due: reviveDate(card.due),
					last_review:
						card.last_review === undefined
							? undefined
							: reviveDate(card.last_review),
					createdAt: reviveDate(card.createdAt),
				})),
			);
			if (gameStats) {
				await db.gameStats.put(gameStats);
			} else {
				await db.gameStats.clear();
			}
			await db.habitats.clear();
			await db.habitats.bulkPut(habitats);
			// Meta tidak di-clear: deckVersion/lastSyncAt lokal dipertahankan
			// agar status unduhan deck bertahan; hanya kunci lain yang dipulihkan.
			const restoredMeta = meta.filter(
				(entry) => !SYNC_META_KEYS.includes(entry.key),
			);
			// Pastikan lastSyncAt ada agar SyncGate tahu data sudah siap di perangkat
			const existingSync = await db.meta.get("lastSyncAt");
			if (!existingSync) {
				restoredMeta.push({
					key: "lastSyncAt",
					value: new Date().toISOString(),
				});
			}
			await db.meta.bulkPut(restoredMeta);
		},
	);
}

export async function downloadBackup(): Promise<void> {
	const backup = await buildBackup();
	const blob = new Blob([JSON.stringify(backup, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const now = new Date();
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `kata-cadangan-${yyyy}-${mm}-${dd}.json`;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export function isBackupFile(value: unknown): value is BackupFile {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	if (candidate.app !== "kata") return false;
	if (candidate.version !== 1) return false;
	if (typeof candidate.exportedAt !== "string") return false;
	const data = candidate.data;
	if (typeof data !== "object" || data === null) return false;
	const dataCandidate = data as Record<string, unknown>;
	if (!Array.isArray(dataCandidate.cards)) return false;
	if (
		dataCandidate.gameStats !== null &&
		typeof dataCandidate.gameStats !== "object"
	) {
		return false;
	}
	if (!Array.isArray(dataCandidate.habitats)) return false;
	if (!Array.isArray(dataCandidate.meta)) return false;
	return true;
}
