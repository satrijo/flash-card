/*
 * useAutoSync — dipasang sekali di __root.tsx.
 * First visit (belum pernah sync sukses): jalankan runSync penuh —
 * SyncGate akan menampilkan layar progress karena phase bukan done/offline.
 * Kunjungan berikutnya: version-check senyap; kalau versi beda → download
 * di background, SyncGate menampilkan toast kecil saat downloading.
 * Re-run saat kembali online.
 */

import { useEffect } from "react";
import { db } from "../lib/db";
import { getSyncState, runSync } from "../lib/sync";

let lastSyncAttempt = 0;

export function useAutoSync() {
	useEffect(() => {
		const triggerSync = async (forceMinDelay = false) => {
			const count = await db.cards.count();
			const hasChosen =
				typeof window !== "undefined"
					? localStorage.getItem("kata_onboarding_choice")
					: "yes";

			// Jika 0 kartu dan belum pernah memilih di onboarding, biarkan SyncGate menampilkan opsi Selamat Datang
			if (count === 0 && !hasChosen) {
				return;
			}

			const now = Date.now();
			if (forceMinDelay && now - lastSyncAttempt < 60000) {
				return;
			}
			lastSyncAttempt = now;
			void runSync();
		};

		const state = getSyncState();
		if (
			state.phase === "idle" ||
			state.phase === "error" ||
			(state.phase === "offline" && navigator.onLine)
		) {
			void triggerSync(false);
		}

		const handleOnline = () => {
			void triggerSync(false);
		};
		window.addEventListener("online", handleOnline);

		// Re-check ringan saat tab kembali aktif (minimal 60 detik cooldown).
		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			const s = getSyncState();
			if (s.phase !== "downloading" && s.phase !== "checking") {
				triggerSync(true);
			}
		};
		document.addEventListener("visibilitychange", onVisible);

		return () => {
			window.removeEventListener("online", handleOnline);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, []);
}
