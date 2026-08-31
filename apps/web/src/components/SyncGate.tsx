/*
 * SyncGate — Onboarding & Sinkronisasi:
 *  1. First visit tanpa kartu: Menyapa pengguna baru dengan pilihan:
 *     - Mulai belajar baru (Sync dari database Kata)
 *     - Pulihkan dari ID Unik (Restore cadangan cloud saat pindah device)
 *     - Opsi offline / cadangan file lokal
 *  2. Kunjungan berikutnya: Toast kecil non-blokir saat download background.
 * Jika ada kartu di database lokal → tidak pernah memblokir layar.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "../lib/analytics";
import { importBackup, isBackupFile } from "../lib/backup";
import { normalizeUserHandle, restoreCloudBackup } from "../lib/cloudBackup";
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

	// Onboarding Gate state
	const [gateMode, setGateMode] = useState<"welcome" | "restore_id">("welcome");
	const [restoreHandleInput, setRestoreHandleInput] = useState("");
	const [isRestoring, setIsRestoring] = useState(false);
	const [restoreError, setRestoreError] = useState<string | null>(null);
	const [restoreSuccess, setRestoreSuccess] = useState(false);

	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => subscribeSync(setSync), []);

	const handleStartFresh = async () => {
		localStorage.setItem("kata_onboarding_choice", "new");
		trackEvent("onboarding_start_fresh");
		if (navigator.onLine) {
			await runSync({ force: true });
		} else {
			await handleLoadSeed();
		}
	};

	const handleDoRestore = async () => {
		const target = normalizeUserHandle(restoreHandleInput);
		if (!target || target === "kata-") {
			setRestoreError("Masukkan ID unik akun kamu (contoh: kata-joane)");
			return;
		}

		setIsRestoring(true);
		setRestoreError(null);

		const res = await restoreCloudBackup(target);
		setIsRestoring(false);

		if (res.success) {
			setRestoreSuccess(true);
			trackEvent("onboarding_restore_success", { handle: target });
			localStorage.setItem("kata_onboarding_choice", "restored");
			setTimeout(() => {
				setRestoreSuccess(false);
			}, 1500);
		} else {
			setRestoreError(res.error || "Cadangan untuk ID ini tidak ditemukan");
		}
	};

	const handleLoadSeed = async () => {
		setManualLoading(true);
		try {
			localStorage.setItem("kata_onboarding_choice", "offline_seed");
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
			localStorage.setItem("kata_onboarding_choice", "json_file");
		} catch (err) {
			alert(
				`Gagal memulihkan: ${err instanceof Error ? err.message : "terjadi kesalahan"}`,
			);
		}
	};

	if (hasCards === null || bypassed) return null;

	// ===== Mode 1: First Visit Onboarding Gate (0 kartu di lokal) =====
	if (!hasCards) {
		const isDownloading = sync.phase === "downloading" || manualLoading;
		const pct =
			sync.total > 0
				? Math.min(100, Math.round((sync.downloaded / sync.total) * 100))
				: sync.downloaded > 0
					? 100
					: 0;

		// 1.1 Sedang mengunduh deck kartu
		if (isDownloading) {
			return (
				<div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center px-6 text-center animate-fade-in-up">
					<div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-primary to-indigo-600 text-white flex items-center justify-center mb-6 shadow-xl shadow-primary/30 animate-soft-pulse">
						<Icon name="sparkles" className="w-8 h-8" />
					</div>
					<h1 className="text-2xl md:text-3xl font-black text-ink mb-2 tracking-tight">
						Menyiapkan Kosakata…
					</h1>
					<p className="text-muted mb-8 max-w-xs text-sm font-medium">
						{manualLoading || sync.phase === "downloading"
							? `Mengunduh kartu kosakata… ${sync.downloaded}${sync.total > 0 ? ` / ${sync.total}` : ""}`
							: sync.phase === "error"
								? `Gagal mengunduh: ${sync.error ?? "Terjadi kesalahan koneksi"}`
								: sync.phase === "offline"
									? "Perangkat sedang offline."
									: "Memeriksa kosakata offline…"}
					</p>

					<div className="w-full max-w-sm h-2.5 rounded-full bg-surface-2 border border-edge overflow-hidden">
						<div
							className="h-full rounded-full bg-gradient-to-r from-primary to-indigo-600 progress-fill"
							style={{ width: `${pct}%` }}
						/>
					</div>
					<p className="mt-3 font-mono text-[12px] font-bold text-muted">
						{sync.total > 0
							? `${sync.downloaded} / ${sync.total} kata`
							: "\u00A0"}
					</p>
				</div>
			);
		}

		// 1.2 Sub-Mode: Form Pulihkan dari ID
		if (gateMode === "restore_id") {
			return (
				<div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-fade-in-up">
					<div className="bg-surface border border-edge rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5 text-left">
						<div className="flex items-center gap-3">
							<div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
								<Icon name="refresh" className="w-6 h-6" />
							</div>
							<div>
								<h2 className="text-lg font-black text-ink">
									Pulihkan Data Akun
								</h2>
								<p className="text-xs text-muted">
									Pindah dari perangkat lain atau pulihkan data lama kamu
								</p>
							</div>
						</div>

						<div className="space-y-2">
							<label
								htmlFor="input-onboarding-restore-id"
								className="font-mono text-[11px] font-bold text-muted uppercase block"
							>
								ID Unik Cadangan
							</label>
							<input
								id="input-onboarding-restore-id"
								type="text"
								value={restoreHandleInput}
								onChange={(e) => setRestoreHandleInput(e.target.value)}
								placeholder="kata-joane"
								className="w-full px-3.5 py-3 rounded-control font-mono text-sm font-bold bg-surface-2 border border-edge text-ink focus:outline-none focus:border-primary"
							/>
							<p className="text-[11px] text-muted leading-relaxed">
								Masukkan ID unik akun yang sebelumnya kamu pakai untuk
								mencadangkan.
							</p>
						</div>

						{restoreError && (
							<div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-xs text-danger font-medium leading-relaxed">
								{restoreError}
							</div>
						)}

						{restoreSuccess && (
							<div className="p-3 rounded-xl bg-success/10 border border-success/20 text-xs text-success font-bold flex items-center gap-2">
								<Icon name="check-circle" className="w-4 h-4 shrink-0" />
								<span>Data berhasil dipulihkan! Membuka beranda…</span>
							</div>
						)}

						<div className="space-y-2 pt-2">
							<button
								type="button"
								onClick={() => void handleDoRestore()}
								disabled={isRestoring || !restoreHandleInput.trim()}
								className="w-full py-3.5 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform text-sm shadow-md shadow-primary/25 disabled:opacity-50 flex items-center justify-center gap-2"
							>
								{isRestoring ? (
									<>
										<Icon name="sparkles" className="w-4 h-4 animate-spin" />
										<span>Mengambil Data dari Cloud…</span>
									</>
								) : (
									<span>Pulihkan Data Sekarang</span>
								)}
							</button>

							<button
								type="button"
								onClick={() => {
									setGateMode("welcome");
									setRestoreError(null);
								}}
								className="w-full py-2.5 text-xs text-muted hover:text-ink font-semibold transition-colors"
							>
								← Kembali ke Menu Awal
							</button>
						</div>
					</div>
				</div>
			);
		}

		// 1.3 Menu Selamat Datang (Pilihan Baru vs Pulihkan)
		return (
			<div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-fade-in-up overflow-y-auto">
				<div className="max-w-md w-full space-y-6 my-auto py-6">
					{/* Logo & Headline */}
					<div className="space-y-2.5 flex flex-col items-center">
						<div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-primary via-indigo-500 to-primary text-white flex items-center justify-center shadow-xl shadow-primary/25 animate-soft-pulse">
							<Icon name="sparkles" className="w-8 h-8" />
						</div>
						<h1 className="text-2xl sm:text-3xl font-black text-ink tracking-tight">
							Selamat Datang di Kata! 👋
						</h1>
						<p className="text-xs sm:text-sm text-muted max-w-xs leading-relaxed font-medium">
							Aplikasi belajar kosakata bahasa Inggris harian dengan sistem
							Spaced Repetition (FSRS).
						</p>
					</div>

					{/* 2 Pilihan Utama */}
					<div className="space-y-3 text-left">
						{/* Opsi 1: Mulai Belajar Baru */}
						<button
							type="button"
							onClick={() => void handleStartFresh()}
							className="w-full p-4.5 rounded-2xl bg-surface border-2 border-primary/40 hover:border-primary hover:bg-surface-2 transition-all shadow-md group flex items-start gap-3.5 text-left active:scale-[0.99]"
						>
							<span className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
								<Icon name="book-open" className="w-5 h-5" />
							</span>
							<div className="flex-1 min-w-0">
								<div className="flex items-center justify-between gap-2">
									<h3 className="text-sm font-black text-ink group-hover:text-primary transition-colors">
										Mulai Belajar Baru
									</h3>
									<span className="px-2 py-0.5 rounded-pill bg-primary/15 text-primary font-mono text-[9px] font-bold">
										Rekomendasi
									</span>
								</div>
								<p className="text-xs text-muted mt-1 leading-relaxed">
									Unduh seluruh perpustakaan kosakata dan mulai belajar dari
									awal.
								</p>
							</div>
						</button>

						{/* Opsi 2: Pulihkan dari ID */}
						<button
							type="button"
							onClick={() => setGateMode("restore_id")}
							className="w-full p-4.5 rounded-2xl bg-surface border border-edge hover:border-primary/50 hover:bg-surface-2 transition-all shadow-sm group flex items-start gap-3.5 text-left active:scale-[0.99]"
						>
							<span className="w-10 h-10 rounded-xl bg-surface-2 text-ink border border-edge flex items-center justify-center shrink-0 group-hover:border-primary/40 transition-colors">
								<Icon name="refresh" className="w-5 h-5 text-primary" />
							</span>
							<div className="flex-1 min-w-0">
								<h3 className="text-sm font-black text-ink group-hover:text-primary transition-colors">
									Sudah Punya Akun?
								</h3>
								<p className="text-xs text-muted mt-1 leading-relaxed">
									Pulihkan kartu, streak, dan riwayat belajar kamu dengan ID
									Unik.
								</p>
							</div>
						</button>
					</div>

					{/* Opsi Alternatif / Offline */}
					<div className="pt-2 flex flex-col items-center gap-2">
						<button
							type="button"
							onClick={() => void handleLoadSeed()}
							className="text-[11px] font-bold text-muted hover:text-ink transition-colors underline"
						>
							Muat Kosakata Bawaan (Mode Offline)
						</button>
						<div className="flex items-center gap-3 text-[11px] text-muted">
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="hover:text-ink transition-colors"
							>
								Pilih File Cadangan .json
							</button>
							<span>•</span>
							<button
								type="button"
								onClick={() => setBypassed(true)}
								className="hover:text-ink transition-colors"
							>
								Lewati ke Beranda
							</button>
						</div>
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
		const pct = Math.min(100, Math.round((sync.downloaded / sync.total) * 100));
		return (
			<div className="fixed bottom-20 md:bottom-6 inset-x-4 md:left-auto md:right-6 md:w-80 z-50 animate-fade-in-up">
				<button
					type="button"
					onClick={() => setToastHidden(true)}
					className="w-full text-left bg-surface/95 backdrop-blur-md border border-edge rounded-card p-4 shadow-xl shadow-black/10 flex items-center gap-3.5 hover-lift"
				>
					<span className="w-9 h-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
						<Icon name="download" className="w-4 h-4" />
					</span>
					<span className="flex-1 min-w-0">
						<span className="block text-sm font-extrabold text-ink">
							Memperbarui kata…
						</span>
						<span className="block text-xs text-muted mt-0.5 font-medium">
							{sync.downloaded} / {sync.total} kata
						</span>
						<span className="block mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden">
							<span
								className="block h-full rounded-full bg-primary progress-fill"
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
