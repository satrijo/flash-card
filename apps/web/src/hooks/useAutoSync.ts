/*
 * useAutoSync — Initial Onboarding Guard di __root.tsx.
 *
 * HANYA berjalan satu kali saat pertama kali aplikasi dibuka dan IndexedDB
 * masih kosong (0 kartu & belum ada deckVersion).
 *
 * Setelah kartu diunduh atau tersimpan di lokal, hook ini TIDAK melakukan
 * background polling sama sekali (tidak ada listener visibilitychange / online)
 * guna menghemat kuota query D1 dan menjaga arsitektur offline-first murni.
 * Pembaruan selanjutnya dilakukan secara manual di menu Pengaturan.
 */

import { useEffect } from "react";
import { db } from "../lib/db";
import { getSyncState, runSync } from "../lib/sync";

export function useAutoSync() {
	useEffect(() => {
		const checkInitialSync = async () => {
			const count = await db.cards.count();
			const versionRow = await db.meta.get("deckVersion");

			// Jika sudah ada kartu atau versi tersimpan, jangan lakukan sinkronisasi otomatis
			if (count > 0 || versionRow?.value) {
				return;
			}

			const hasChosen =
				typeof window !== "undefined"
					? localStorage.getItem("kata_onboarding_choice")
					: "yes";

			// Jika 0 kartu dan belum memilih di onboarding, biarkan SyncGate menampilkan layar onboarding
			if (!hasChosen) {
				return;
			}

			const state = getSyncState();
			if (
				state.phase === "idle" ||
				state.phase === "error" ||
				(state.phase === "offline" && navigator.onLine)
			) {
				void runSync();
			}
		};

		void checkInitialSync();
	}, []);
}
