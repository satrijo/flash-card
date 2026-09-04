// apps/web/src/hooks/useCloudSync.ts
// Hook orkestrasi sinkronisasi dua arah otomatis (Up & Down) dengan Cloudflare R2

import { useEffect, useState } from "react";
import {
	createCloudBackup,
	getCurrentUserHandle,
	pullAndMergeCloudBackup,
} from "../lib/cloudBackup";

export type CloudSyncPhase =
	| "idle"
	| "pulling"
	| "pushing"
	| "synced"
	| "error";

export interface CloudSyncState {
	phase: CloudSyncPhase;
	lastSyncAt: number | null;
	error?: string;
}

let syncPhase: CloudSyncPhase = "idle";
let lastError: string | undefined;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;

const listeners = new Set<(state: CloudSyncState) => void>();

function notify() {
	const lastSync =
		typeof window !== "undefined"
			? Number(localStorage.getItem("kata_last_cloud_backup_time") || "0") ||
				null
			: null;

	const state: CloudSyncState = {
		phase: syncPhase,
		lastSyncAt: lastSync,
		error: lastError,
	};
	for (const fn of listeners) {
		fn(state);
	}
}

export function getCloudSyncState(): CloudSyncState {
	const lastSync =
		typeof window !== "undefined"
			? Number(localStorage.getItem("kata_last_cloud_backup_time") || "0") ||
				null
			: null;

	return {
		phase: syncPhase,
		lastSyncAt: lastSync,
		error: lastError,
	};
}

export function subscribeCloudSync(
	fn: (state: CloudSyncState) => void,
): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/**
 * Hook reaktif untuk membaca status siklus sinkronisasi cloud di komponen UI.
 */
export function useCloudSyncState(): CloudSyncState {
	const [state, setState] = useState<CloudSyncState>(getCloudSyncState);

	useEffect(() => {
		return subscribeCloudSync(setState);
	}, []);

	return state;
}

/**
 * Eksekusi langsung pengunggahan data lokal ke cloud (R2).
 */
export async function performCloudPush(): Promise<boolean> {
	if (typeof window === "undefined" || !navigator.onLine) return false;
	const handle = getCurrentUserHandle();
	if (!handle || handle === "kata-hero") return false;

	if (isSyncing) return false;
	isSyncing = true;
	syncPhase = "pushing";
	lastError = undefined;
	notify();

	try {
		const res = await createCloudBackup();
		if (res.success) {
			syncPhase = "synced";
			return true;
		}
		syncPhase = "error";
		lastError = res.error;
		return false;
	} catch (e) {
		syncPhase = "error";
		lastError = e instanceof Error ? e.message : "Gagal upload cadangan";
		return false;
	} finally {
		isSyncing = false;
		notify();
		if (syncPhase === "synced") {
			setTimeout(() => {
				if (syncPhase === "synced") {
					syncPhase = "idle";
					notify();
				}
			}, 3000);
		}
	}
}

/**
 * Pemicu penjadwalan unggahan data lokal ke cloud (R2) dengan debounce.
 * Aman dipanggil berulang (misal di setiap klik review kartu).
 */
export function scheduleCloudPush(debounceMs = 8000): void {
	if (typeof window === "undefined") return;

	if (pushTimer) {
		clearTimeout(pushTimer);
	}

	pushTimer = setTimeout(async () => {
		pushTimer = null;
		if (isSyncing) {
			scheduleCloudPush(3000);
			return;
		}
		await performCloudPush();
	}, debounceMs);
}

/**
 * Sinkronisasi instan dua arah (Pull lalu Push) sesuai permintaan pengguna.
 */
export async function syncCloudNow(): Promise<boolean> {
	if (pushTimer) {
		clearTimeout(pushTimer);
		pushTimer = null;
	}
	const pullRes = await performCloudPull();
	const pushRes = await performCloudPush();
	return pullRes || pushRes;
}

/**
 * Lakukan pengecekan dan pengunduhan data cloud (Pull & Merge).
 */
export async function performCloudPull(): Promise<boolean> {
	if (typeof window === "undefined" || !navigator.onLine) return false;
	const handle = getCurrentUserHandle();
	if (!handle || handle === "kata-hero") return false;

	if (isSyncing) return false;
	isSyncing = true;
	syncPhase = "pulling";
	lastError = undefined;
	notify();

	try {
		const res = await pullAndMergeCloudBackup(handle);
		if (res.success) {
			syncPhase = "synced";
			// Jika merge mendeteksi ada perubahan lokal yang lebih baru dari cloud, jadwalkan push
			if (res.hasLocalAhead) {
				scheduleCloudPush(4000);
			}
			return true;
		}
		if (res.error && res.error !== "Perangkat offline") {
			syncPhase = "error";
			lastError = res.error;
		} else {
			syncPhase = "idle";
		}
		return false;
	} catch (e) {
		syncPhase = "error";
		lastError = e instanceof Error ? e.message : "Gagal pull data";
		return false;
	} finally {
		isSyncing = false;
		notify();
		if (syncPhase === "synced") {
			setTimeout(() => {
				if (syncPhase === "synced") {
					syncPhase = "idle";
					notify();
				}
			}, 3000);
		}
	}
}

/**
 * Hook siklus hidup sinkronisasi akun dua arah — dipasang di __root.tsx
 */
export function useCloudSync() {
	const [, setTick] = useState(0);

	useEffect(() => {
		const unsub = subscribeCloudSync(() => setTick((t) => t + 1));

		// 1. Pull & merge saat mount pertama kali
		void performCloudPull();

		// 2. Pull & merge saat tab kembali aktif
		const onVisible = () => {
			if (document.visibilityState === "visible") {
				void performCloudPull();
			}
		};
		document.addEventListener("visibilitychange", onVisible);

		// 3. Pull & merge saat koneksi online kembali
		const onOnline = () => {
			void performCloudPull();
		};
		window.addEventListener("online", onOnline);

		// 4. Listener untuk custom trigger push
		const onTriggerPush = () => {
			scheduleCloudPush(8000);
		};
		window.addEventListener("kata-trigger-cloud-push", onTriggerPush);

		// 5. Polling periodik ringan setiap 60 detik (hanya jika tab visible)
		const interval = setInterval(() => {
			if (document.visibilityState === "visible" && !isSyncing) {
				void performCloudPull();
			}
		}, 60_000);

		return () => {
			unsub();
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("online", onOnline);
			window.removeEventListener("kata-trigger-cloud-push", onTriggerPush);
			clearInterval(interval);
		};
	}, []);
}
