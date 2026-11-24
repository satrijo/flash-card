// apps/web/src/lib/cloudBackup.ts
// Manajemen ID Unik Pengguna (kata-<nama>) & Sinkronisasi Cadangan Cloud (Cloudflare R2 + D1)

import {
	createEmptyCard,
	isReservedHandle,
	normalizeCategory,
	normalizeUserHandle,
} from "@flashcard/shared";
import {
	type BackupFile,
	buildBackup,
	importBackup,
	reviveDate,
} from "./backup";
import {
	getApiBaseUrl,
	getCommunityUsername,
	getOrCreateDeviceId,
	setCommunityUsername,
} from "./community";
import {
	db,
	type GameStats,
	type LocalCard,
	type PracticeSessionRecord,
} from "./db";

const STORAGE_KEY_HANDLE = "kata_user_handle";
const STORAGE_KEY_LAST_BACKUP = "kata_last_cloud_backup_time";

export function getCurrentUserHandle(): string {
	if (typeof window === "undefined") return "kata-hero";
	const saved = localStorage.getItem(STORAGE_KEY_HANDLE);
	if (saved && saved.trim().length > 0) {
		return normalizeUserHandle(saved);
	}

	// Selaraskan dengan nama unik komunitas yang diturunkan dari device ID
	const commName = getCommunityUsername();
	const defaultHandle = normalizeUserHandle(commName);
	localStorage.setItem(STORAGE_KEY_HANDLE, defaultHandle);
	void db.meta.put({ key: "userHandle", value: defaultHandle });
	return defaultHandle;
}

export function setCurrentUserHandle(handle: string): void {
	if (typeof window === "undefined") return;
	const norm = normalizeUserHandle(handle);
	localStorage.setItem(STORAGE_KEY_HANDLE, norm);
	// Sinkronkan juga username komunitas agar sama persis
	setCommunityUsername(norm);
}

export function getLastCloudBackupTime(): number | null {
	if (typeof window === "undefined") return null;
	const val = localStorage.getItem(STORAGE_KEY_LAST_BACKUP);
	return val ? Number(val) : null;
}

// Periksa status riil cadangan langsung dari Cloudflare R2 / D1
export async function getCloudBackupStatus(handle: string): Promise<{
	exists: boolean;
	backupAt?: number;
	cardsCount?: number;
	storage?: "r2" | "d1";
}> {
	try {
		const norm = normalizeUserHandle(handle);
		const baseUrl = getApiBaseUrl();
		const res = await fetch(
			`${baseUrl}/api/backup/cloud/status?handle=${encodeURIComponent(norm)}`,
		);
		if (!res.ok) return { exists: false };
		const data = (await res.json()) as {
			exists: boolean;
			backupAt?: number;
			cardsCount?: number;
			storage?: "r2" | "d1";
		};
		if (data.exists && data.backupAt) {
			localStorage.setItem(STORAGE_KEY_LAST_BACKUP, String(data.backupAt));
			return data;
		}
		return { exists: false };
	} catch {
		return { exists: false };
	}
}

const STORAGE_KEY_ADMIN_KEY = "kata_admin_secret_key";

export function getAdminSecretKey(): string {
	if (typeof window === "undefined") return "";
	return localStorage.getItem(STORAGE_KEY_ADMIN_KEY) || "";
}

export function setAdminSecretKey(key: string): void {
	if (typeof window === "undefined") return;
	if (key) {
		localStorage.setItem(STORAGE_KEY_ADMIN_KEY, key.trim());
	} else {
		localStorage.removeItem(STORAGE_KEY_ADMIN_KEY);
	}
}

// Cek ketersediaan handle unik ke Cloudflare API
export async function checkHandleAvailability(
	handle: string,
	adminKey?: string,
): Promise<{
	available: boolean;
	ownedByMe: boolean;
	handle: string;
	requiresAdminKey?: boolean;
	error?: string;
}> {
	try {
		const norm = normalizeUserHandle(handle);
		const key = adminKey ?? getAdminSecretKey();

		const deviceId = getOrCreateDeviceId();
		const baseUrl = getApiBaseUrl();

		const url = key
			? `${baseUrl}/api/user/check-handle?handle=${encodeURIComponent(norm)}&deviceId=${encodeURIComponent(deviceId)}&adminKey=${encodeURIComponent(key)}`
			: `${baseUrl}/api/user/check-handle?handle=${encodeURIComponent(norm)}&deviceId=${encodeURIComponent(deviceId)}`;

		const res = await fetch(url);
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as {
				error?: string;
				requiresAdminKey?: boolean;
			};
			return {
				available: false,
				ownedByMe: false,
				handle: norm,
				requiresAdminKey: err.requiresAdminKey || isReservedHandle(norm),
				error: err.error || "Gagal memeriksa ID",
			};
		}
		return (await res.json()) as {
			available: boolean;
			ownedByMe: boolean;
			handle: string;
			requiresAdminKey?: boolean;
			error?: string;
		};
	} catch {
		return {
			available: false,
			ownedByMe: false,
			handle: normalizeUserHandle(handle),
			error: "Tidak dapat terhubung ke server",
		};
	}
}

