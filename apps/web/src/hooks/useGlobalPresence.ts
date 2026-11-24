// apps/web/src/hooks/useGlobalPresence.ts
// Global presence & activity tracker hook across the entire app/PWA

import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	type ActiveLearner,
	getCommunityUsername,
	getOrCreateDeviceId,
	sendCommunityHeartbeatRest,
} from "../lib/community";

let globalOnlineCount = 1;
let globalActiveLearners: ActiveLearner[] = [];
const presenceListeners = new Set<() => void>();

function notifyListeners() {
	for (const listener of presenceListeners) {
		listener();
	}
}

export function useGlobalPresenceState(): {
	onlineCount: number;
	activeLearners: ActiveLearner[];
} {
	const [, setTick] = useState(0);

	useEffect(() => {
		const update = () => setTick((t) => t + 1);
		presenceListeners.add(update);
		return () => {
			presenceListeners.delete(update);
		};
	}, []);

	return {
		onlineCount: globalOnlineCount,
		activeLearners: globalActiveLearners,
	};
}

export function useGlobalPresence() {
	const routerState = useRouterState();
	const pathname = routerState.location.pathname;
	const search = (routerState.location.search ?? {}) as Record<string, unknown>;

	let activity = "Membuka Beranda";
	if (pathname.startsWith("/latihan")) {
		const tahap = typeof search.tahap === "string" ? search.tahap.trim() : "";
		activity = tahap
			? `Latihan Tahap ${tahap.toUpperCase()}`
			: "Latihan Kosakata";
	} else if (pathname.startsWith("/komunitas")) {
		activity = "Di Komunitas";
	} else if (pathname.startsWith("/statistik")) {
		activity = "Melihat Statistik";
	} else if (pathname.startsWith("/kelola")) {
		activity = "Kelola Deck";
	} else if (pathname.startsWith("/pengaturan")) {
		activity = "Pengaturan";
	}

	useEffect(() => {
		if (typeof window === "undefined") return;

		const deviceId = getOrCreateDeviceId();
		const username = getCommunityUsername();

		const sendHeartbeat = async () => {
			if (!navigator.onLine) return;
			const res = await sendCommunityHeartbeatRest(
				deviceId,
				username,
				activity,
			);
			if (res) {
				globalOnlineCount = res.onlineCount;
				globalActiveLearners = res.activeLearners;
				notifyListeners();
			}
		};

		// Heartbeat langsung saat mount / pindah halaman
		void sendHeartbeat();

		// Heartbeat berkala (25–35s dengan random jitter, hemat daya & kuota)
		let interval: ReturnType<typeof setInterval> | null = null;

		const startInterval = () => {
			if (interval) clearInterval(interval);
			const jitter = Math.floor(Math.random() * 8000);
			interval = setInterval(() => {
				if (document.visibilityState === "visible") {
					void sendHeartbeat();
				}
			}, 25_000 + jitter);
		};

		startInterval();

		// Heartbeat saat tab kembali aktif (dan pause saat tab di-minimize)
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void sendHeartbeat();
				startInterval();
			} else if (interval) {
				clearInterval(interval);
				interval = null;
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("online", sendHeartbeat);

		return () => {
			if (interval) clearInterval(interval);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.removeEventListener("online", sendHeartbeat);
		};
	}, [activity]);
}
