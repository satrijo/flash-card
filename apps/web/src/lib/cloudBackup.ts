// apps/web/src/lib/cloudBackup.ts
// Manajemen ID Unik Pengguna (kata-<nama>) & Sinkronisasi Cadangan Cloud (Cloudflare R2 + D1)

import { createEmptyCard } from "@flashcard/shared";
import { type BackupFile, buildBackup, importBackup } from "./backup";
import {
	getApiBaseUrl,
	getCommunityUsername,
	getOrCreateDeviceId,
	setCommunityUsername,
} from "./community";
import { db, type LocalCard } from "./db";

const STORAGE_KEY_HANDLE = "kata_user_handle";
const STORAGE_KEY_LAST_BACKUP = "kata_last_cloud_backup_time";

export function normalizeUserHandle(input: string): string {
	let clean = String(input || "")
		.trim()
		.toLowerCase();
	if (!clean.startsWith("kata-")) {
		clean = `kata-${clean}`;
	}
	clean = clean.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
	return clean.slice(0, 30);
}

export function getCurrentUserHandle(): string {
	if (typeof window === "undefined") return "kata-hero";
	const saved = localStorage.getItem(STORAGE_KEY_HANDLE);
	if (saved && saved.trim().length > 0 && saved !== "kata-hero") {
		return normalizeUserHandle(saved);
	}

	// Selaraskan dengan nama unik komunitas yang diturunkan dari device ID
	const commName = getCommunityUsername();
	const defaultHandle = normalizeUserHandle(commName);
	localStorage.setItem(STORAGE_KEY_HANDLE, defaultHandle);
	return defaultHandle;
}

export function setCurrentUserHandle(handle: string): void {
	if (typeof window === "undefined") return;
	const norm = normalizeUserHandle(handle);
	localStorage.setItem(STORAGE_KEY_HANDLE, norm);
	// Sinkronkan juga username komunitas agar sama persis
	setCommunityUsername(norm);
}

export const RESERVED_HANDLES = new Set([
	"kata-admin",
	"kata-administrator",
	"kata-operator",
	"kata-op",
	"kata-mod",
	"kata-moderator",
	"kata-staff",
	"kata-system",
	"kata-support",
	"kata-official",
	"kata-katabot",
	"kata-bot",
	"kata-root",
	"kata-superuser",
	"kata-ai",
	"kata-tutor",
	"kata-help",
	"kata-developer",
	"kata-owner",
	"kata-founder",
	"kata-security",
]);

export function isReservedHandle(handle: string): boolean {
	const norm = handle.toLowerCase().trim();
	if (RESERVED_HANDLES.has(norm)) return true;
	const raw = norm.replace(/^kata-/, "");
	const reservedWords = [
		"admin",
		"administrator",
		"operator",
		"moderator",
		"staff",
		"system",
		"support",
		"official",
		"katabot",
		"superuser",
		"root",
		"security",
	];
	return reservedWords.some(
		(word) =>
			raw === word || raw.startsWith(`${word}-`) || raw.endsWith(`-${word}`),
	);
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
			const cat = (c.category || "general").trim().toLowerCase();
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
				category: (c.category || "general").trim().toLowerCase(),
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
			existingCats.add((ec.category || "general").trim().toLowerCase());
		}

		const now = new Date();
		const toAdd: LocalCard[] = [];
		let skippedCount = 0;
		const newlyAddedCats = new Set<string>();

		const targetCategories =
			selectedCategories && selectedCategories.length > 0
				? new Set(selectedCategories.map((c) => c.trim().toLowerCase()))
				: null;

		for (const ic of incomingCards) {
			const frontKey = String(ic.front || "")
				.trim()
				.toLowerCase();
			if (!frontKey) continue;

			const finalCat = (ic.category || "general").trim().toLowerCase();

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
