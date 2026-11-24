// apps/web/src/lib/cloud/status.ts
// Status cadangan cloud: waktu sinkron terakhir (lokal) + status riil
// dari Cloudflare R2/D1. Modul ini satu-satunya pemilik kunci
// STORAGE_KEY_LAST_BACKUP — modul lain memakai get/set di sini.
import { normalizeUserHandle } from "@flashcard/shared";
import { getApiBaseUrl } from "../community";

const STORAGE_KEY_LAST_BACKUP = "kata_last_cloud_backup_time";

export function getLastCloudBackupTime(): number | null {
	if (typeof window === "undefined") return null;
	const val = localStorage.getItem(STORAGE_KEY_LAST_BACKUP);
	return val ? Number(val) : null;
}

export function setLastCloudBackupTime(time: number): void {
	if (typeof window === "undefined") return;
	localStorage.setItem(STORAGE_KEY_LAST_BACKUP, String(time));
}

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
			setLastCloudBackupTime(data.backupAt);
			return data;
		}
		return { exists: false };
	} catch {
		return { exists: false };
	}
}
