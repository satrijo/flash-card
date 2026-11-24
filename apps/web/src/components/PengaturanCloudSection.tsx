// apps/web/src/components/PengaturanCloudSection.tsx
// ID Pengguna & Cadangan Cloud: editor handle unik (kata-<nama>), status
// sinkronisasi, tombol sinkron / unduh teman / pindah device, dan modal
// pulihkan data dari cloud. Pemilik seluruh state cloud di /pengaturan.
import { isReservedHandle, normalizeUserHandle } from "@flashcard/shared";
import { useEffect, useState } from "react";
import { syncCloudNow, useCloudSyncState } from "../hooks/useCloudSync";
import { trackEvent } from "../lib/analytics";
import { restoreCloudBackup } from "../lib/cloud/download";
import {
	checkHandleAvailability,
	claimUserHandle,
	getCurrentUserHandle,
} from "../lib/cloud/handle";
import {
	getCloudBackupStatus,
	getLastCloudBackupTime,
} from "../lib/cloud/status";
import { Icon } from "./Icon";

export function PengaturanCloudSection({
	online,
	onCloudError,
	onOpenImportModal,
}: {
	online: boolean;
	onCloudError: (msg: string | null) => void;
	onOpenImportModal: () => void;
}) {
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
	const cloudSync = useCloudSyncState();
	const [isManualSyncingCloud, setIsManualSyncingCloud] = useState(false);
	const [lastCloudBackup, setLastCloudBackup] = useState<number | null>(null);

	// Restore from Cloud Modal
	const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
	const [restoreTargetHandle, setRestoreTargetHandle] = useState("");
	const [isRestoringCloud, setIsRestoringCloud] = useState(false);
	const [restoreCloudError, setRestoreCloudError] = useState<string | null>(
		null,
	);
	const [restoreCloudSuccess, setRestoreCloudSuccess] = useState(false);

	useEffect(() => {
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

		const onUsernameChanged = (e: Event) => {
			const customEvent = e as CustomEvent<string>;
			if (customEvent.detail) {
				setUserHandle(customEvent.detail);
				setHandleDraft(customEvent.detail);
			}
		};
		window.addEventListener("kata-username-changed", onUsernameChanged);

		return () => {
			window.removeEventListener("kata-username-changed", onUsernameChanged);
		};
	}, []);

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

	const handleManualCloudSync = async () => {
		if (!online) {
			onCloudError(
				"Perangkat sedang offline. Sambungkan ke internet untuk menyinkronkan.",
			);
			setTimeout(() => onCloudError(null), 4000);
			return;
		}
		setIsManualSyncingCloud(true);
		onCloudError(null);
		try {
			await syncCloudNow();
			const cached = getLastCloudBackupTime();
			if (cached) setLastCloudBackup(cached);
		} finally {
			setIsManualSyncingCloud(false);
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

	const effectiveLastSync = cloudSync.lastSyncAt ?? lastCloudBackup;

	return (
		<>
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
								{cloudSync.phase === "pulling" && (
									<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-mono font-bold animate-pulse border border-blue-500/30">
										<Icon name="refresh" className="w-3 h-3 animate-spin" />
										Menarik dari Cloud…
									</span>
								)}
								{cloudSync.phase === "pushing" && (
									<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-mono font-bold animate-pulse border border-amber-500/30">
										<Icon name="sparkles" className="w-3 h-3 animate-spin" />
										Menyimpan ke Cloud…
									</span>
								)}
								{cloudSync.phase === "synced" && (
									<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-success/15 text-success text-[10px] font-mono font-bold border border-success/30">
										<Icon name="check" className="w-3 h-3" />
										Tersinkron Real-time
									</span>
								)}
								{cloudSync.phase === "error" && (
									<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-danger/15 text-danger text-[10px] font-mono font-bold border border-danger/30">
										<Icon name="alert-circle" className="w-3 h-3" />
										Gagal Sinkron
									</span>
								)}
								{cloudSync.phase === "idle" && (
									<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-primary/15 text-primary text-[10px] font-mono font-bold border border-primary/25">
										<span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
										Sinkron 2 Arah Aktif
									</span>
								)}
							</div>
							<p className="text-xs text-muted mt-0.5">
								ID unik kamu dipakai di Komunitas dan untuk sinkronisasi
								otomatis antarperangkat secara instan.
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

					{/* Action Buttons: Sinkronkan Sekarang, Unduh Teman, & Pulihkan */}
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
						<button
							type="button"
							onClick={() => void handleManualCloudSync()}
							disabled={
								isManualSyncingCloud ||
								cloudSync.phase === "pulling" ||
								cloudSync.phase === "pushing"
							}
							className="py-3 px-3 rounded-control bg-primary text-white font-bold text-xs hover:bg-primary-hover shadow-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform disabled:opacity-75 cursor-pointer"
						>
							<Icon
								name={
									isManualSyncingCloud ||
									cloudSync.phase === "pulling" ||
									cloudSync.phase === "pushing"
										? "refresh"
										: "sparkles"
								}
								className={`w-4 h-4 ${
									isManualSyncingCloud ||
									cloudSync.phase === "pulling" ||
									cloudSync.phase === "pushing"
										? "animate-spin"
										: ""
								}`}
							/>
							<span>
								{cloudSync.phase === "pulling"
									? "Menarik Data…"
									: cloudSync.phase === "pushing"
										? "Menyimpan…"
										: isManualSyncingCloud
											? "Menyinkronkan…"
											: "Sinkronkan Sekarang"}
							</span>
						</button>

						<button
							type="button"
							onClick={() => onOpenImportModal()}
							className="py-3 px-3 rounded-control bg-surface border border-edge text-ink font-bold text-xs hover:bg-surface-2 hover:border-primary/40 shadow-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform cursor-pointer"
						>
							<Icon name="download" className="w-4 h-4 text-primary" />
							<span>Unduh Kartu Teman</span>
						</button>

						<button
							type="button"
							onClick={() => setIsRestoreModalOpen(true)}
							className="py-3 px-3 rounded-control bg-surface border border-edge text-ink font-bold text-xs hover:bg-surface-2 hover:border-primary/40 shadow-xs flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform cursor-pointer"
						>
							<Icon name="refresh" className="w-4 h-4 text-primary" />
							<span>Pindah Device</span>
						</button>
					</div>

					{/* Metadata Info */}
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-muted font-mono pt-1 px-1">
						<div className="flex items-center gap-2">
							<span
								className={`w-2 h-2 rounded-full shrink-0 ${
									cloudSync.phase === "error"
										? "bg-danger"
										: cloudSync.phase === "pulling" ||
												cloudSync.phase === "pushing"
											? "bg-amber-500 animate-pulse"
											: "bg-success"
								}`}
							/>
							<span>
								Status:{" "}
								{cloudSync.phase === "pulling"
									? "Memeriksa dan menarik data terbaru…"
									: cloudSync.phase === "pushing"
										? "Mengunggah pembaruan lokal ke cloud…"
										: effectiveLastSync
											? `Terakhir disinkronkan ${new Date(
													effectiveLastSync,
												).toLocaleString("id-ID")}`
											: "Belum pernah disinkronkan"}
							</span>
						</div>
						{cloudSync.phase === "error" && cloudSync.error && (
							<span className="text-danger font-semibold">
								✗ {cloudSync.error}
							</span>
						)}
						{cloudSync.phase === "synced" && (
							<span className="text-success font-bold">
								✓ Berhasil disinkronkan!
							</span>
						)}
					</div>
				</div>
			</section>
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
		</>
	);
}
