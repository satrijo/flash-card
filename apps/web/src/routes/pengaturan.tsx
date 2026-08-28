/*
 * Rute /pengaturan — satu-satunya tempat kontrol non-gameplay:
 * toggle suara (TTS), target harian global, info deck + unduh ulang,
 * cadangan & pemulihan progres lokal.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { downloadBackup, importBackup, isBackupFile } from "../lib/backup";
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

	useEffect(() => {
		void ensureGameStats();
		void isTtsEnabled().then(setTtsOn);
		setOnline(navigator.onLine);
		const up = () => setOnline(true);
		const down = () => setOnline(false);
		window.addEventListener("online", up);
		window.addEventListener("offline", down);
		const unsub = subscribeSync(setSyncState);
		return () => {
			window.removeEventListener("online", up);
			window.removeEventListener("offline", down);
			unsub();
		};
	}, []);

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
				<h1 className="text-2xl font-extrabold text-ink tracking-tight">
					Pengaturan
				</h1>
			</section>

			{/* ===== Suara ===== */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-1">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<span className="w-10 h-10 rounded-full bg-surface-2 text-muted flex items-center justify-center shrink-0">
							<Icon name="volume" className="w-5 h-5" />
						</span>
						<div>
							<p className="font-bold text-ink">Suara pengucapan</p>
							<p className="text-sm text-muted">
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
						className={`relative w-14 h-8 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
							(ttsOn ?? true) ? "bg-success" : "bg-edge"
						}`}
					>
						<span
							className={`absolute top-1 w-6 h-6 rounded-full bg-surface shadow-sm transition-all ${
								(ttsOn ?? true) ? "left-7" : "left-1"
							}`}
						/>
					</button>
				</div>
			</section>

			{/* ===== Target harian global ===== */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-2">
				<div className="flex items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<span className="w-10 h-10 rounded-full bg-surface-2 text-muted flex items-center justify-center shrink-0">
							<Icon name="target" className="w-5 h-5" />
						</span>
						<div>
							<p className="font-bold text-ink">Target Harian total</p>
							<p className="text-sm text-muted">
								Jumlah kata yang ingin kamu kuasai per hari (semua tahap)
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
							className="w-20 text-center font-extrabold text-lg bg-surface border border-edge rounded-control py-2 text-ink focus:outline-none focus:border-primary"
						/>
					)}
				</div>
				<p className="text-xs text-muted mt-3">
					Target tiap tahap diatur lewat tombol − / + di kartu tahap di Beranda.
				</p>
			</section>

			{/* ===== Deck & unduhan ===== */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-3">
				<div className="flex items-center gap-3 mb-3">
					<span className="w-10 h-10 rounded-full bg-surface-2 text-muted flex items-center justify-center shrink-0">
						<Icon name="download" className="w-5 h-5" />
					</span>
					<div>
						<p className="font-bold text-ink">Koleksi kata</p>
						<p className="text-sm text-muted">
							{cardCount === undefined
								? "Menghitung…"
								: `${cardCount} kata tersimpan di perangkat ini`}
						</p>
						{lastSyncAt && (
							<p className="text-xs text-muted mt-0.5">
								Unduh terakhir: {new Date(lastSyncAt).toLocaleString("id-ID")}
							</p>
						)}
					</div>
				</div>
				<button
					type="button"
					onClick={() => void redownload()}
					disabled={isSyncing}
					className="w-full px-4 py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform hover:bg-primary-hover disabled:opacity-50"
				>
					{isSyncing
						? `Menyiapkan… ${syncState.downloaded}${syncState.total > 0 ? `/${syncState.total}` : ""}`
						: online
							? "Unduh ulang semua kata"
							: "Muat ulang kosakata lokal"}
				</button>
				{!online && (
					<p className="text-xs text-muted mt-2">
						Sedang offline — tombol di atas akan memuat ulang dari seed bawaan
						aplikasi.
					</p>
				)}
			</section>

			{/* ===== Cadangkan & Pulihkan ===== */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-4">
				<div className="flex items-center gap-3 mb-3">
					<span className="w-10 h-10 rounded-full bg-surface-2 text-muted flex items-center justify-center shrink-0">
						<Icon name="refresh" className="w-5 h-5" />
					</span>
					<div>
						<p className="font-bold text-ink">Cadangkan & Pulihkan</p>
						<p className="text-sm text-muted">
							Progres tersimpan hanya di perangkat ini — unduh cadangan untuk
							amankan.
						</p>
					</div>
				</div>
				<div className="space-y-2">
					<button
						type="button"
						onClick={() => void handleDownload()}
						className="w-full px-4 py-3 bg-success text-white font-bold rounded-control active:scale-[0.98] transition-transform"
					>
						Unduh cadangan
					</button>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						className="w-full px-4 py-3 bg-surface border border-edge text-ink font-bold rounded-control"
					>
						Pulihkan dari file
					</button>
				</div>
				<p className="text-xs text-muted mt-3">
					{cardCount === undefined
						? "Menghitung…"
						: `Cadangan berisi ${cardCount} kata`}
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

			{/* ===== Info mode offline ===== */}
			<section className="rounded-card bg-accent/10 border border-accent/30 p-5 animate-fade-in-up stagger-5">
				<p className="text-sm text-accent-ink leading-relaxed">
					Progres belajarmu tersimpan aman di perangkat ini saja — tanpa akun,
					tanpa dikirim ke mana pun. Boleh dipakai sepenuhnya offline; internet
					hanya perlu sesekali untuk mengambil kata baru.
				</p>
			</section>
		</div>
	);
}
