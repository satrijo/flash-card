/*
 * SyncGate — dua mode:
 *  1. First visit tanpa kartu: onboarding "menyiapkan kosakata" dengan progress
 *     dan opsi pemulihan offline/cadangan jika offline/error.
 *  2. Kunjungan berikutnya: toast kecil non-blokir saat download background.
 * Jika ada kartu di database lokal → tidak pernah memblokir layar.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { importBackup, isBackupFile } from "../lib/backup";
import { db } from "../lib/db";
import {
	getSyncState,
	loadBundledSeed,
	runSync,
	type SyncState,
	subscribeSync,
} from "../lib/sync";
import { Icon } from "./Icon";

export function SyncGate() {
	const [sync, setSync] = useState<SyncState>(getSyncState());
	const cardCount = useLiveQuery(() => db.cards.count());
	const lastSyncAt = useLiveQuery(() => db.meta.get("lastSyncAt"));
	const hasCards =
		cardCount === undefined ? null : cardCount > 0 || Boolean(lastSyncAt);
	const [toastHidden, setToastHidden] = useState(false);
	const [manualLoading, setManualLoading] = useState(false);
	const [bypassed, setBypassed] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => subscribeSync(setSync), []);

	const handleLoadSeed = async () => {
		setManualLoading(true);
		try {
			await loadBundledSeed();
		} finally {
			setManualLoading(false);
		}
	};

	const handleFileSelected = async (file: File) => {
		try {
			const text = await file.text();
			const parsed = JSON.parse(text);
			if (!isBackupFile(parsed)) {
				alert("File cadangan tidak valid");
				return;
			}
			await importBackup(parsed);
			setHasCards(true);
		} catch (err) {
			alert(
				`Gagal memulihkan: ${err instanceof Error ? err.message : "terjadi kesalahan"}`,
			);
		}
	};

	if (hasCards === null || bypassed) return null;

	// Hanya blokir jika BENAR-BENAR belum ada kartu sama sekali di perangkat
	const blocking =
		!hasCards &&
		(sync.phase === "checking" ||
			sync.phase === "downloading" ||
			sync.phase === "offline" ||
			sync.phase === "error" ||
			sync.phase === "idle" ||
			manualLoading);

	const pct =
		sync.total > 0
			? Math.min(100, Math.round((sync.downloaded / sync.total) * 100))
			: sync.downloaded > 0
				? 100
				: 0;

	// ===== Mode 1: Onboarding Gate (hanya saat 0 kartu) =====
	if (blocking) {
		return (
			<div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center px-6 text-center animate-fade-in-up">
				<div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-6 animate-pulse">
					<Icon name="sparkles" className="w-8 h-8" />
				</div>
				<h1 className="text-2xl md:text-3xl font-extrabold text-ink mb-2 tracking-tight">
					Menyiapkan kosakata…
				</h1>
				<p className="text-muted mb-8 max-w-xs text-sm">
					{manualLoading || sync.phase === "downloading"
						? `Menyiapkan kosakata… ${sync.downloaded}${sync.total > 0 ? ` / ${sync.total}` : ""}`
						: sync.phase === "error"
							? `Gagal mengunduh: ${sync.error ?? "Terjadi kesalahan koneksi"}`
							: sync.phase === "offline"
								? "Perangkat sedang offline."
								: "Memeriksa kosakata offline…"}
				</p>

				<div className="w-full max-w-sm h-3 rounded-full bg-surface-2 border border-edge overflow-hidden">
					<div
						className="h-full rounded-full bg-primary progress-fill"
						style={{ width: `${pct}%` }}
					/>
				</div>
				<p className="mt-3 font-mono text-[12px] font-semibold text-muted">
					{sync.total > 0
						? `${sync.downloaded} / ${sync.total} kata`
						: "\u00A0"}
				</p>

				{/* Aksi pemulihan jika offline / error */}
				{(sync.phase === "offline" || sync.phase === "error") &&
					!manualLoading && (
						<div className="mt-6 w-full max-w-xs space-y-2">
							<button
								type="button"
								onClick={() => void handleLoadSeed()}
								className="w-full py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform shadow text-sm"
							>
								Muat Kosakata Bawaan (Offline)
							</button>
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="w-full py-2.5 bg-surface border border-edge text-ink font-bold rounded-control active:scale-[0.98] transition-transform text-sm"
							>
								Pulihkan dari Cadangan
							</button>
							<div className="flex gap-2 pt-1">
								<button
									type="button"
									onClick={() => void runSync({ force: true })}
									className="flex-1 py-2 text-xs text-muted hover:text-ink font-semibold"
								>
									Coba Sync Lagi
								</button>
								<button
									type="button"
									onClick={() => setBypassed(true)}
									className="flex-1 py-2 text-xs text-muted underline hover:text-ink font-semibold"
								>
									Lanjut ke Beranda
								</button>
							</div>
							<input
								ref={fileInputRef}
								type="file"
								accept="application/json,.json"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) void handleFileSelected(file);
									e.target.value = "";
								}}
							/>
						</div>
					)}
			</div>
		);
	}

	// ===== Mode 2: Toast senyap (download di background saat kunjungan berikutnya) =====
	if (
		hasCards &&
		sync.phase === "downloading" &&
		!toastHidden &&
		sync.total > 0 &&
		sync.downloaded < sync.total
	) {
		return (
			<div className="fixed bottom-20 md:bottom-6 inset-x-4 md:left-auto md:right-6 md:w-80 z-50 animate-fade-in-up">
				<button
					type="button"
					onClick={() => setToastHidden(true)}
					className="w-full text-left bg-surface border border-edge rounded-card p-4 shadow-lg flex items-center gap-3"
				>
					<span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
						<Icon name="download" className="w-5 h-5" />
					</span>
					<span className="flex-1 min-w-0">
						<span className="block text-sm font-bold text-ink">
							Memperbarui kata…
						</span>
						<span className="block text-xs text-muted mt-0.5">
							{sync.downloaded} / {sync.total} kata
						</span>
						<span className="block mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden">
							<span
								className="block h-full rounded-full bg-success progress-fill"
								style={{ width: `${pct}%` }}
							/>
						</span>
					</span>
				</button>
			</div>
		);
	}

	return null;
}
