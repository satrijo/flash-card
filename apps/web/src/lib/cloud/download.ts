// apps/web/src/lib/cloud/download.ts
// Unduh cadangan: pulihkan penuh, gabungkan cerdas (merge dua arah),
// dan pull-otomatis bila cloud lebih baru.
import { normalizeUserHandle } from "@flashcard/shared";
import { type BackupFile, importBackup, reviveDate } from "../backup";
import { getApiBaseUrl } from "../community";
import {
	db,
	type GameStats,
	type LocalCard,
	type PracticeSessionRecord,
} from "../db";
import { getCurrentUserHandle, setCurrentUserHandle } from "./handle";
import {
	getCloudBackupStatus,
	getLastCloudBackupTime,
	setLastCloudBackupTime,
} from "./status";

export async function restoreCloudBackup(rawHandle: string): Promise<{
	success: boolean;
	stats?: { cardsCount: number; streakCount: number; xpCount: number };
	backupAt?: number;
	error?: string;
}> {
	try {
		const handle = normalizeUserHandle(rawHandle);
		const baseUrl = getApiBaseUrl();

		const res = await fetch(
			`${baseUrl}/api/backup/cloud?handle=${encodeURIComponent(handle)}`,
		);

		const result = (await res.json().catch(() => ({}))) as {
			success?: boolean;
			backupData?: BackupFile & { practiceHistory?: unknown[] };
			backupAt?: number;
			stats?: { cardsCount: number; streakCount: number; xpCount: number };
			error?: string;
		};

		if (!res.ok || !result.success || !result.backupData) {
			return {
				success: false,
				error:
					result.error ||
					`Cadangan untuk ID "${handle}" tidak ditemukan di server`,
			};
		}

		// 1. Pulihkan struktur kartu & statistik
		await importBackup(result.backupData);

		// 2. Pulihkan practice history jika ada
		if (
			Array.isArray(result.backupData.practiceHistory) &&
			result.backupData.practiceHistory.length > 0
		) {
			await db.practiceHistory.clear();
			await db.practiceHistory.bulkPut(
				result.backupData.practiceHistory as unknown as Parameters<
					typeof db.practiceHistory.bulkPut
				>[0],
			);
		}

		// 3. Simpan handle ini sebagai handle aktif di perangkat saat ini
		setCurrentUserHandle(handle);
		if (result.backupAt) {
			setLastCloudBackupTime(result.backupAt);
		}

		return {
			success: true,
			stats: result.stats,
			backupAt: result.backupAt,
		};
	} catch (e) {
		return {
			success: false,
			error:
				e instanceof Error
					? e.message
					: "Terjadi kesalahan saat memulihkan data",
		};
	}
}

/**
 * Penggabungan cerdas (intelligent merge) dua arah antara data lokal dan data dari Cloudflare R2.
 * Membandingkan review terbaru kartu FSRS, menggabungkan XP & streak, dan union riwayat latihan.
 */
