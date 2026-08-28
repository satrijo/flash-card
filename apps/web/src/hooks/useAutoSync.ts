/*
 * useAutoSync — dipasang sekali di __root.tsx.
 * First visit (belum pernah sync sukses): jalankan runSync penuh —
 * SyncGate akan menampilkan layar progress karena phase bukan done/offline.
 * Kunjungan berikutnya: version-check senyap; kalau versi beda → download
 * di background, SyncGate menampilkan toast kecil saat downloading.
 * Re-run saat kembali online.
 */

import { useEffect } from "react";
import { getSyncState, runSync } from "../lib/sync";

export function useAutoSync() {
	useEffect(() => {
		const state = getSyncState();
		if (
			state.phase === "idle" ||
			state.phase === "error" ||
			(state.phase === "offline" && navigator.onLine)
		) {
			void runSync();
		}

		const handleOnline = () => {
			void runSync();
		};
		window.addEventListener("online", handleOnline);

		// Re-check ringan saat tab kembali aktif (PWA sering resume).
		const onVisible = () => {
			if (document.visibilityState !== "visible") return;
			const s = getSyncState();
			if (s.phase !== "downloading" && s.phase !== "checking") {
				void runSync();
			}
		};
		document.addEventListener("visibilitychange", onVisible);

		return () => {
			window.removeEventListener("online", handleOnline);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, []);
}
