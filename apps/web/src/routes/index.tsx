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
	AUTO_UNLOCK_MASTERY,
	bandIndex,
	checkAutoUnlocks,
	getBandMeta,
	getUnlockedBands,
	previousBand,
} from "../lib/bands";
import { db } from "../lib/db";
import {
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
	masteryPct: number;
	progressPct: number;
}

interface Snapshot {
	grandTotal: number;
	grandReady: number;
	habitats: HabitatInfo[];
}

export function Home() {
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

	const level = levelFromXp(gameStats?.xp ?? 0);
	const goalProgress = gameStats
		? Math.min(gameStats.todayCount / Math.max(gameStats.dailyGoal, 1), 1)
		: 0;

	if (snap === undefined || gameStats === undefined) {
		return (
			<div className="py-8 space-y-4 animate-fade-in-up">
				<div className="skeleton h-28 w-full" />
				<div className="skeleton h-36 w-full" />
				<div className="skeleton h-36 w-full" />
			</div>
		);
	}

	const isEmpty = snap.grandTotal === 0;
	const xpToNextLevel = level.nextLevelXp - gameStats.xp;

	const filteredHabitats = snap.habitats.filter((h) => {
		if (selectedTab === "all") return true;
		return h.name === selectedTab;
	});

	return (
		<div className="py-6 space-y-6">
			{/* ===== Player HUD & Level Progress ===== */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up">
				<div className="flex items-center justify-between gap-3 mb-3">
					<div className="flex items-center gap-3">
						<div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shrink-0">
							<Icon name="sparkles" className="w-6 h-6" />
						</div>
						<div>
							<div className="flex items-center gap-2">
								<h1 className="text-xl font-extrabold text-ink tracking-tight">
									{level.rankName}
								</h1>
								<span className="px-2 py-0.5 rounded-pill bg-primary/10 text-primary font-mono text-[11px] font-bold uppercase">
									LVL {level.level}
								</span>
							</div>
							<p className="text-xs text-muted mt-0.5">
								{xpToNextLevel > 0
									? `${xpToNextLevel} XP lagi menuju Level ${level.level + 1}`
									: "Level Tertinggi"}
							</p>
						</div>
					</div>
					<span className="font-mono text-xs font-bold text-muted bg-surface-2 px-3 py-1.5 rounded-pill">
						{gameStats.xp} XP
					</span>
				</div>

				{/* Progress XP Bar */}
				<div className="w-full h-2 rounded-full bg-surface-2 overflow-hidden mb-4">
					<div
						className="h-full rounded-full bg-primary progress-fill"
						style={{ width: `${level.progressPct}%` }}
					/>
				</div>

				{/* Strip status: poin · rentetan · target hari ini */}
				<div className="grid grid-cols-3 gap-3 mb-3">
					<StatTile
						icon="star"
						value={gameStats.xp}
						label="Poin"
						tone="accent"
					/>
					<StatTile
						icon="flame"
						value={`${gameStats.streakCount} Hari`}
						label="Rentetan"
						tone="danger"
					/>
					<StatTile
						icon="target"
						value={`${gameStats.todayCount}/${gameStats.dailyGoal}`}
						label={
							gameStats.dailyGoal > 0 &&
							gameStats.todayCount >= gameStats.dailyGoal
								? "Target Tercapai ✓"
								: "Target Hari Ini"
						}
						tone="success"
					/>
				</div>

				{/* Target Harian Progress Bar */}
				<div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden">
					<div
						className="h-full rounded-full bg-success progress-fill"
						style={{ width: `${Math.round(goalProgress * 100)}%` }}
					/>
				</div>
				{gameStats.dailyGoal > 0 &&
					gameStats.todayCount >= gameStats.dailyGoal && (
						<p className="text-[11px] font-bold text-success text-center mt-2 flex items-center justify-center gap-1">
							<Icon name="sparkles" className="w-3.5 h-3.5" />
							Target harian selesai! Pertahankan rentetanmu besok.
						</p>
					)}
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
					{/* ===== CTA Utama: Lanjut Latihan ===== */}
					<section className="animate-fade-in-up stagger-1">
						{snap.grandReady > 0 ? (
							<Link
								to="/latihan"
								search={{ tahap: undefined }}
								className="block rounded-card bg-primary text-white p-5 shadow hover-lift active:scale-[0.99] transition-transform"
							>
								<div className="flex items-center justify-between gap-4">
									<div className="min-w-0">
										<p className="font-mono text-[11px] font-bold uppercase tracking-widest text-white/80 flex items-center gap-1.5">
											<Icon name="play" className="w-3.5 h-3.5" />
											Latihan Cepat
										</p>
										<p className="text-2xl font-extrabold mt-1 tracking-tight">
											{snap.grandReady} Kata Siap Dilatih
										</p>
										<p className="text-sm text-white/80 mt-1">
											{gameStats.todayCount >= gameStats.dailyGoal
												? "Target harian tercapai · Mainkan sesi bonus"
												: "Lanjutkan target harianmu hari ini"}
										</p>
									</div>
									<span className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
										<Icon name="arrow-right" className="w-6 h-6 text-white" />
									</span>
								</div>
							</Link>
						) : (
							<div className="rounded-card bg-surface border border-edge p-5 shadow-sm">
								<div className="flex items-center justify-between gap-4">
									<div className="min-w-0">
										<p className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
											Latihan Kosakata
										</p>
										<p className="text-xl font-extrabold text-ink mt-1">
											Semua Kata Aman
										</p>
										<p className="text-sm text-muted mt-1">
											{gameStats.todayCount >= gameStats.dailyGoal
												? "Target hari ini telah tercapai! Kembali lagi nanti saat kata baru matang."
												: "Tidak ada kata yang siap diulang saat ini."}
										</p>
									</div>
									<span className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center text-muted shrink-0">
										<Icon
											name="check-circle"
											className="w-6 h-6 text-success"
										/>
									</span>
								</div>
							</div>
						)}
					</section>

					{/* ===== Cari Kata Bar ===== */}
					<section className="animate-fade-in-up stagger-1">
						<button
							type="button"
							onClick={() => setSearchOpen(true)}
							className="w-full flex items-center justify-between px-4 py-3.5 rounded-card bg-surface border border-edge text-muted hover:bg-surface-2 transition-colors shadow-sm"
						>
							<div className="flex items-center gap-3">
								<Icon name="search" className="w-5 h-5 text-muted" />
								<span className="text-sm">
									Cari di {snap.grandTotal.toLocaleString("id-ID")} kosakata
									offline…
								</span>
							</div>
							<span className="hidden md:inline-block kbd-hint">Ctrl K</span>
						</button>
					</section>

					{/* ===== Daftar Tahap Belajar ===== */}
					<section className="space-y-4 animate-fade-in-up stagger-2">
						<div className="flex items-center justify-between">
							<h2 className="font-mono text-[12px] font-bold uppercase tracking-widest text-muted">
								Pilih Tahap Belajar
							</h2>
							<span className="text-xs text-muted font-medium">
								{snap.habitats.length} Tahap
							</span>
						</div>

						{/* Filter Pills */}
						<div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
							<button
								type="button"
								onClick={() => setSelectedTab("all")}
								className={`px-3 py-1.5 rounded-pill text-xs font-bold transition whitespace-nowrap ${
									selectedTab === "all"
										? "bg-primary text-white"
										: "bg-surface border border-edge text-muted hover:text-ink"
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
										className={`px-3 py-1.5 rounded-pill text-xs font-bold transition whitespace-nowrap ${
											active
												? "bg-primary text-white"
												: "bg-surface border border-edge text-muted hover:text-ink"
										}`}
									>
										{meta.title}
									</button>
								);
							})}
						</div>

						<div className="space-y-3">
							{filteredHabitats.map((h, i) => {
								const locked =
									bandIndex(h.name) > 0 && !unlockedSet.has(h.name);
								const prevName = previousBand(h.name);
								const prevMeta = prevName ? getBandMeta(prevName) : null;
								const unlockProgress = prevName
									? (snap.habitats.find((x) => x.name === prevName)
											?.masteryPct ?? 0)
									: 0;
								const unlockHint = prevMeta
									? `Buka dengan ${AUTO_UNLOCK_MASTERY}% penguasaan ${prevMeta.title} atau Uji Naik Tahap`
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
		accent: "bg-accent/15 text-accent-ink",
		danger: "bg-danger/10 text-danger",
		success: "bg-success/10 text-success",
	} as const;
	return (
		<div className={`rounded-card p-3.5 ${tones[tone]} shadow-sm`}>
			<Icon name={icon} className="w-5 h-5 mb-1" />
			<p className="text-lg font-extrabold leading-tight">{value}</p>
			<p className="text-[11px] font-semibold opacity-80 mt-0.5">{label}</p>
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
			className={`rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-${stagger}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1 space-y-1">
					<span
						className={`inline-block font-mono text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-[8px] ${meta.colorClass}`}
					>
						{meta.title}
					</span>
					<p className="text-xs text-muted font-medium">{meta.subtitle}</p>
					<p className="pt-1 text-sm text-muted">
						{habitat.readyCount > 0 ? (
							<>
								<span className="font-extrabold text-ink text-base">
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
				<div className="flex items-center justify-between text-[11px] font-semibold text-muted mb-1">
					<span>Progres Tahap</span>
					<span>
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
					<>
						<button
							type="button"
							disabled
							className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 font-bold rounded-control bg-surface-2 text-muted text-sm cursor-not-allowed"
						>
							<Icon name="lock" className="w-4 h-4" />
							Terkunci
						</button>
						<button
							type="button"
							onClick={() => onOpenKhatam(habitat.name)}
							className="px-4 py-3 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-[0.98] transition-transform text-sm shadow"
						>
							Uji Naik Tahap
						</button>
					</>
				) : (
					<Link
						to="/latihan"
						search={{ tahap: habitat.name }}
						disabled={habitat.readyCount === 0}
						className={`flex-1 text-center px-4 py-3 font-bold rounded-control transition-all text-sm ${
							habitat.readyCount > 0
								? "bg-primary text-white hover:bg-primary-hover active:scale-[0.98] shadow"
								: "bg-surface-2 text-muted pointer-events-none"
						}`}
					>
						{habitat.readyCount > 0 ? "Mulai Latihan" : "Tahap Aman"}
					</Link>
				)}

				{/* Stepper kuota harian */}
				<div className="flex items-center rounded-control border border-edge overflow-hidden bg-surface">
					<button
						type="button"
						onClick={() => void changeQuota(-1)}
						aria-label="Kurangi target harian"
						className="w-10 h-11 text-lg font-bold text-muted hover:bg-surface-2 active:bg-edge transition-colors"
					>
						−
					</button>
					<button
						type="button"
						onClick={() => void changeQuota(1)}
						aria-label="Tambah target harian"
						className="w-10 h-11 text-lg font-bold text-muted hover:bg-surface-2 active:bg-edge transition-colors"
					>
						+
					</button>
				</div>
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