export async function mergeCloudBackup(
	remoteData: BackupFile & { practiceHistory?: unknown[] },
): Promise<{
	success: boolean;
	cardsUpdated: number;
	cardsAdded: number;
	hasLocalAhead: boolean;
	error?: string;
}> {
	try {
		const incomingCards = remoteData.data?.cards || [];
		const incomingStats = remoteData.data?.gameStats;
		const incomingHabitats = remoteData.data?.habitats || [];
		const incomingHistory = (remoteData.practiceHistory ||
			[]) as PracticeSessionRecord[];

		let cardsUpdated = 0;
		let cardsAdded = 0;
		let hasLocalAhead = false;

		await db.transaction(
			"rw",
			db.cards,
			db.gameStats,
			db.habitats,
			db.practiceHistory,
			async () => {
				const localCards = await db.cards.toArray();
				const localById = new Map<string, LocalCard>();
				const localByFront = new Map<string, LocalCard>();

				for (const c of localCards) {
					localById.set(c.id, c);
					localByFront.set(c.front.trim().toLowerCase(), c);
				}

				const cardsToPut: LocalCard[] = [];
				const processedLocalIds = new Set<string>();

				for (const rawRemote of incomingCards) {
					const remote: LocalCard = {
						...rawRemote,
						due: reviveDate(rawRemote.due),
						last_review: rawRemote.last_review
							? reviveDate(rawRemote.last_review)
							: undefined,
						createdAt: reviveDate(rawRemote.createdAt),
					};

					const local =
						localById.get(remote.id) ||
						localByFront.get(remote.front.trim().toLowerCase());

					if (!local) {
						// Kartu baru dari cloud
						cardsToPut.push(remote);
						cardsAdded++;
					} else {
						processedLocalIds.add(local.id);

						const remoteTime = remote.last_review
							? new Date(remote.last_review).getTime()
							: 0;
						const localTime = local.last_review
							? new Date(local.last_review).getTime()
							: 0;

						if (remoteTime > localTime) {
							// Review di cloud lebih baru
							cardsToPut.push({
								...local,
								...remote,
								id: local.id, // Pertahankan ID lokal
							});
							cardsUpdated++;
						} else if (localTime > remoteTime) {
							// Review di lokal lebih baru daripada di cloud
							hasLocalAhead = true;
						} else {
							// Waktu review sama, bandingkan reps
							if ((remote.reps || 0) > (local.reps || 0)) {
								cardsToPut.push({
									...local,
									...remote,
									id: local.id,
								});
								cardsUpdated++;
							} else if ((local.reps || 0) > (remote.reps || 0)) {
								hasLocalAhead = true;
							}
						}
					}
				}

				// Jika ada kartu lokal yang tidak ada di cloud, tandai bahwa lokal memiliki data tambahan
				if (localCards.some((c) => !processedLocalIds.has(c.id))) {
					hasLocalAhead = true;
				}

				if (cardsToPut.length > 0) {
					await db.cards.bulkPut(cardsToPut);
				}

				// Merge GameStats
				const localStats = await db.gameStats.get("user");
				if (incomingStats) {
					const mergedXp = Math.max(localStats?.xp || 0, incomingStats.xp || 0);

					let mergedStreak = localStats?.streakCount || 0;
					let mergedStreakDay = localStats?.streakLastDay || null;

					if (
						incomingStats.streakLastDay &&
						(!localStats?.streakLastDay ||
							incomingStats.streakLastDay > localStats.streakLastDay)
					) {
						mergedStreak = incomingStats.streakCount;
						mergedStreakDay = incomingStats.streakLastDay;
					} else if (
						incomingStats.streakLastDay === localStats?.streakLastDay
					) {
						mergedStreak = Math.max(
							localStats?.streakCount || 0,
							incomingStats.streakCount || 0,
						);
					}

					const mergedStats: GameStats = {
						id: "user",
						xp: mergedXp,
						streakCount: mergedStreak,
						streakLastDay: mergedStreakDay,
						todayKey: localStats?.todayKey || incomingStats.todayKey || null,
						todayCount: Math.max(
							localStats?.todayCount || 0,
							incomingStats.todayCount || 0,
						),
						dailyGoal: localStats?.dailyGoal || incomingStats.dailyGoal || 20,
					};

					await db.gameStats.put(mergedStats);
				}

				// Merge Habitats
				if (incomingHabitats.length > 0) {
					const existingHabitats = await db.habitats.toArray();
					const existingCatSet = new Set(
						existingHabitats.map((h) => h.category),
					);
					const newHabitats = incomingHabitats.filter(
						(h) => !existingCatSet.has(h.category),
					);
					if (newHabitats.length > 0) {
						await db.habitats.bulkPut(newHabitats);
					}
				}

				// Merge Practice History
				if (incomingHistory.length > 0) {
					const localHistory = await db.practiceHistory.toArray();
					const existingTimestamps = new Set(
						localHistory.map((h) => h.timestamp),
					);
					const toAdd = incomingHistory.filter(
						(h) => !existingTimestamps.has(h.timestamp),
					);
					if (toAdd.length > 0) {
						await db.practiceHistory.bulkAdd(
							toAdd.map((item) => {
								const { id: _, ...rest } = item;
								return rest;
							}),
						);
					}
				}
			},
		);

		return {
			success: true,
			cardsUpdated,
			cardsAdded,
			hasLocalAhead,
		};
	} catch (e) {
		return {
			success: false,
			cardsUpdated: 0,
			cardsAdded: 0,
			hasLocalAhead: false,
			error:
				e instanceof Error ? e.message : "Gagal menggabungkan data cadangan",
		};
	}
}

