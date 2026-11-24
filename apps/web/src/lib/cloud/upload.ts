// apps/web/src/lib/cloud/upload.ts
// Unggah cadangan: seluruh database lokal ke Cloudflare R2/D1.
import { buildBackup } from "../backup";
import { getApiBaseUrl, getOrCreateDeviceId } from "../community";
import { db } from "../db";
import { getCurrentUserHandle } from "./handle";
import { setLastCloudBackupTime } from "./status";

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
		setLastCloudBackupTime(backupTime);
		return { success: true, backupAt: backupTime };
	} catch (e) {
		return {
			success: false,
			error:
				e instanceof Error ? e.message : "Terjadi kesalahan saat mencadangkan",
		};
	}
}