// Klaim / simpan ID unik ke database Cloudflare
export async function claimUserHandle(
	handle: string,
	adminKey?: string,
): Promise<{
	success: boolean;
	handle: string;
	requiresAdminKey?: boolean;
	error?: string;
}> {
	try {
		const norm = normalizeUserHandle(handle);
		const key = adminKey ?? getAdminSecretKey();

		const deviceId = getOrCreateDeviceId();
		const baseUrl = getApiBaseUrl();

		const res = await fetch(`${baseUrl}/api/user/claim-handle`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ handle: norm, deviceId, adminKey: key }),
		});

		const data = (await res.json().catch(() => ({}))) as {
			success?: boolean;
			handle?: string;
			requiresAdminKey?: boolean;
			error?: string;
		};

		if (!res.ok || !data.success) {
			return {
				success: false,
				handle: norm,
				requiresAdminKey: data.requiresAdminKey || isReservedHandle(norm),
				error: data.error || "Gagal mengklaim ID unik",
			};
		}

		if (key) {
			setAdminSecretKey(key);
		}
		setCurrentUserHandle(norm);
		return { success: true, handle: norm };
	} catch {
		return {
			success: false,
			handle: normalizeUserHandle(handle),
			error: "Gagal terhubung ke server untuk menyimpan ID",
		};
	}
}

// Cadangkan seluruh database lokal (kartu, stats, streak, history) ke Cloudflare R2 / D1
export async function createCloudBackup(): Promise<{
	success: boolean;
	backupAt?: number;
	error?: string;
}> {
	try {
		const handle = getCurrentUserHandle();
		const deviceId = getOrCreateDeviceId();
		const baseUrl = getApiBaseUrl();

		// 1. Ambil seluruh data lokal (cards, habitats, stats, meta, practice history)
		const [backupData, practiceHistory, stats] = await Promise.all([
			buildBackup(),
			db.practiceHistory.toArray(),
			db.gameStats.get("user"),
		]);

		const fullBackupPayload = {
			...backupData,
			practiceHistory,
		};

		const cardsCount = backupData.data.cards.length;
		const streakCount = stats?.streakCount ?? 0;
		const xpCount = stats?.xp ?? 0;

		// 2. Kirim ke endpoint cloud backup
		const res = await fetch(`${baseUrl}/api/backup/cloud`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				handle,
				deviceId,
				backupData: fullBackupPayload,
				stats: { cardsCount, streakCount, xpCount },
			}),
		});

		const result = (await res.json().catch(() => ({}))) as {
			success?: boolean;
			backupAt?: number;
			error?: string;
		};

		if (!res.ok || !result.success) {
			return {
				success: false,
				error: result.error || "Gagal menyimpan cadangan ke cloud",
			};
		}

		const backupTime = result.backupAt || Date.now();
		localStorage.setItem(STORAGE_KEY_LAST_BACKUP, String(backupTime));
		return { success: true, backupAt: backupTime };
	} catch (e) {
		return {
			success: false,
			error:
				e instanceof Error ? e.message : "Terjadi kesalahan saat mencadangkan",
		};
	}
}

// Pulihkan data dari cloud untuk ID unik tertentu
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
			localStorage.setItem(STORAGE_KEY_LAST_BACKUP, String(result.backupAt));
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
		localStorage.setItem(STORAGE_KEY_LAST_BACKUP, String(newSyncTime));

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

export interface SharedCategorySummary {
	name: string;
	totalCards: number;
	newCards: number;
	existingCards: number;
}

