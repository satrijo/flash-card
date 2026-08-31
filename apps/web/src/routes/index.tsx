/*
 * Kata — Kosakata Harian. Home = Beranda.
 * Hub belajar gamifikasi: Level & XP progress, target harian ring,
 * CTA latihan cepat, cari kata instant, dan roadmap tahap belajar.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { KhatamOverlay } from "../components/KhatamOverlay";
import { SearchOverlay } from "../components/SearchOverlay";
import {
	bandIndex,
	checkAutoUnlocks,
	getBandMeta,
	getStageRequirement,
	getUnlockedBands,
	previousBand,
} from "../lib/bands";
import { db } from "../lib/db";
import {
	DEFAULT_DAILY_GOAL,
	DEFAULT_HABITAT_QUOTA,
	ensureGameStats,
	levelFromXp,
	setHabitatQuota,
} from "../lib/game";
import { loadBundledSeed, runSync } from "../lib/sync";

export const Route = createFileRoute("/")({
	component: Home,
});

interface HabitatInfo {
	name: string;
	total: number;
	readyCount: number;
	todayReviewed: number;
	quota: number;
	studied: number;
	mature: number;
	masteryPct: number;
	progressPct: number;
}

interface Snapshot {
	grandTotal: number;
	grandReady: number;
	habitats: HabitatInfo[];
}

function Home() {
	const gameStats = useLiveQuery(() => db.gameStats.get("user"));
	const unlocked = useLiveQuery(() => getUnlockedBands(), []);
	const unlockedSet = unlocked ?? new Set<string>(["inggris-easy"]);
	const [khatamCategory, setKhatamCategory] = useState<string | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [selectedTab, setSelectedTab] = useState<string>("all");

	useEffect(() => {
		void ensureGameStats();
	}, []);

	// Auto-unlock: cek mastery band sebelumnya tiap unlocked berubah.
	useEffect(() => {
		void checkAutoUnlocks(unlockedSet);
	}, [unlockedSet]);

	// Shortcut keyboard: Ctrl+K atau / untuk membuka pencarian
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				(e.key === "k" && (e.metaKey || e.ctrlKey)) ||
				(e.key === "/" && !(e.target instanceof HTMLInputElement))
			) {
				e.preventDefault();
				setSearchOpen(true);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	// Snapshot seluruh beranda
	const snap = useLiveQuery(async (): Promise<Snapshot> => {
		const now = new Date();
		const nowMs = now.getTime();
		const cards = await db.cards.toArray();
		const quotas = await db.habitats.toArray();
		const quotaMap = new Map(quotas.map((h) => [h.category, h.dailyQuota]));
		const unlocked = await getUnlockedBands();

		interface Acc {
			total: number;
			ready: number;
			mature: number;
			learning: number;
			todayReviewed: number;
		}
		const acc = new Map<string, Acc>();
		let grandReady = 0;

		for (const c of cards) {
			const cat = c.category || "general";
			let a = acc.get(cat);
			if (!a) {
				a = { total: 0, ready: 0, mature: 0, learning: 0, todayReviewed: 0 };
				acc.set(cat, a);
			}
			a.total++;
			const isLocked = bandIndex(cat) > 0 && !unlocked.has(cat);
			const dueMs =
				c.due instanceof Date ? c.due.getTime() : new Date(c.due).getTime();
			if (dueMs <= nowMs) {
				a.ready++;
				if (!isLocked) {
					grandReady++;
				}
			}
			if (c.state === 2 && c.stability >= 21) {
				a.mature++;
			} else if (c.state > 0 || c.last_review) {
				a.learning++;
			}
			if (c.last_review && sameLocalDay(new Date(c.last_review), now)) {
				a.todayReviewed++;
			}
		}

		const habitats: HabitatInfo[] = Array.from(acc.entries())
			.map(([name, a]) => {
				const studied = a.mature + a.learning;
				const progressPct =
					a.total > 0
						? Math.min(100, Math.round((studied / a.total) * 100 * 10) / 10)
						: 0;
				return {
					name,
					total: a.total,
					readyCount: a.ready,
					todayReviewed: a.todayReviewed,
					quota: quotaMap.get(name) ?? DEFAULT_HABITAT_QUOTA,
					studied,
					mature: a.mature,
					masteryPct: a.total > 0 ? Math.round((a.mature / a.total) * 100) : 0,
					progressPct,
				};
			})
			.sort((x, y) => {
				if (x.name === "general") return -1;
				if (y.name === "general") return 1;
				const bx = bandIndex(x.name);
				const by = bandIndex(y.name);
				if (bx !== -1 || by !== -1) {
					if (bx === -1) return 1;
					if (by === -1) return -1;
					return bx - by;
				}
				return x.name.localeCompare(y.name);
			});

		return { grandTotal: cards.length, grandReady, habitats };
	}, []);

	const defaultStats = {
		id: "user" as const,
		xp: 0,
		streakCount: 0,
		streakLastDay: null,
		todayKey: null,
		todayCount: 0,
		dailyGoal: DEFAULT_DAILY_GOAL,
	};
	const currentStats = gameStats ?? defaultStats;

	const level = levelFromXp(currentStats.xp);
	const goalProgress = Math.min(
		currentStats.todayCount / Math.max(currentStats.dailyGoal, 1),
		1,
	);

	if (snap === undefined) {
		return (
			<div className="py-8 space-y-4 animate-fade-in-up">
				<div className="skeleton h-28 w-full" />
				<div className="skeleton h-36 w-full" />
				<div className="skeleton h-36 w-full" />
			</div>
		);
	}

	const isEmpty = snap.grandTotal === 0;
	const xpToNextLevel = level.nextLevelXp - currentStats.xp;

	const filteredHabitats = snap.habitats.filter((h) => {
		if (selectedTab === "all") return true;
		return h.name === selectedTab;
	});

	return (
		<div className="py-6 space-y-6">
			{/* ===== Brand Hero Header (Desktop Only) ===== */}
			<section className="hidden md:block animate-fade-in-up">
				<div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
					<div>
						<div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-primary/10 border border-primary/20 text-primary font-mono text-[11px] font-bold uppercase tracking-wider mb-2">
							<Icon name="sparkles" className="w-3.5 h-3.5" />
							<span>Offline-First SRS App</span>
						</div>
						<h1 className="text-3xl md:text-5xl font-black text-ink tracking-tight leading-tight">
							Kuasai Kosakata Bahasa Inggris.
						</h1>
						<p className="text-xs md:text-sm text-muted font-medium mt-1.5 max-w-xl">
							Kurikulum 4 tahap bertingkat dengan algoritma FSRS untuk daya
							ingat permanen.
						</p>
					</div>
					<div className="hidden md:flex items-center gap-2 shrink-0">
						<span className="font-mono text-xs font-bold px-3.5 py-2 rounded-control bg-surface border border-edge text-ink shadow-xs">
							⚡ {snap.grandTotal.toLocaleString("id-ID")} Kata Tersimpan
						</span>
					</div>
				</div>
			</section>

			{isEmpty && (
				<section className="animate-fade-in-up rounded-card bg-surface border border-edge p-8 text-center shadow-sm max-w-sm mx-auto">
					<Icon name="book" className="w-14 h-14 text-muted mx-auto mb-4" />
					<h2 className="text-lg font-bold text-ink mb-2">
						Belum ada kosakata
					</h2>
					<p className="text-sm text-muted mb-6">
						Muat ribuan kosakata bawaan untuk langsung belajar secara offline,
						atau unduh dari server.
					</p>
					<div className="space-y-2.5">
						<button
							type="button"
							onClick={() => void loadBundledSeed()}
							className="w-full py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform shadow text-sm"
						>
							Muat Kosakata Bawaan (Offline)
						</button>
						<button
							type="button"
							onClick={() => void runSync({ force: true })}
							className="w-full py-2.5 bg-surface border border-edge text-ink font-bold rounded-control active:scale-[0.98] transition-transform text-sm"
						>
							Unduh dari Server
						</button>
					</div>
				</section>
			)}

			{!isEmpty && (
				<>
					{/* ===== Top 2-Column Bento Deck ===== */}
					<section className="grid grid-cols-1 lg:grid-cols-12 gap-4 animate-fade-in-up stagger-1">
						{/* Left (7 cols): Main Action Hero Card */}
						<div className="lg:col-span-7 flex flex-col">
							{snap.grandReady > 0 ? (
								<Link
									to="/latihan"
									search={{ tahap: undefined }}
									className="flex-1 flex flex-col justify-between rounded-card bg-gradient-to-br from-primary via-indigo-600 to-indigo-800 text-white p-6 shadow-xl shadow-primary/20 hover-lift active:scale-[0.99] transition-all relative overflow-hidden group min-h-[220px]"
								>
									{/* Ambient highlight glow */}
									<div className="absolute top-0 right-0 w-44 h-44 bg-white/10 rounded-full blur-3xl pointer-events-none" />

									<div className="relative z-10 flex items-center justify-between gap-2 mb-4">
										<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-white/20 text-white font-mono text-[10px] font-bold uppercase backdrop-blur-sm shadow-xs">
											<span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
											Sesi Siap
										</span>
										<span className="font-mono text-xs text-white/80 font-bold">
											~{Math.max(1, Math.ceil(snap.grandReady * 0.3))} Menit
										</span>
									</div>

									<div className="relative z-10 space-y-1 my-auto">
										<p className="text-3xl md:text-5xl font-black tracking-tight leading-none">
											{snap.grandReady}
										</p>
										<p className="text-base md:text-lg font-extrabold text-white/95">
											Kata Siap Dilatih Hari Ini
										</p>
										<p className="text-xs text-white/80 font-medium">
											{currentStats.todayCount >= currentStats.dailyGoal
												? "Target harian tercapai · Mainkan sesi ekstra untuk poin bonus"
												: "Lanjutkan target harianmu untuk menjaga rentetan 🔥"}
										</p>
									</div>

									<div className="relative z-10 pt-4 flex items-center justify-between">
										<span className="text-xs font-bold font-mono text-white/90">
											Mulai Sekarang →
										</span>
										<span className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center group-hover:scale-110 group-hover:bg-white/30 transition-all shadow-md">
											<Icon name="play" className="w-5 h-5 text-white ml-0.5" />
										</span>
									</div>
								</Link>
							) : (
								<div className="flex-1 flex flex-col justify-between rounded-card bg-surface border border-edge p-6 shadow-sm min-h-[220px]">
									<div className="flex items-center justify-between gap-4">
										<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill bg-success/10 text-success font-mono text-[10px] font-bold uppercase">
											<Icon name="check-circle" className="w-3.5 h-3.5" />
											Semua Selesai
										</span>
									</div>
									<div className="my-auto">
										<p className="text-2xl font-black text-ink">
											Semua Kosakata Aman
										</p>
										<p className="text-xs md:text-sm text-muted mt-1 font-medium">
											{currentStats.todayCount >= currentStats.dailyGoal
												? "Target hari ini telah selesai! Kembali lagi nanti saat kata baru masuk jadwal ulas."
												: "Tidak ada kartu yang siap diulang saat ini."}
										</p>
									</div>
									<div className="pt-2">
										<button
											type="button"
											onClick={() => setSearchOpen(true)}
											className="w-full py-2.5 rounded-control bg-surface-2 border border-edge text-ink text-xs font-bold hover:bg-surface active:scale-98 transition"
										>
											Jelajahi Kamus Kosakata
										</button>
									</div>
								</div>
							)}
						</div>

						{/* Right (5 cols): Player Gamification HUD */}
						<div className="lg:col-span-5 flex flex-col justify-between rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift relative overflow-hidden">
							<div>
								<div className="flex items-center justify-between gap-3 mb-3">
									<div className="flex items-center gap-3">
										<div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-primary to-indigo-500 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-md shadow-primary/25">
											<Icon name="sparkles" className="w-5 h-5" />
										</div>
										<div className="min-w-0">
											<div className="flex items-center gap-2">
												<h2 className="text-base font-black text-ink tracking-tight truncate">
													{level.rankName}
												</h2>
												<span className="px-2 py-0.5 rounded-pill bg-primary/10 text-primary font-mono text-[10px] font-bold uppercase shrink-0">
													LVL {level.level}
												</span>
											</div>
											<p className="text-[11px] text-muted mt-0.5 font-medium truncate">
												{xpToNextLevel > 0
													? `${xpToNextLevel} XP lagi menuju Lvl ${level.level + 1}`
													: "Level Tertinggi"}
											</p>
										</div>
									</div>
									<span className="font-mono text-xs font-bold text-ink bg-surface-2 border border-edge/60 px-2.5 py-1 rounded-pill shrink-0">
										{currentStats.xp} XP
									</span>
								</div>

								{/* Progress XP Bar */}
								<div className="w-full h-2 rounded-full bg-surface-2 overflow-hidden mb-3">
									<div
										className="h-full rounded-full bg-gradient-to-r from-primary via-indigo-500 to-accent progress-fill"
										style={{ width: `${level.progressPct}%` }}
									/>
								</div>
							</div>

							{/* Strip status: poin · rentetan · target */}
							<div className="grid grid-cols-3 gap-2 my-2">
								<StatTile
									icon="star"
									value={currentStats.xp}
									label="Poin"
									tone="accent"
								/>
								<StatTile
									icon="flame"
									value={`${currentStats.streakCount} H`}
									label="Rentetan"
									tone="danger"
								/>
								<StatTile
									icon="target"
									value={`${currentStats.todayCount}/${currentStats.dailyGoal}`}
									label={
										currentStats.dailyGoal > 0 &&
										currentStats.todayCount >= currentStats.dailyGoal
											? "Tercapai ✓"
											: "Target"
									}
									tone="success"
								/>
							</div>

							{/* Target Harian Progress Bar */}
							<div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden mt-1">
								<div
									className="h-full rounded-full bg-success progress-fill"
									style={{ width: `${Math.round(goalProgress * 100)}%` }}
								/>
							</div>
						</div>
					</section>

					{/* ===== Cari Kata & Filter Pills ===== */}
					<section className="space-y-3 animate-fade-in-up stagger-2">
						<button
							type="button"
							onClick={() => setSearchOpen(true)}
							className="w-full flex items-center justify-between px-4 py-3.5 rounded-card bg-surface border border-edge text-muted hover:border-primary/50 hover:bg-surface-2 transition-all shadow-xs group"
						>
							<div className="flex items-center gap-3">
								<Icon
									name="search"
									className="w-5 h-5 text-muted group-hover:text-primary transition-colors"
								/>
								<span className="text-sm font-medium">
									Cari di {snap.grandTotal.toLocaleString("id-ID")} kosakata
									offline…
								</span>
							</div>
							<span className="hidden md:inline-block kbd-hint">Ctrl K</span>
						</button>

						{/* Filter Pills */}
						<div className="flex items-center justify-between gap-2">
							<div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
								<button
									type="button"
									onClick={() => setSelectedTab("all")}
									className={`px-3.5 py-1.5 rounded-pill text-xs font-bold transition-all whitespace-nowrap ${
										selectedTab === "all"
											? "bg-primary text-white shadow-sm shadow-primary/20"
											: "bg-surface border border-edge text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Semua Tahap
								</button>
								{snap.habitats.map((h) => {
									const meta = getBandMeta(h.name);
									const active = selectedTab === h.name;
									return (
										<button
											key={h.name}
											type="button"
											onClick={() => setSelectedTab(h.name)}
											className={`px-3.5 py-1.5 rounded-pill text-xs font-bold transition-all whitespace-nowrap ${
												active
													? "bg-primary text-white shadow-sm shadow-primary/20"
													: "bg-surface border border-edge text-muted hover:text-ink hover:bg-surface-2"
											}`}
										>
											{meta.title}
										</button>
									);
								})}
							</div>
							<span className="hidden sm:inline font-mono text-[11px] font-bold text-muted uppercase tracking-wider shrink-0">
								{filteredHabitats.length} Tahap
							</span>
						</div>
					</section>

					{/* ===== 2-Column Responsive Stage Habitats Grid ===== */}
					<section className="animate-fade-in-up stagger-3">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{filteredHabitats.map((h, i) => {
								const locked =
									bandIndex(h.name) > 0 && !unlockedSet.has(h.name);
								const prevName = previousBand(h.name);
								const prevMeta = prevName ? getBandMeta(prevName) : null;
								const req = getStageRequirement(h.name);
								const prevHabitat = prevName
									? snap.habitats.find((x) => x.name === prevName)
									: null;
								const matureCount = prevHabitat?.mature ?? 0;
								const wordsPct = Math.min(
									100,
									Math.round((matureCount / req.matureWords) * 100),
								);
								const levelPct =
									req.minLevel > 1
										? Math.max(
												0,
												Math.min(
													100,
													Math.round(
														((level.level - 1) / (req.minLevel - 1)) * 100,
													),
												),
											)
										: 0;
								const unlockProgress = Math.max(wordsPct, levelPct);
								const unlockHint = prevMeta
									? `Buka otomatis: kuasai ${req.matureWords} kata ${prevMeta.title} (${matureCount}/${req.matureWords}), capai Level ${req.minLevel} (Lvl ${level.level}), atau Uji Naik Tahap`
									: "";
								return (
									<HabitatCard
										key={h.name}
										habitat={h}
										stagger={i + 2}
										locked={locked}
										unlockProgress={unlockProgress}
										unlockHint={unlockHint}
										onOpenKhatam={setKhatamCategory}
									/>
								);
							})}
						</div>
					</section>
				</>
			)}

			{khatamCategory && (
				<KhatamOverlay
					category={khatamCategory}
					onClose={() => setKhatamCategory(null)}
				/>
			)}

			{searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
		</div>
	);
}

function StatTile({
	icon,
	value,
	label,
	tone,
}: {
	icon: IconName;
	value: number | string;
	label: string;
	tone: "accent" | "danger" | "success";
}) {
	const tones = {
		accent: "bg-accent/15 text-accent-ink border-accent/25",
		danger: "bg-danger/10 text-danger border-danger/25",
		success: "bg-success/10 text-success border-success/25",
	} as const;
	return (
		<div
			className={`rounded-card p-3.5 border ${tones[tone]} shadow-xs flex flex-col justify-between`}
		>
			<Icon name={icon} className="w-5 h-5 mb-1.5 opacity-90" />
			<div>
				<p className="text-lg font-black leading-tight text-ink">{value}</p>
				<p className="text-[11px] font-semibold opacity-75 mt-0.5 truncate">
					{label}
				</p>
			</div>
		</div>
	);
}

function HabitatCard({
	habitat,
	stagger,
	locked,
	unlockProgress,
	unlockHint,
	onOpenKhatam,
}: {
	habitat: HabitatInfo;
	stagger: number;
	locked: boolean;
	unlockProgress: number;
	unlockHint: string;
	onOpenKhatam: (name: string) => void;
}) {
	const quotaPct =
		habitat.quota > 0 ? Math.min(1, habitat.todayReviewed / habitat.quota) : 1;
	const ringR = 22;
	const circ = 2 * Math.PI * ringR;
	const meta = getBandMeta(habitat.name);

	const changeQuota = async (delta: number) => {
		const next = Math.max(0, Math.min(999, habitat.quota + delta));
		await setHabitatQuota(habitat.name, next);
	};

	return (
		<div
			className={`rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-${stagger} transition-all`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1 space-y-1">
					<span
						className={`inline-block font-mono text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-[6px] ${meta.colorClass}`}
					>
						{meta.title}
					</span>
					<p className="text-xs text-muted font-medium">{meta.subtitle}</p>
					<p className="pt-1 text-sm text-muted font-medium">
						{habitat.readyCount > 0 ? (
							<>
								<span className="font-black text-ink text-base">
									{habitat.readyCount}
								</span>{" "}
								kata siap dilatih
							</>
						) : (
							"Semua kata dalam tahap ini aman"
						)}
					</p>
				</div>

				{/* Ring kuota harian */}
				<svg
					width="56"
					height="56"
					viewBox="0 0 56 56"
					className="-rotate-90 shrink-0"
					aria-hidden="true"
				>
					<circle
						cx="28"
						cy="28"
						r={ringR}
						fill="none"
						stroke="var(--edge)"
						strokeWidth="5"
					/>
					<circle
						cx="28"
						cy="28"
						r={ringR}
						fill="none"
						stroke="var(--success)"
						strokeWidth="5"
						strokeLinecap="round"
						strokeDasharray={circ}
						strokeDashoffset={circ * (1 - quotaPct)}
						style={{
							transition:
								"stroke-dashoffset 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
						}}
					/>
					<text
						x="28"
						y="28"
						textAnchor="middle"
						dominantBaseline="central"
						transform="rotate(90 28 28)"
						className="font-mono text-[10px] font-bold fill-[var(--ink)]"
					>
						{Math.min(habitat.todayReviewed, habitat.quota)}/{habitat.quota}
					</text>
				</svg>
			</div>

			{/* Penguasaan */}
			<div className="mt-4">
				<div className="flex items-center justify-between text-[11px] font-semibold text-muted mb-1.5">
					<span>Progres Tahap</span>
					<span className="font-mono font-bold text-ink">
						{locked
							? `${unlockProgress}%`
							: `${habitat.studied.toLocaleString("id-ID")}/${habitat.total.toLocaleString("id-ID")} kata (${habitat.progressPct}%)`}
					</span>
				</div>
				<div className="h-2 rounded-full bg-surface-2 overflow-hidden flex">
					<div
						className="h-full rounded-full bg-success transition-all duration-300"
						style={{
							width: `${locked ? unlockProgress : habitat.progressPct}%`,
							minWidth: !locked && habitat.studied > 0 ? "8px" : undefined,
						}}
					/>
				</div>
				{locked && (
					<p className="text-[11px] text-muted mt-1.5">{unlockHint}</p>
				)}
			</div>

			<div className="mt-4 flex items-center gap-2">
				{locked ? (
					<button
						type="button"
						onClick={() => onOpenKhatam(habitat.name)}
						className="w-full py-3.5 px-4 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary-hover hover:to-indigo-700 text-white font-extrabold rounded-control active:scale-[0.98] transition-all text-sm shadow-md shadow-primary/20 flex items-center justify-center gap-2"
					>
						<Icon name="sparkles" className="w-4 h-4" />
						<span>Uji Naik Tahap (Buka {meta.title})</span>
					</button>
				) : (
					<>
						<Link
							to="/latihan"
							search={{ tahap: habitat.name }}
							disabled={habitat.readyCount === 0}
							className={`flex-1 text-center px-4 py-3 font-bold rounded-control transition-all text-sm ${
								habitat.readyCount > 0
									? "bg-primary text-white hover:bg-primary-hover active:scale-[0.98] shadow"
									: "bg-surface-2 text-muted pointer-events-none opacity-80"
							}`}
						>
							{habitat.readyCount > 0 ? "Mulai Latihan" : "Tahap Aman"}
						</Link>

						{/* Stepper kuota harian */}
						<div className="flex items-center rounded-control border border-edge overflow-hidden bg-surface shadow-2xs">
							<button
								type="button"
								onClick={() => void changeQuota(-1)}
								aria-label="Kurangi target harian"
								className="w-10 h-11 text-lg font-bold text-muted hover:bg-surface-2 hover:text-ink active:bg-edge transition-colors"
							>
								−
							</button>
							<button
								type="button"
								onClick={() => void changeQuota(1)}
								aria-label="Tambah target harian"
								className="w-10 h-11 text-lg font-bold text-muted hover:bg-surface-2 hover:text-ink active:bg-edge transition-colors"
							>
								+
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function sameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}
