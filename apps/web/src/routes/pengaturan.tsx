/*
 * Rute /pengaturan — satu-satunya tempat kontrol non-gameplay:
 * toggle suara (TTS), target harian global, info deck + unduh ulang,
 * ID Akun Unik, Cadangan Cloud (R2+D1), dan cadangan lokal JSON.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { SharedDeckImportModal } from "../components/SharedDeckImportModal";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { useTheme } from "../hooks/useTheme";
import { trackEvent } from "../lib/analytics";
import { downloadBackup, importBackup, isBackupFile } from "../lib/backup";
import {
	checkHandleAvailability,
	claimUserHandle,
	createCloudBackup,
	getCloudBackupStatus,
	getCurrentUserHandle,
	getLastCloudBackupTime,
	isReservedHandle,
	normalizeUserHandle,
	restoreCloudBackup,
} from "../lib/cloudBackup";
import { db } from "../lib/db";
import { DEFAULT_DAILY_GOAL, ensureGameStats } from "../lib/game";
import {
	getSyncState,
	loadBundledSeed,
	runSync,
	type SyncState,
	subscribeSync,
} from "../lib/sync";
import { isTtsEnabled, setTtsEnabled, ttsSupported } from "../lib/tts";

export const Route = createFileRoute("/pengaturan")({
	component: PengaturanPage,
});

function PengaturanPage() {
	const pwa = usePwaInstall();
	const { theme, resolvedTheme, setTheme } = useTheme();
	const gameStats = useLiveQuery(() => db.gameStats.get("user"));
	const lastSyncAt = useLiveQuery(async () => {
		const row = await db.meta.get("lastSyncAt");
		return row?.value as string | undefined;
	});
	const cardCount = useLiveQuery(() => db.cards.count());

	const [ttsOn, setTtsOn] = useState<boolean | null>(null);
	const [syncState, setSyncState] = useState<SyncState>(getSyncState());
	const [goalDraft, setGoalDraft] = useState<string | null>(null);
	const [exported, setExported] = useState(false);
	const [restored, setRestored] = useState(false);
	const [backupError, setBackupError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// SSR-safe: navigator hanya diakses di effect (client).
	const [online, setOnline] = useState(true);

	// ID Akun Unik & Cloud Backup States
	const [userHandle, setUserHandle] = useState(() =>
		typeof window !== "undefined" ? getCurrentUserHandle() : "kata-user",
	);
	const [handleDraft, setHandleDraft] = useState(() =>
		typeof window !== "undefined" ? getCurrentUserHandle() : "",
	);
	const [adminKeyDraft, setAdminKeyDraft] = useState("");
	const [isEditingHandle, setIsEditingHandle] = useState(false);
	const [handleCheckStatus, setHandleCheckStatus] = useState<{
		checking: boolean;
		available?: boolean;
		ownedByMe?: boolean;
		requiresAdminKey?: boolean;
		error?: string;
	}>({ checking: false });
	const [isSavingHandle, setIsSavingHandle] = useState(false);
	const [handleSuccessMsg, setHandleSuccessMsg] = useState<string | null>(null);

	// Cloud Backup state
	const [isCloudBackingUp, setIsCloudBackingUp] = useState(false);
	const [cloudBackupSuccess, setCloudBackupSuccess] = useState(false);
	const [lastCloudBackup, setLastCloudBackup] = useState<number | null>(null);

	// Restore from Cloud Modal
	const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
	const [restoreTargetHandle, setRestoreTargetHandle] = useState("");
	const [isRestoringCloud, setIsRestoringCloud] = useState(false);
	const [restoreCloudError, setRestoreCloudError] = useState<string | null>(
		null,
	);
	const [restoreCloudSuccess, setRestoreCloudSuccess] = useState(false);

	// Import from Friend Modal
	const [isImportModalOpen, setIsImportModalOpen] = useState(false);

	useEffect(() => {
		void ensureGameStats();
		void isTtsEnabled().then(setTtsOn);
		setOnline(navigator.onLine);
		const up = () => setOnline(true);
		const down = () => setOnline(false);
		window.addEventListener("online", up);
		window.addEventListener("offline", down);
		const unsub = subscribeSync(setSyncState);

		// Muat handle & cloud backup timestamp
		const currentH = getCurrentUserHandle();
		setUserHandle(currentH);
		setHandleDraft(currentH);
		const cachedTime = getLastCloudBackupTime();
		if (cachedTime) setLastCloudBackup(cachedTime);

		// Periksa status riil langsung ke Cloudflare R2 / D1
		void getCloudBackupStatus(currentH).then((st) => {
			if (st.exists && st.backupAt) {
				setLastCloudBackup(st.backupAt);
			}
		});

		return () => {
			window.removeEventListener("online", up);
			window.removeEventListener("offline", down);
			unsub();
		};
	}, []);

	// Live check handle availability with debounce
	useEffect(() => {
		if (!isEditingHandle || !handleDraft.trim()) return;

		const norm = normalizeUserHandle(handleDraft);
		if (norm === userHandle) {
			setHandleCheckStatus({
				checking: false,
				available: true,
				ownedByMe: true,
			});
			return;
		}

		setHandleCheckStatus({ checking: true });
		const timer = setTimeout(async () => {
			const res = await checkHandleAvailability(norm, adminKeyDraft);
			setHandleCheckStatus({
				checking: false,
				available: res.available,
				ownedByMe: res.ownedByMe,
				requiresAdminKey: res.requiresAdminKey,
				error: res.error,
			});
		}, 400);

		return () => clearTimeout(timer);
	}, [handleDraft, adminKeyDraft, isEditingHandle, userHandle]);

	const handleSaveHandle = async () => {
		const norm = normalizeUserHandle(handleDraft);
		setIsSavingHandle(true);
		const res = await claimUserHandle(norm, adminKeyDraft);
		setIsSavingHandle(false);

		if (res.success) {
			setUserHandle(res.handle);
			setIsEditingHandle(false);
			trackEvent("user_handle_claimed", { handle: res.handle });
			setHandleSuccessMsg(`ID berhasil diubah menjadi ${res.handle}`);
			setTimeout(() => setHandleSuccessMsg(null), 3000);

			// Refresh status cadangan untuk handle yang baru diklaim
			void getCloudBackupStatus(res.handle).then((st) => {
				if (st.exists && st.backupAt) {
					setLastCloudBackup(st.backupAt);
				} else {
					setLastCloudBackup(null);
				}
			});
		} else {
			setHandleCheckStatus({
				checking: false,
				available: false,
				requiresAdminKey: res.requiresAdminKey || isReservedHandle(norm),
				error: res.error || "Gagal mengklaim ID unik",
			});
		}
	};

	const handleDoCloudBackup = async () => {
		setIsCloudBackingUp(true);
		setBackupError(null);
		const res = await createCloudBackup();
		setIsCloudBackingUp(false);

		if (res.success && res.backupAt) {
			setLastCloudBackup(res.backupAt);
			setCloudBackupSuccess(true);
			trackEvent("cloud_backup_created");
			setTimeout(() => setCloudBackupSuccess(false), 3000);
		} else {
			setBackupError(res.error || "Gagal mencadangkan ke cloud");
		}
	};

	const handleDoCloudRestore = async () => {
		const target = normalizeUserHandle(restoreTargetHandle);
		if (!target || target === "kata-") {
			setRestoreCloudError("Silakan masukkan ID unik yang valid");
			return;
		}

		setIsRestoringCloud(true);
		setRestoreCloudError(null);
		const res = await restoreCloudBackup(target);
		setIsRestoringCloud(false);

		if (res.success) {
			setRestoreCloudSuccess(true);
			trackEvent("cloud_backup_restored", { handle: target });
			setUserHandle(target);
			setHandleDraft(target);
			if (res.backupAt) setLastCloudBackup(res.backupAt);
			setTimeout(() => {
				setRestoreCloudSuccess(false);
				setIsRestoreModalOpen(false);
			}, 2000);
		} else {
			setRestoreCloudError(res.error || "Gagal memulihkan cadangan");
		}
	};

	const supported = ttsSupported();

	const toggleTts = async () => {
		const next = !(ttsOn ?? true);
		setTtsOn(next);
		await setTtsEnabled(next);
	};

	const saveGoal = async (raw: string | number) => {
		const num = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
		const clamped = Math.max(
			1,
			Math.min(999, Number.isFinite(num) && num > 0 ? num : DEFAULT_DAILY_GOAL),
		);
		setGoalDraft(null);
		await db.gameStats.update("user", { dailyGoal: clamped });
	};

	const isSyncing =
		syncState.phase === "downloading" || syncState.phase === "checking";

	const redownload = async () => {
		if (online) {
			await runSync({ force: true });
		} else {
			await loadBundledSeed();
		}
	};

	const handleDownload = async () => {
		try {
			await downloadBackup();
			setBackupError(null);
			setExported(true);
			window.setTimeout(() => setExported(false), 2000);
		} catch {
			setBackupError("Gagal membuat cadangan");
		}
	};

	const handleFileSelected = async (file: File) => {
		try {
			const text = await file.text();
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				setBackupError("File cadangan tidak valid");
				return;
			}
			if (!isBackupFile(parsed)) {
				setBackupError("File cadangan tidak valid");
				return;
			}
			const confirmed = window.confirm(
				"Ganti semua data lokal dengan isi cadangan ini?",
			);
			if (!confirmed) return;
			await importBackup(parsed);
			setBackupError(null);
			setRestored(true);
			window.setTimeout(() => setRestored(false), 2000);
		} catch (err) {
			setBackupError(
				`Gagal memulihkan: ${err instanceof Error ? err.message : "terjadi kesalahan"}`,
			);
		}
	};

	return (
		<div className="py-6 space-y-4">
			<section className="animate-fade-in-up">
				<Link
					to="/"
					className="font-mono text-[12px] font-bold text-muted hover:text-ink transition-colors uppercase tracking-wide inline-flex items-center gap-1 mb-2"
				>
					<Icon name="chevron-left" className="w-4 h-4" />
					Beranda
				</Link>
				<h1 className="text-2xl font-black text-ink tracking-tight">
					Pengaturan
				</h1>
			</section>

			{/* ===== SECTION KHUSUS: ID AKUN UNIK & CADANGAN CLOUD ===== */}
			<section className="rounded-card bg-gradient-to-br from-surface via-surface-2 to-surface border border-primary/30 p-5 sm:p-6 shadow-md hover-lift animate-fade-in-up">
				<div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-edge">
					<div className="flex items-center gap-3.5">
						<span className="w-11 h-11 rounded-2xl bg-primary text-white flex items-center justify-center shrink-0 shadow-md shadow-primary/25">
							<Icon name="user" className="w-5 h-5" />
						</span>
						<div>
							<div className="flex items-center gap-2 flex-wrap">
								<h2 className="font-black text-ink text-base">
									ID Pengguna & Cadangan Cloud
								</h2>
								<span className="px-2 py-0.5 rounded-pill bg-primary/15 text-primary text-[10px] font-mono font-bold">
									Otomatis & Aman
								</span>
							</div>
							<p className="text-xs text-muted mt-0.5">
								ID unik kamu dipakai di Komunitas dan untuk memulihkan data saat
								pindah perangkat.
							</p>
						</div>
					</div>
				</div>

				{/* Handle Display / Editor */}
				<div className="mt-4 space-y-3">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface-2/70 border border-edge">
						<div className="min-w-0 flex-1">
							<span className="text-[11px] font-mono font-bold text-muted uppercase tracking-wider block mb-1">
								ID Akun Unik Kamu:
							</span>
							{!isEditingHandle ? (
								<div className="flex items-center gap-2 flex-wrap">
									<span className="font-mono font-black text-base text-primary">
										{userHandle}
									</span>
									{userHandle.includes("admin") && (
										<span className="px-2 py-0.5 rounded-pill bg-amber-500/15 text-amber-500 font-mono text-[10px] font-bold border border-amber-500/30">
											👑 Administrator
										</span>
									)}
									{userHandle.includes("operator") && (
										<span className="px-2 py-0.5 rounded-pill bg-primary/15 text-primary font-mono text-[10px] font-bold border border-primary/30">
											⚡ Operator
										</span>
									)}
									<button
										type="button"
										onClick={() => {
											setHandleDraft(userHandle);
											setIsEditingHandle(true);
										}}
										className="px-2.5 py-1 rounded-control bg-surface border border-edge text-[11px] font-bold text-ink hover:bg-surface-2 hover:border-primary transition-colors"
									>
										Ubah ID
									</button>
								</div>
							) : (
								<div className="space-y-2 mt-1">
									<div className="flex items-center gap-2 max-w-sm">
										<input
											type="text"
											value={handleDraft}
											onChange={(e) => setHandleDraft(e.target.value)}
											placeholder="kata-nama-kamu"
											className="w-full px-3 py-1.5 rounded-control font-mono text-xs font-bold bg-surface border border-edge text-ink focus:outline-none focus:border-primary"
										/>
										<button
											type="button"
											onClick={() => void handleSaveHandle()}
											disabled={
												isSavingHandle ||
												handleCheckStatus.checking ||
												(isReservedHandle(normalizeUserHandle(handleDraft))
													? !adminKeyDraft.trim()
													: handleCheckStatus.available === false)
											}
											className="px-3 py-1.5 rounded-control bg-primary text-white text-xs font-bold hover:bg-primary-hover disabled:opacity-50 shrink-0 shadow-xs cursor-pointer"
										>
											{isSavingHandle ? "Menyimpan…" : "Simpan"}
										</button>
										<button
											type="button"
											onClick={() => {
												setIsEditingHandle(false);
												setAdminKeyDraft("");
												setHandleCheckStatus({ checking: false });
											}}
											className="px-2 py-1.5 text-xs text-muted hover:text-ink cursor-pointer"
										>
											Batal
										</button>
									</div>

									{/* Admin Key Prompt jika handle merupakan ID khusus */}
									{(handleCheckStatus.requiresAdminKey ||
										isReservedHandle(normalizeUserHandle(handleDraft))) && (
										<div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2 max-w-md animate-fade-in-up">
											<div className="flex items-center gap-1.5 text-xs text-amber-500 font-bold">
												<Icon name="sparkles" className="w-4 h-4" />
												<span>ID Khusus Administrator / Operator</span>
											</div>
											<p className="text-[11px] text-muted leading-relaxed">
												ID ini dilindungi. Masukkan{" "}
												<strong>Admin Secret Key</strong> untuk mengonfirmasi
												hak akses admin kamu:
											</p>
											<input
												type="password"
												value={adminKeyDraft}
												onChange={(e) => setAdminKeyDraft(e.target.value)}
												placeholder="Admin Secret Key…"
												className="w-full px-3 py-1.5 rounded-control font-mono text-xs font-bold bg-surface border border-edge text-ink focus:outline-none focus:border-amber-500"
											/>
										</div>
									)}

									{/* Status availability check */}
									{handleCheckStatus.checking && (
										<p className="text-[11px] text-muted font-mono animate-pulse">
											⏳ Memeriksa ketersediaan ID…
										</p>
									)}
									{!handleCheckStatus.checking &&
										isReservedHandle(normalizeUserHandle(handleDraft)) && (
											<p className="text-[11px] text-amber-500 font-mono font-semibold">
												🔒 ID Khusus Admin — Masukkan Admin Secret Key lalu klik
												Simpan
											</p>
										)}
									{!handleCheckStatus.checking &&
										!isReservedHandle(normalizeUserHandle(handleDraft)) &&
										handleCheckStatus.available === true && (
											<p className="text-[11px] text-success font-mono font-semibold">
												✓ ID tersedia dan bisa digunakan
											</p>
										)}
									{!handleCheckStatus.checking &&
										!isReservedHandle(normalizeUserHandle(handleDraft)) &&
										handleCheckStatus.available === false && (
											<p className="text-[11px] text-danger font-mono font-semibold">
												✗{" "}
												{handleCheckStatus.error ||
													"ID sudah digunakan orang lain"}
											</p>
										)}
								</div>
							)}
						</div>
					</div>

					{handleSuccessMsg && (
						<p className="text-xs text-success font-semibold px-1">
							✓ {handleSuccessMsg}
						</p>
					)}

					{/* Action Buttons: Cadangkan, Unduh Teman, & Pulihkan */}
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
						<button
							type="button"
							onClick={() => void handleDoCloudBackup()}
							disabled={isCloudBackingUp}
							className="py-3 px-3 rounded-control bg-primary text-white font-bold text-xs hover:bg-primary-hover shadow-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform"
						>
							<Icon name="sparkles" className="w-4 h-4" />
							<span>
								{isCloudBackingUp ? "Mencadangkan…" : "Cadangkan ke Cloud"}
							</span>
						</button>

						<button
							type="button"
							onClick={() => setIsImportModalOpen(true)}
							className="py-3 px-3 rounded-control bg-surface border border-edge text-ink font-bold text-xs hover:bg-surface-2 hover:border-primary/40 shadow-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform"
						>
							<Icon name="download" className="w-4 h-4 text-primary" />
							<span>Unduh Kartu Teman</span>
						</button>

						<button
							type="button"
							onClick={() => setIsRestoreModalOpen(true)}
							className="py-3 px-3 rounded-control bg-surface border border-edge text-ink font-bold text-xs hover:bg-surface-2 hover:border-primary/40 shadow-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform"
						>
							<Icon name="refresh" className="w-4 h-4 text-primary" />
							<span>Pindah Device</span>
						</button>
					</div>

					{/* Metadata Info */}
					<div className="flex items-center justify-between text-[11px] text-muted font-mono pt-1 px-1">
						<span>
							Status:{" "}
							{lastCloudBackup
								? `Terakhir dicadangkan ${new Date(lastCloudBackup).toLocaleString("id-ID")}`
								: "Belum pernah dicadangkan ke cloud"}
						</span>
						{cloudBackupSuccess && (
							<span className="text-success font-bold">
								✓ Berhasil dicadangkan!
							</span>
						)}
					</div>
				</div>
			</section>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{/* Column 1: Preferensi Belajar & Suara */}
				<div className="space-y-4">
					{/* ===== Tema Tampilan ===== */}
					<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-1">
						<div className="flex items-center gap-3.5 mb-3.5">
							<span className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
								<Icon
									name={resolvedTheme === "dark" ? "moon" : "sun"}
									className="w-5 h-5"
								/>
							</span>
							<div>
								<p className="font-extrabold text-ink text-sm">Tema Tampilan</p>
								<p className="text-xs text-muted mt-0.5">
									Pilih mode terang, gelap, atau ikuti pengaturan sistem
								</p>
							</div>
						</div>

						<div className="grid grid-cols-3 gap-2">
							<button
								type="button"
								onClick={() => setTheme("light")}
								className={`py-2 px-3 rounded-control text-xs font-bold transition flex items-center justify-center gap-1.5 border cursor-pointer ${
									theme === "light"
										? "bg-primary text-white border-primary shadow-xs"
										: "bg-surface-2 border-edge text-ink hover:border-primary/40"
								}`}
							>
								<Icon name="sun" className="w-3.5 h-3.5" />
								<span>Terang</span>
							</button>

							<button
								type="button"
								onClick={() => setTheme("dark")}
								className={`py-2 px-3 rounded-control text-xs font-bold transition flex items-center justify-center gap-1.5 border cursor-pointer ${
									theme === "dark"
										? "bg-primary text-white border-primary shadow-xs"
										: "bg-surface-2 border-edge text-ink hover:border-primary/40"
								}`}
							>
								<Icon name="moon" className="w-3.5 h-3.5" />
								<span>Gelap</span>
							</button>

							<button
								type="button"
								onClick={() => setTheme("system")}
								className={`py-2 px-3 rounded-control text-xs font-bold transition flex items-center justify-center gap-1.5 border cursor-pointer ${
									theme === "system"
										? "bg-primary text-white border-primary shadow-xs"
										: "bg-surface-2 border-edge text-ink hover:border-primary/40"
								}`}
							>
								<Icon name="sparkles" className="w-3.5 h-3.5" />
								<span>Otomatis</span>
							</button>
						</div>
					</section>

					{/* ===== Suara ===== */}
					<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-1">
						<div className="flex items-center justify-between gap-4">
							<div className="flex items-center gap-3.5">
								<span className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
									<Icon name="volume" className="w-5 h-5" />
								</span>
								<div>
									<p className="font-extrabold text-ink text-sm">
										Suara Pengucapan
									</p>
									<p className="text-xs text-muted mt-0.5">
										{supported
											? "Kata dibacakan otomatis saat kartu muncul"
											: "Browser ini tidak mendukung pengucapan"}
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => void toggleTts()}
								disabled={!supported}
								role="switch"
								aria-checked={ttsOn ?? true}
								aria-label="Toggle suara pengucapan"
								className={`relative w-13 h-7 rounded-full transition-colors shrink-0 disabled:opacity-40 shadow-inner ${
									(ttsOn ?? true) ? "bg-success" : "bg-edge"
								}`}
							>
								<span
									className={`absolute top-0.5 w-6 h-6 rounded-full bg-surface shadow-sm transition-all ${
										(ttsOn ?? true) ? "left-6.5" : "left-0.5"
									}`}
								/>
							</button>
						</div>
					</section>

					{/* ===== Target harian global ===== */}
					<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-2">
						<div className="flex items-center justify-between gap-4">
							<div className="flex items-center gap-3.5">
								<span className="w-10 h-10 rounded-2xl bg-accent/15 text-accent-ink flex items-center justify-center shrink-0">
									<Icon name="target" className="w-5 h-5" />
								</span>
								<div>
									<p className="font-extrabold text-ink text-sm">
										Target Harian Total
									</p>
									<p className="text-xs text-muted mt-0.5">
										Jumlah kata yang ingin kamu kuasai per hari
									</p>
								</div>
							</div>
							{gameStats && (
								<input
									type="number"
									min={1}
									max={999}
									value={goalDraft ?? gameStats.dailyGoal}
									onChange={(e) => setGoalDraft(e.target.value)}
									onBlur={(e) => void saveGoal(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											void saveGoal((e.target as HTMLInputElement).value);
										}
									}}
									className="w-20 text-center font-black text-lg bg-surface-2 border border-edge rounded-control py-2 text-ink focus:outline-none focus:border-primary shadow-2xs"
								/>
							)}
						</div>
						<p className="text-xs text-muted mt-3 font-medium">
							Target tiap tahap diatur lewat tombol − / + di kartu tahap di
							Beranda.
						</p>
					</section>

					{/* ===== Pasang Aplikasi (PWA) ===== */}
					<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-3">
						<div className="flex items-center gap-3.5 mb-3">
							<span className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-primary to-indigo-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-primary/20">
								<Icon name="sparkles" className="w-5 h-5" />
							</span>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<p className="font-extrabold text-ink text-sm">
										Pasang Aplikasi (PWA)
									</p>
									{pwa.isInstalled && (
										<span className="px-2 py-0.5 rounded-pill bg-success/15 text-success font-mono text-[10px] font-bold">
											Terpasang
										</span>
									)}
								</div>
								<p className="text-xs text-muted mt-0.5">
									{pwa.isInstalled
										? "Aplikasi sudah terpasang di layar utama perangkat ini."
										: "Buka langsung dari layar utama tanpa internet."}
								</p>
							</div>
						</div>

						{pwa.isInstalled ? (
							<div className="p-3 rounded-control bg-success/10 border border-success/20 flex items-center gap-2.5 text-xs text-success font-semibold">
								<Icon name="check-circle" className="w-4 h-4 shrink-0" />
								<span>Aplikasi aktif dalam mode mandiri (Standalone)</span>
							</div>
						) : (
							<button
								type="button"
								onClick={pwa.openModal}
								className="w-full py-3 px-4 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary-hover hover:to-indigo-700 text-white font-bold rounded-control active:scale-[0.98] transition-all text-sm shadow-md shadow-primary/20 flex items-center justify-center gap-2"
							>
								<Icon name="download" className="w-4 h-4" />
								<span>Pasang ke Layar Utama Sekarang</span>
							</button>
						)}
					</section>

					{/* ===== Info mode offline ===== */}
					<section className="rounded-card bg-accent/10 border border-accent/25 p-5 animate-fade-in-up stagger-4">
						<p className="text-xs text-accent-ink leading-relaxed font-medium">
							🔒 Progres belajarmu tersimpan aman di perangkat ini dan bisa
							dicadangkan ke cloud setiap saat. Saat berganti HP, cukup masukkan
							ID unik kamu untuk memulihkan seluruh kata dan streak!
						</p>
					</section>
				</div>

				{/* Column 2: Sinkronisasi & Data */}
				<div className="space-y-4">
					{/* ===== Deck & unduhan ===== */}
					<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-2">
						<div className="flex items-center gap-3.5 mb-3">
							<span className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
								<Icon name="download" className="w-5 h-5" />
							</span>
							<div>
								<p className="font-extrabold text-ink text-sm">
									Koleksi Kosakata
								</p>
								<p className="text-xs text-muted mt-0.5">
									{cardCount === undefined
										? "Menghitung…"
										: `${cardCount.toLocaleString("id-ID")} kata tersimpan di perangkat`}
								</p>
								{lastSyncAt && (
									<p className="text-[11px] text-muted mt-0.5 font-mono">
										Unduh terakhir:{" "}
										{new Date(lastSyncAt).toLocaleString("id-ID")}
									</p>
								)}
							</div>
						</div>
						<button
							type="button"
							onClick={() => void redownload()}
							disabled={isSyncing}
							className="w-full px-4 py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform hover:bg-primary-hover disabled:opacity-50 text-sm shadow-sm"
						>
							{isSyncing
								? `Menyiapkan… ${syncState.downloaded}${syncState.total > 0 ? `/${syncState.total}` : ""}`
								: online
									? "Unduh Ulang Semua Kata"
									: "Muat Ulang Kosakata Lokal"}
						</button>
						{!online && (
							<p className="text-xs text-muted mt-2">
								Sedang offline — tombol di atas akan memuat ulang dari seed
								bawaan aplikasi.
							</p>
						)}
					</section>

					{/* ===== Cadangkan & Pulihkan File Lokal ===== */}
					<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-3">
						<div className="flex items-center gap-3.5 mb-3">
							<span className="w-10 h-10 rounded-2xl bg-success/10 text-success flex items-center justify-center shrink-0">
								<Icon name="refresh" className="w-5 h-5" />
							</span>
							<div>
								<p className="font-extrabold text-ink text-sm">
									Ekspor & Impor File JSON
								</p>
								<p className="text-xs text-muted mt-0.5">
									Cadangan manual berupa file JSON offline ke penyimpanan
									HP/laptop.
								</p>
							</div>
						</div>
						<div className="space-y-2">
							<button
								type="button"
								onClick={() => void handleDownload()}
								className="w-full px-4 py-2.5 bg-success text-white font-bold rounded-control active:scale-[0.98] transition-transform text-xs shadow-xs hover:brightness-105"
							>
								Unduh File Cadangan JSON
							</button>
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								className="w-full px-4 py-2.5 bg-surface border border-edge text-ink font-bold rounded-control active:scale-[0.98] transition-transform text-xs hover:bg-surface-2"
							>
								Impor Dari File JSON
							</button>
						</div>
						<p className="text-[11px] text-muted mt-2 font-mono">
							{cardCount === undefined
								? "Menghitung…"
								: `Cadangan berisi ${cardCount.toLocaleString("id-ID")} kata`}
						</p>
						{exported && (
							<p className="text-xs text-success font-semibold mt-2">
								✓ Cadangan terunduh
							</p>
						)}
						{restored && (
							<p className="text-xs text-success font-semibold mt-2">
								✓ Data dipulihkan
							</p>
						)}
						{backupError && (
							<p className="text-xs text-danger font-semibold mt-2">
								{backupError}
							</p>
						)}
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
					</section>
				</div>
			</div>

			{/* ===== MODAL: PULIHKAN DATA DARI CLOUD (PINDAH DEVICE) ===== */}
			{isRestoreModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
					<div className="bg-surface rounded-2xl border border-edge max-w-sm w-full p-5 shadow-2xl space-y-4">
						<div className="flex items-center justify-between pb-2 border-b border-edge">
							<div className="flex items-center gap-2">
								<Icon name="refresh" className="w-5 h-5 text-primary" />
								<h3 className="text-sm font-black text-ink">
									Pulihkan dari Cloud
								</h3>
							</div>
							<button
								type="button"
								onClick={() => setIsRestoreModalOpen(false)}
								className="text-muted hover:text-ink p-1 rounded-lg hover:bg-surface-2"
							>
								<Icon name="x" className="w-4 h-4" />
							</button>
						</div>

						<p className="text-xs text-muted leading-relaxed">
							Masukkan ID Unik akun kamu (contoh: <code>kata-joane</code>) untuk
							mengambil seluruh kartu, streak, dan progres dari cadangan cloud:
						</p>

						<div className="space-y-2">
							<label
								htmlFor="input-restore-handle"
								className="text-[11px] font-mono font-bold text-muted uppercase block"
							>
								ID Unik Cadangan
							</label>
							<input
								id="input-restore-handle"
								type="text"
								value={restoreTargetHandle}
								onChange={(e) => setRestoreTargetHandle(e.target.value)}
								placeholder="kata-joane"
								className="w-full px-3.5 py-2.5 rounded-control font-mono text-sm font-bold bg-surface-2 border border-edge text-ink focus:outline-none focus:border-primary"
							/>
						</div>

						{restoreCloudError && (
							<div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-xs text-danger font-medium leading-relaxed">
								{restoreCloudError}
							</div>
						)}

						{restoreCloudSuccess && (
							<div className="p-3 rounded-xl bg-success/10 border border-success/20 text-xs text-success font-bold flex items-center gap-2">
								<Icon name="check-circle" className="w-4 h-4 shrink-0" />
								<span>Data berhasil dipulihkan ke perangkat ini!</span>
							</div>
						)}

						<div className="flex items-center gap-2 pt-1">
							<button
								type="button"
								onClick={() => setIsRestoreModalOpen(false)}
								className="flex-1 py-2.5 rounded-control bg-surface border border-edge text-xs font-bold text-ink hover:bg-surface-2"
							>
								Batal
							</button>
							<button
								type="button"
								onClick={() => void handleDoCloudRestore()}
								disabled={isRestoringCloud || !restoreTargetHandle.trim()}
								className="flex-1 py-2.5 rounded-control bg-primary text-white text-xs font-bold hover:bg-primary-hover disabled:opacity-50 shadow-xs"
							>
								{isRestoringCloud ? "Memulihkan…" : "Pulihkan Data"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Modal Unduh Koleksi Kartu dari Teman / ID Lain */}
			<SharedDeckImportModal
				isOpen={isImportModalOpen}
				onClose={() => setIsImportModalOpen(false)}
			/>
		</div>
	);
}