/**
 * Pengecekan ringan status R2 (HEAD) dan pull data terbaru jika cloud lebih baru.
 */
export async function pullAndMergeCloudBackup(rawHandle?: string): Promise<{
	success: boolean;
	pulled: boolean;
	cardsUpdated?: number;
	cardsAdded?: number;
	hasLocalAhead?: boolean;
	error?: string;
}> {
	try {
		const handle = normalizeUserHandle(rawHandle || getCurrentUserHandle());
		if (!handle || handle === "kata-hero") {
			return { success: true, pulled: false };
		}

		if (typeof navigator !== "undefined" && !navigator.onLine) {
			return { success: false, pulled: false, error: "Perangkat offline" };
		}

		// 1. Cek status ringan terlebih dahulu (R2 HEAD)
		const status = await getCloudBackupStatus(handle);
		if (!status.exists || !status.backupAt) {
			return { success: true, pulled: false };
		}

		const localLastSync = getLastCloudBackupTime() || 0;
		// Jika cloud tidak lebih baru dari sinkronisasi lokal terakhir kita
		if (status.backupAt <= localLastSync) {
			return { success: true, pulled: false };
		}

		// 2. Unduh backup penuh dari R2
		const baseUrl = getApiBaseUrl();
		const res = await fetch(
			`${baseUrl}/api/backup/cloud?handle=${encodeURIComponent(handle)}`,
		);

		if (!res.ok) {
			return {
				success: false,
				pulled: false,
				error: `Gagal mengunduh cadangan (${res.status})`,
			};
		}

		const result = (await res.json().catch(() => ({}))) as {
			success?: boolean;
			backupData?: BackupFile & { practiceHistory?: unknown[] };
			backupAt?: number;
			error?: string;
		};

		if (!result.success || !result.backupData) {
			return {
				success: false,
				pulled: false,
				error: result.error || "Data cadangan tidak valid",
			};
		}

		// 3. Lakukan intelligent merge
		const mergeRes = await mergeCloudBackup(result.backupData);
		if (!mergeRes.success) {
			return {
				success: false,
				pulled: false,
				error: mergeRes.error,
			};
		}

		// Update last sync time
		const newSyncTime = result.backupAt || status.backupAt;
		setLastCloudBackupTime(newSyncTime);

		if (typeof window !== "undefined") {
			window.dispatchEvent(
				new CustomEvent("kata-cloud-synced", {
					detail: {
						type: "pull",
						backupAt: newSyncTime,
						cardsUpdated: mergeRes.cardsUpdated,
						cardsAdded: mergeRes.cardsAdded,
					},
				}),
			);
		}

		return {
			success: true,
			pulled: true,
			cardsUpdated: mergeRes.cardsUpdated,
			cardsAdded: mergeRes.cardsAdded,
			hasLocalAhead: mergeRes.hasLocalAhead,
		};
	} catch (e) {
		return {
			success: false,
			pulled: false,
			error:
				e instanceof Error ? e.message : "Kesalahan koneksi saat pull data",
		};
	}
}
