// apps/web/src/lib/history.ts
// Manajemen riwayat sesi latihan kosakata

import { db, type PracticeSessionRecord } from "./db";

// Simpan catatan sesi latihan yang baru selesai
export async function savePracticeSession(
	session: Omit<PracticeSessionRecord, "id">,
): Promise<number | undefined> {
	try {
		const id = await db.practiceHistory.add(session as PracticeSessionRecord);
		return typeof id === "number" ? id : undefined;
	} catch (e) {
		console.warn("Gagal menyimpan riwayat latihan:", e);
		return undefined;
	}
}

// Muat daftar sesi latihan terbaru
export async function loadPracticeSessions(
	limit = 30,
): Promise<PracticeSessionRecord[]> {
	try {
		return await db.practiceHistory
			.orderBy("timestamp")
			.reverse()
			.limit(limit)
			.toArray();
	} catch (e) {
		console.warn("Gagal memuat riwayat latihan:", e);
		return [];
	}
}

// Hapus seluruh riwayat latihan
export async function clearPracticeHistory(): Promise<void> {
	try {
		await db.practiceHistory.clear();
	} catch (e) {
		console.warn("Gagal menghapus riwayat latihan:", e);
	}
}
