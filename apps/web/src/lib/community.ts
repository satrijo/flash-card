// apps/web/src/lib/community.ts
// Manajemen identitas unik device dan WebSocket Real-time Community Chat

import { type CommunityMessage, db } from "./db";

const ADJECTIVES = [
	"Polyglot",
	"Lexicon",
	"Fluent",
	"Cosmic",
	"Bright",
	"Swift",
	"Wordy",
	"Vivid",
	"Alpha",
	"Stellar",
	"Nimble",
	"Curious",
	"Brave",
	"Epic",
	"Zenith",
	"Radiant",
	"Clever",
	"Hyper",
	"Mystic",
	"Solar",
];

const NOUNS = [
	"Learner",
	"Explorer",
	"Voyager",
	"Runner",
	"Seeker",
	"Scholar",
	"Speaker",
	"Knight",
	"Nomad",
	"Pioneer",
	"Master",
	"Hero",
	"Guide",
	"Pilot",
	"Reader",
	"Linguist",
	"Crafter",
	"Builder",
	"Mind",
	"Sage",
];

const AVATAR_COLORS = [
	"from-indigo-500 to-purple-600",
	"from-emerald-500 to-teal-600",
	"from-amber-500 to-orange-600",
	"from-rose-500 to-pink-600",
	"from-blue-500 to-cyan-600",
	"from-violet-500 to-fuchsia-600",
	"from-lime-500 to-emerald-600",
	"from-cyan-500 to-blue-600",
];

const DEVICE_ID_KEY = "kata_device_id";
const USERNAME_KEY = "kata_username";

export function getOrCreateDeviceId(): string {
	if (typeof window === "undefined") return "server-device-000";
	try {
		let id = localStorage.getItem(DEVICE_ID_KEY);
		if (!id) {
			id =
				typeof crypto !== "undefined" && "randomUUID" in crypto
					? crypto.randomUUID()
					: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
			localStorage.setItem(DEVICE_ID_KEY, id);
		}
		return id;
	} catch {
		return "fallback-device-id";
	}
}

function generateDefaultUsername(deviceId: string): string {
	let hash = 0;
	for (let i = 0; i < deviceId.length; i++) {
		hash = (hash << 5) - hash + deviceId.charCodeAt(i);
		hash |= 0;
	}
	const absHash = Math.abs(hash);
	const adj = ADJECTIVES[absHash % ADJECTIVES.length];
	const noun = NOUNS[(absHash >> 3) % NOUNS.length];
	const suffix = (absHash % 900) + 100; // 100–999
	return `${adj}${noun}-${suffix}`;
}

export function getCommunityUsername(): string {
	if (typeof window === "undefined") return "kata-hero";
	try {
		const handle = localStorage.getItem("kata_user_handle");
		if (handle && handle.trim().length > 0) {
			return handle.trim();
		}
		const stored = localStorage.getItem(USERNAME_KEY);
		if (stored && stored.trim().length > 0) {
			return stored.trim();
		}
		const deviceId = getOrCreateDeviceId();
		const generated = generateDefaultUsername(deviceId);
		const defaultHandle = `kata-${generated.toLowerCase()}`;
		localStorage.setItem("kata_user_handle", defaultHandle);
		localStorage.setItem(USERNAME_KEY, defaultHandle);
		void db.meta.put({ key: "userHandle", value: defaultHandle });
		return defaultHandle;
	} catch {
		return "kata-hero";
	}
}

export function setCommunityUsername(name: string): string {
	const cleaned = name.trim().slice(0, 30);
	if (!cleaned) return getCommunityUsername();
	try {
		localStorage.setItem(USERNAME_KEY, cleaned);
		localStorage.setItem("kata_user_handle", cleaned);
		void db.meta.put({ key: "userHandle", value: cleaned });
		window.dispatchEvent(
			new CustomEvent("kata-username-changed", { detail: cleaned }),
		);
	} catch {
		// ignore
	}
	return cleaned;
}