// Preview koleksi kartu milik pengguna lain dari Cloudflare R2 / D1
export async function previewCloudDeck(rawHandle: string): Promise<{
	success: boolean;
	handle: string;
	totalCards: number;
	totalNewCards: number;
	totalExistingCards: number;
	categories: SharedCategorySummary[];
	sampleCards: { front: string; back: string; category: string }[];
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
			backupData?: BackupFile;
			backupAt?: number;
			error?: string;
		};

		if (!res.ok || !result.success || !result.backupData?.data?.cards) {
			return {
				success: false,
				handle,
				totalCards: 0,
				totalNewCards: 0,
				totalExistingCards: 0,
				categories: [],
				sampleCards: [],
				error:
					result.error ||
					`Koleksi untuk ID "${handle}" tidak ditemukan di server`,
			};
		}

		const incomingCards = result.backupData.data.cards;
		const localCards = await db.cards.toArray();
		const localWords = new Set(
			localCards.map((c) => c.front.trim().toLowerCase()),
		);

		const catMap = new Map<
			string,
			{ total: number; newCount: number; existingCount: number }
		>();
		let totalNew = 0;
		let totalExisting = 0;

		for (const c of incomingCards) {
			const cat = normalizeCategory(c.category);
			const isExisting = localWords.has(c.front.trim().toLowerCase());

			let current = catMap.get(cat);
			if (!current) {
				current = { total: 0, newCount: 0, existingCount: 0 };
				catMap.set(cat, current);
			}
			current.total++;
			if (isExisting) {
				current.existingCount++;
				totalExisting++;
			} else {
				current.newCount++;
				totalNew++;
			}
		}

		const categoriesSummary: SharedCategorySummary[] = Array.from(
			catMap.entries(),
		)
			.map(([name, stat]) => ({
				name,
				totalCards: stat.total,
				newCards: stat.newCount,
				existingCards: stat.existingCount,
			}))
			.sort((a, b) => b.totalCards - a.totalCards);

		return {
			success: true,
			handle,
			totalCards: incomingCards.length,
			totalNewCards: totalNew,
			totalExistingCards: totalExisting,
			categories: categoriesSummary,
			sampleCards: incomingCards.slice(0, 6).map((c) => ({
				front: c.front,
				back: c.back,
				category: normalizeCategory(c.category),
			})),
			backupAt: result.backupAt,
		};
	} catch (e) {
		return {
			success: false,
			handle: normalizeUserHandle(rawHandle),
			totalCards: 0,
			totalNewCards: 0,
			totalExistingCards: 0,
			categories: [],
			sampleCards: [],
			error:
				e instanceof Error
					? e.message
					: "Terjadi kesalahan saat memeriksa koleksi",
		};
	}
}

// Unduh & gabungkan kartu milik pengguna lain (Non-Destructive: hanya menambah yang belum ada)
export async function mergeCardsFromCloudUser(
	rawHandle: string,
	selectedCategories?: string[],
): Promise<{
	success: boolean;
	handle: string;
	addedCount: number;
	skippedCount: number;
	totalIncoming: number;
	newCategories: string[];
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
			backupData?: BackupFile;
			error?: string;
		};

		if (!res.ok || !result.success || !result.backupData?.data?.cards) {
			return {
				success: false,
				handle,
				addedCount: 0,
				skippedCount: 0,
				totalIncoming: 0,
				newCategories: [],
				error:
					result.error ||
					`Koleksi untuk ID "${handle}" tidak ditemukan di server`,
			};
		}

		const incomingCards = result.backupData.data.cards;
		const existingLocal = await db.cards.toArray();

		// Index kata lokal yang sudah ada (lowercase & trimmed front)
		const existingWords = new Set<string>();
		const existingIds = new Set<string>();
		const existingCats = new Set<string>();

		for (const ec of existingLocal) {
			existingWords.add(ec.front.trim().toLowerCase());
			existingIds.add(ec.id);
			existingCats.add(normalizeCategory(ec.category));
		}

		const now = new Date();
		const toAdd: LocalCard[] = [];
		let skippedCount = 0;
		const newlyAddedCats = new Set<string>();

		const targetCategories =
			selectedCategories && selectedCategories.length > 0
				? new Set(selectedCategories.map((c) => normalizeCategory(c)))
				: null;

		for (const ic of incomingCards) {
			const frontKey = String(ic.front || "")
				.trim()
				.toLowerCase();
			if (!frontKey) continue;

			const finalCat = normalizeCategory(ic.category);

			// Jika user memilih filter kategori tertentu
			if (targetCategories && !targetCategories.has(finalCat)) {
				continue;
			}

			// Lewati jika kata sudah ada di lokal pengguna
			if (existingWords.has(frontKey)) {
				skippedCount++;
				continue;
			}

			existingWords.add(frontKey); // Hindari duplikasi internal di array incoming

			if (!existingCats.has(finalCat)) {
				newlyAddedCats.add(finalCat);
			}

			const empty = createEmptyCard(now);
			const newId =
				ic.id && !existingIds.has(ic.id) ? ic.id : crypto.randomUUID();
			existingIds.add(newId);

			toAdd.push({
				...empty,
				id: newId,
				front: ic.front.trim(),
				back: ic.back.trim(),
				category: finalCat,
				due: now,
				createdAt: now,
			});
		}

		if (toAdd.length > 0) {
			await db.cards.bulkAdd(toAdd);
		}

		return {
			success: true,
			handle,
			addedCount: toAdd.length,
			skippedCount,
			totalIncoming: incomingCards.length,
			newCategories: Array.from(newlyAddedCats),
		};
	} catch (e) {
		return {
			success: false,
			handle: normalizeUserHandle(rawHandle),
			addedCount: 0,
			skippedCount: 0,
			totalIncoming: 0,
			newCategories: [],
			error:
				e instanceof Error
					? e.message
					: "Terjadi kesalahan saat mengimpor koleksi",
		};
	}
}
