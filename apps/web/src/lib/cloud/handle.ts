// apps/web/src/lib/cloud/handle.ts
// Identitas ID unik pengguna (kata-<nama>): baca/simpan handle aktif,
// Admin Secret Key, cek ketersediaan + klaim handle ke Cloudflare.
import { isReservedHandle, normalizeUserHandle } from "@flashcard/shared";
import {
	getApiBaseUrl,
	getCommunityUsername,
	getOrCreateDeviceId,
	setCommunityUsername,
} from "../community";
import { db } from "../db";

const STORAGE_KEY_HANDLE = "kata_user_handle";
const STORAGE_KEY_ADMIN_KEY = "kata_admin_secret_key";

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