export function getAvatarGradient(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash << 5) - hash + name.charCodeAt(i);
		hash |= 0;
	}
	const idx = Math.abs(hash) % AVATAR_COLORS.length;
	return AVATAR_COLORS[idx];
}

export function getInitials(name: string): string {
	const parts = name.split(/[-_ #]/).filter(Boolean);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return name.slice(0, 2).toUpperCase();
}

export function getApiBaseUrl(): string {
	if (typeof window === "undefined") return "";
	const envUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
	if (envUrl) {
		return envUrl.replace(/\/+$/, "");
	}
	// Default local dev fallback
	if (window.location.port === "3000") {
		return `${window.location.protocol}//${window.location.hostname}:8787`;
	}
	return window.location.origin;
}

export function getWsUrl(): string {
	if (typeof window === "undefined") return "";
	const baseUrl = getApiBaseUrl();
	const wsBase = baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
	return `${wsBase}/ws/community`;
}

// Batas umur pesan lokal: 1 hari / 24 jam (agar IndexedDB selalu ringan dan bersih)
const MAX_MESSAGE_AGE_MS = 1 * 24 * 60 * 60 * 1000;

export async function cleanupOldCommunityMessages(): Promise<number> {
	try {
		const cutoff = Date.now() - MAX_MESSAGE_AGE_MS;
		const deletedCount = await db.communityMessages
			.where("timestamp")
			.below(cutoff)
			.delete();
		return deletedCount;
	} catch (e) {
		console.warn("Gagal membersihkan pesan komunitas usang:", e);
		return 0;
	}
}

export async function saveLocalCommunityMessage(
	msg: CommunityMessage,
): Promise<void> {
	try {
		await db.communityMessages.put(msg);
	} catch (e) {
		console.warn("Gagal menyimpan pesan komunitas lokal:", e);
	}
}

export async function loadLocalCommunityMessages(
	limit = 50,
): Promise<CommunityMessage[]> {
	try {
		void cleanupOldCommunityMessages();

		return await db.communityMessages
			.orderBy("timestamp")
			.reverse()
			.limit(limit)
			.toArray()
			.then((res) => res.reverse());
	} catch {
		return [];
	}
}

export interface ActiveLearner {
	username: string;
	activity: string;
	lastSeen: number;
}

// REST fallback untuk memuat pesan jika WebSocket belum terhubung
export async function fetchCommunityMessagesRest(since?: number): Promise<{
	messages: CommunityMessage[];
	onlineCount: number;
	activeLearners?: ActiveLearner[];
} | null> {
	try {
		const baseUrl = getApiBaseUrl();
		const url =
			typeof since === "number" && since > 0
				? `${baseUrl}/api/community/messages?since=${since}`
				: `${baseUrl}/api/community/messages`;
		const res = await fetch(url);
		if (!res.ok) return null;
		return (await res.json()) as {
			messages: CommunityMessage[];
			onlineCount: number;
			activeLearners?: ActiveLearner[];
		};
	} catch {
		return null;
	}
}

// REST fallback untuk mengirim pesan
export async function sendCommunityMessageRest(
	payload: Partial<CommunityMessage> & { activity?: string },
): Promise<CommunityMessage | null> {
	try {
		const baseUrl = getApiBaseUrl();
		const res = await fetch(`${baseUrl}/api/community/messages`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			success: boolean;
			message: CommunityMessage;
		};
		return data.message;
	} catch {
		return null;
	}
}

export async function sendCommunityHeartbeatRest(
	deviceId: string,
	username: string,
	activity = "Online",
): Promise<{ onlineCount: number; activeLearners: ActiveLearner[] } | null> {
	try {
		const baseUrl = getApiBaseUrl();
		const res = await fetch(`${baseUrl}/api/community/heartbeat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ deviceId, username, activity }),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			success: boolean;
			onlineCount: number;
			activeLearners?: ActiveLearner[];
		};
		return {
			onlineCount: data.onlineCount,
			activeLearners: data.activeLearners || [],
		};
	} catch {
		return null;
	}
}
