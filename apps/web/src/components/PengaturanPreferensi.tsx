// apps/web/src/components/PengaturanPreferensi.tsx
// Preferensi belajar di /pengaturan: tema tampilan, suara pengucapan,
// target harian, pasang aplikasi (PWA), dan info mode offline.
import { useEffect, useState } from "react";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { useTheme } from "../hooks/useTheme";
import { db, type GameStats } from "../lib/db";
import { DEFAULT_DAILY_GOAL, ensureGameStats } from "../lib/game";
import { isTtsEnabled, setTtsEnabled, ttsSupported } from "../lib/tts";
import { Icon } from "./Icon";

export function PengaturanPreferensi({
	gameStats,
}: {
	gameStats: GameStats | undefined;
}) {
	const pwa = usePwaInstall();
	const { theme, resolvedTheme, setTheme } = useTheme();
	const [ttsOn, setTtsOn] = useState<boolean | null>(null);
	const [goalDraft, setGoalDraft] = useState<string | null>(null);

	useEffect(() => {
		void ensureGameStats();
		void isTtsEnabled().then(setTtsOn);
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

	return (
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
					Target tiap tahap diatur lewat tombol − / + di kartu tahap di Beranda.
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
					dicadangkan ke cloud setiap saat. Saat berganti HP, cukup masukkan ID
					unik kamu untuk memulihkan seluruh kata dan streak!
				</p>
			</section>
		</div>
	);
}
