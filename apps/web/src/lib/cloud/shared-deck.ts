// apps/web/src/lib/cloud/shared-deck.ts
// Koleksi kartu milik pengguna lain: preview + impor non-destruktif.
import {
	createEmptyCard,
	normalizeCategory,
	normalizeUserHandle,
} from "@flashcard/shared";
import type { BackupFile } from "../backup";
import { getApiBaseUrl } from "../community";
import { db, type LocalCard } from "../db";

export interface SharedCategorySummary {
	name: string;
	totalCards: number;
	newCards: number;
	existingCards: number;
}

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
