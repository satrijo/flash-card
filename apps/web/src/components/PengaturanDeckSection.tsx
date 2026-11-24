// apps/web/src/components/PengaturanDeckSection.tsx
// Koleksi Kosakata di /pengaturan: jumlah kata, unduh terakhir, periksa
// pembaruan dari server, dan unduh ulang penuh (atau muat ulang lokal
// saat offline).
import { useEffect, useState } from "react";
import {
	checkAndUpdateDeck,
	getSyncState,
	loadBundledSeed,
	runSync,
	type SyncState,
	subscribeSync,
} from "../lib/sync";
import { Icon } from "./Icon";

export function PengaturanDeckSection({
	cardCount,
	lastSyncAt,
	online,
}: {
	cardCount: number | undefined;
	lastSyncAt: string | undefined;
	online: boolean;
}) {
	const [syncState, setSyncState] = useState<SyncState>(getSyncState());
	const [manualSyncMsg, setManualSyncMsg] = useState<{
		type: "success" | "info" | "error";
		text: string;
	} | null>(null);
	const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

	useEffect(() => {
		const unsub = subscribeSync(setSyncState);
		return () => {
			unsub();
		};
	}, []);

	const isSyncing =
		syncState.phase === "downloading" || syncState.phase === "checking";

	const redownload = async () => {
		if (online) {
			await runSync({ force: true });
		} else {
			await loadBundledSeed();
		}
	};

	const handleCheckUpdate = async () => {
		if (!online) {
			setManualSyncMsg({
				type: "error",
				text: "Perangkat sedang offline. Sambungkan ke internet untuk memeriksa pembaruan.",
			});
			setTimeout(() => setManualSyncMsg(null), 4000);
			return;
		}

		setIsCheckingUpdate(true);
		setManualSyncMsg(null);
		try {
			const result = await checkAndUpdateDeck();
			if (result.status === "up-to-date") {
				setManualSyncMsg({
					type: "info",
					text: "Semua kata sudah versi terbaru. Tidak ada kosakata baru.",
				});
			} else if (result.status === "updated") {
				setManualSyncMsg({
					type: "success",
					text: `Berhasil menyinkronkan ${result.downloaded.toLocaleString("id-ID")} kata dari server!`,
				});
			} else if (result.status === "offline") {
				setManualSyncMsg({
					type: "error",
					text: "Gagal terhubung: perangkat sedang offline.",
				});
			} else {
				setManualSyncMsg({
					type: "error",
					text: `Pemeriksaan gagal: ${result.error}`,
				});
			}
		} catch (err) {
			setManualSyncMsg({
				type: "error",
				text:
					err instanceof Error
						? err.message
						: "Terjadi kesalahan saat memeriksa pembaruan",
			});
		} finally {
			setIsCheckingUpdate(false);
			setTimeout(() => setManualSyncMsg(null), 5000);
		}
	};

	return (
		<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-2 space-y-3.5">
			<div className="flex items-center gap-3.5">
				<span className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
					<Icon name="download" className="w-5 h-5" />
				</span>
				<div>
					<p className="font-extrabold text-ink text-sm">Koleksi Kosakata</p>
					<p className="text-xs text-muted mt-0.5">
						{cardCount === undefined
							? "Menghitung…"
							: `${cardCount.toLocaleString("id-ID")} kata tersimpan di perangkat`}
					</p>
					{lastSyncAt && (
						<p className="text-[11px] text-muted mt-0.5 font-mono">
							Unduh terakhir: {new Date(lastSyncAt).toLocaleString("id-ID")}
						</p>
					)}
				</div>
			</div>

			{/* Feedback status */}
			{manualSyncMsg && (
				<div
					className={`p-3 rounded-xl text-xs font-semibold leading-relaxed flex items-center gap-2 animate-fade-in ${
						manualSyncMsg.type === "success"
							? "bg-success/10 border border-success/20 text-success"
							: manualSyncMsg.type === "info"
								? "bg-primary/10 border border-primary/20 text-primary"
								: "bg-danger/10 border border-danger/20 text-danger"
					}`}
				>
					<Icon
						name={
							manualSyncMsg.type === "success"
								? "check-circle"
								: manualSyncMsg.type === "info"
									? "sparkles"
									: "alert-circle"
						}
						className="w-4 h-4 shrink-0"
					/>
					<span>{manualSyncMsg.text}</span>
				</div>
			)}

			{/* Action Buttons: 1. Periksa Pembaruan (Primary) 2. Unduh Ulang Penuh (Secondary) */}
			<div className="space-y-2">
				<button
					type="button"
					onClick={() => void handleCheckUpdate()}
					disabled={isSyncing || isCheckingUpdate}
					className="w-full px-4 py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform hover:bg-primary-hover disabled:opacity-50 text-sm shadow-sm flex items-center justify-center gap-2 cursor-pointer"
				>
					<Icon
						name="refresh"
						className={`w-4 h-4 ${isCheckingUpdate || isSyncing ? "animate-spin" : ""}`}
					/>
					<span>
						{isCheckingUpdate || isSyncing
							? `Memeriksa… ${syncState.downloaded > 0 ? `${syncState.downloaded}/${syncState.total}` : ""}`
							: "Periksa Pembaruan Kosakata"}
					</span>
				</button>

				<button
					type="button"
					onClick={() => void redownload()}
					disabled={isSyncing || isCheckingUpdate}
					className="w-full px-4 py-2.5 bg-surface-2 border border-edge text-ink font-semibold rounded-control active:scale-[0.98] transition-transform hover:border-primary/40 disabled:opacity-50 text-xs shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer"
				>
					<Icon name="download" className="w-3.5 h-3.5 text-muted" />
					<span>
						{online
							? "Unduh Ulang Semua Kata (Paksa)"
							: "Muat Ulang Kosakata Lokal"}
					</span>
				</button>
			</div>

			<p className="text-[11px] text-muted leading-relaxed">
				💡 Kosakata tersimpan offline di perangkat. Cukup periksa pembaruan
				sesekali jika ingin mendapatkan kartu baru.
			</p>
		</section>
	);
}
