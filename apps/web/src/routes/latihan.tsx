/*
 * Rute /latihan — sesi latihan kosakata SRS.
 * validateSearch: ?tahap=<kategori> (opsional; kosong = Semua Tahap).
 * Antrean: seeded daily shuffle per tahap (lib/session), Again → re-queue.
 * Ringkasan akhir: poin, rentetan, target, breakdown rating.
 */

import { Rating } from "@flashcard/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { EkspedisiCard } from "../components/EkspedisiCard";
import { Icon, type IconName } from "../components/Icon";
import {
	bandIndex,
	getBandMeta,
	getUnlockedBands,
	parseBackContent,
} from "../lib/bands";
import { db, type LocalCard } from "../lib/db";
import { ensureGameStats, levelFromXp } from "../lib/game";
import { buildEkspedisiQueue, requeueAgain, sessionCap } from "../lib/session";
import { isTtsEnabled, setTtsEnabled, speak } from "../lib/tts";

function validateSearch(search: Record<string, unknown>) {
	return {
		tahap:
			typeof search.tahap === "string" && search.tahap.length > 0
				? search.tahap
				: undefined,
	};
}

export const Route = createFileRoute("/latihan")({
	validateSearch,
	component: LatihanPage,
});

export function LatihanPage() {
	const { tahap } = Route.useSearch();

	const [queue, setQueue] = useState<LocalCard[]>([]);
	const [cursor, setCursor] = useState(0);
	const [missedCards, setMissedCards] = useState<LocalCard[]>([]);
	const [sessionCoins, setSessionCoins] = useState(0);
	const [sessionCount, setSessionCount] = useState(0);
	const [sessionNonce, setSessionNonce] = useState(0);
	const [sessionCapped, setSessionCapped] = useState(false);
	const [ttsEnabled, setTtsEnabledState] = useState(true);
	const [loading, setLoading] = useState(true);
	const [initialLevel, setInitialLevel] = useState<number | null>(null);
	const [ratingCounts, setRatingCounts] = useState({
		again: 0,
		hard: 0,
		good: 0,
		easy: 0,
	});

	useEffect(() => {
		void ensureGameStats().then((gs) => {
			if (initialLevel === null) {
				setInitialLevel(levelFromXp(gs.xp).level);
			}
		});
		void isTtsEnabled().then(setTtsEnabledState);
	}, [initialLevel]);

	// Bangun antrean sekali per masuk halaman (seeded shuffle harian).
	useEffect(() => {
		void sessionNonce;
		let cancelled = false;
		setLoading(true);
		setCursor(0);
		setMissedCards([]);
		setSessionCoins(0);
		setSessionCount(0);
		setSessionCapped(false);
		setRatingCounts({ again: 0, hard: 0, good: 0, easy: 0 });

		void buildEkspedisiQueue(tahap).then((built) => {
			if (cancelled) return;
			setQueue(built);
			setLoading(false);
		});

		void sessionCap(tahap).then(({ quota, remaining }) => {
			if (cancelled) return;
			setSessionCapped(quota > 0 && remaining >= 0);
		});

		return () => {
			cancelled = true;
		};
	}, [tahap, sessionNonce]);

	const gameStats = useLiveQuery(() => db.gameStats.get("user"));
	const unlocked = useLiveQuery(() => getUnlockedBands(), []);

	const toggleTts = async () => {
		const next = !ttsEnabled;
		setTtsEnabledState(next);
		await setTtsEnabled(next);
	};

	// ===== Gate: tahap terkunci =====
	if (unlocked === undefined) {
		return null;
	}
	if (tahap && bandIndex(tahap) > 0 && !unlocked.has(tahap)) {
		return (
			<div className="py-12 text-center animate-fade-in-up">
				<Icon name="lock" className="w-14 h-14 text-muted mx-auto mb-6" />
				<h1 className="text-2xl font-extrabold text-ink mb-2">
					Tahap masih terkunci
				</h1>
				<p className="text-muted max-w-sm mx-auto mb-8">
					Selesaikan tahap sebelumnya atau lakukan Uji Naik Tahap dari Beranda.
				</p>
				<Link
					to="/"
					className="inline-flex px-6 py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform"
				>
					Kembali ke Beranda
				</Link>
			</div>
		);
	}

	// ===== Loading skeleton =====
	if (loading) {
		return (
			<div className="py-10 space-y-4 animate-fade-in-up">
				<div className="skeleton h-4 w-28 mb-4" />
				<div className="skeleton h-2 w-full rounded-full mb-6" />
				<div className="skeleton h-[380px] w-full rounded-card" />
			</div>
		);
	}

	// ===== Kosong =====
	if (queue.length === 0) {
		const meta = tahap ? getBandMeta(tahap) : null;
		return (
			<div className="py-12 text-center animate-fade-in-up">
				<div className="w-16 h-16 rounded-full bg-surface-2 text-muted flex items-center justify-center mx-auto mb-6">
					<Icon name="layers" className="w-8 h-8" />
				</div>
				<h1 className="text-2xl font-extrabold text-ink mb-2">
					{meta ? `Tahap ${meta.title} Selesai` : "Semua Tahap Aman"}
				</h1>
				<p className="text-muted max-w-sm mx-auto mb-8 text-sm leading-relaxed">
					Tidak ada kata yang siap dilatih saat ini. Kata-kata yang telah
					dipelajari akan dijadwalkan kembali secara otomatis sesuai ingatanmu.
				</p>
				<Link
					to="/"
					className="inline-flex px-6 py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform shadow"
				>
					Kembali ke Beranda
				</Link>
			</div>
		);
	}

	// ===== Ringkasan sesi =====
	if (cursor >= queue.length) {
		const level = levelFromXp(gameStats?.xp ?? 0);
		const goalProgress = gameStats
			? Math.min(gameStats.todayCount / Math.max(gameStats.dailyGoal, 1), 1)
			: 0;
		const ringR = 26;
		const circ = 2 * Math.PI * ringR;
		const uniqueLearned = new Set(queue.map((c) => c.id)).size;
		const didLevelUp = initialLevel !== null && level.level > initialLevel;
		const isGoalMet =
			gameStats &&
			gameStats.dailyGoal > 0 &&
			gameStats.todayCount >= gameStats.dailyGoal;

		return (
			<div className="py-8 animate-masked-reveal">
				<div className="text-center mb-6">
					<div className="w-16 h-16 rounded-full bg-accent/15 text-accent-ink flex items-center justify-center mx-auto mb-4 animate-soft-pulse">
						<Icon name="trophy" className="w-8 h-8" />
					</div>
					<h1 className="text-3xl font-extrabold text-ink mb-2 tracking-tight">
						Latihan Selesai!
					</h1>
					<p className="text-muted text-sm">
						Kamu telah melatih{" "}
						<strong className="text-ink">{uniqueLearned} kata</strong>
						{sessionCount > uniqueLearned ? ` (${sessionCount} ulasan)` : ""}
						{tahap ? ` di tahap ${getBandMeta(tahap).title}` : ""}.
					</p>

					{didLevelUp && (
						<div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-pill bg-primary/15 text-primary font-bold text-sm animate-coin-pop">
							<Icon name="arrow-up" className="w-4 h-4" />
							Selamat! Naik ke Level {level.level} ({level.rankName})
						</div>
					)}
				</div>

				{/* Perayaan Capaian Target Harian */}
				{isGoalMet && (
					<div className="mb-6 p-4 rounded-card bg-success/15 border border-success/30 flex items-center gap-3 text-success animate-fade-in-up">
						<Icon name="sparkles" className="w-6 h-6 shrink-0" />
						<div className="min-w-0">
							<p className="font-extrabold text-sm text-ink">
								Target Harian Tercapai!
							</p>
							<p className="text-xs text-muted mt-0.5">
								Kamu telah menyelesaikan target {gameStats.dailyGoal} kata hari
								ini. Rentetan 🔥 aman!
							</p>
						</div>
					</div>
				)}

				<div className="grid grid-cols-3 gap-3 mb-6">
					<SummaryTile
						icon="star"
						value={`+${sessionCoins}`}
						label="Poin Didapat"
						tone="accent"
					/>
					<SummaryTile
						icon="flame"
						value={`${gameStats?.streakCount ?? 0} Hari`}
						label="Rentetan"
						tone="danger"
					/>
					<div className="rounded-card border border-edge bg-surface p-4 flex flex-col items-center justify-center gap-1 text-center shadow-sm">
						<svg
							width="56"
							height="56"
							viewBox="0 0 64 64"
							className="-rotate-90"
							aria-hidden="true"
						>
							<circle
								cx="32"
								cy="32"
								r={ringR}
								fill="none"
								stroke="var(--edge)"
								strokeWidth="6"
							/>
							<circle
								cx="32"
								cy="32"
								r={ringR}
								fill="none"
								stroke="var(--success)"
								strokeWidth="6"
								strokeLinecap="round"
								strokeDasharray={circ}
								strokeDashoffset={circ * (1 - goalProgress)}
							/>
							<text
								x="32"
								y="32"
								textAnchor="middle"
								dominantBaseline="central"
								transform="rotate(90 32 32)"
								className="font-mono text-[10px] font-bold fill-[var(--ink)]"
							>
								{gameStats
									? `${gameStats.todayCount}/${gameStats.dailyGoal}`
									: ""}
							</text>
						</svg>
						<p className="text-[11px] font-semibold text-muted">
							Target Hari Ini
						</p>
					</div>
				</div>

				{/* Breakdown Jawaban */}
				<div className="rounded-card bg-surface border border-edge p-4 mb-6 shadow-sm">
					<p className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted mb-3">
						Rincian Jawaban
					</p>
					<div className="grid grid-cols-4 gap-2 text-center text-xs font-bold">
						<div className="p-2 rounded-control bg-[var(--rating-again-bg)] text-[var(--rating-again-text)]">
							<span className="block text-base">{ratingCounts.again}</span>
							<span>Ulang</span>
						</div>
						<div className="p-2 rounded-control bg-[var(--rating-hard-bg)] text-[var(--rating-hard-text)]">
							<span className="block text-base">{ratingCounts.hard}</span>
							<span>Susah</span>
						</div>
						<div className="p-2 rounded-control bg-[var(--rating-good-bg)] text-[var(--rating-good-text)]">
							<span className="block text-base">{ratingCounts.good}</span>
							<span>Oke</span>
						</div>
						<div className="p-2 rounded-control bg-[var(--rating-easy-bg)] text-[var(--rating-easy-text)]">
							<span className="block text-base">{ratingCounts.easy}</span>
							<span>Gampang</span>
						</div>
					</div>
				</div>

				{/* Ulas Kata yang Tadi Sempat Lupa */}
				{missedCards.length > 0 && (
					<div className="rounded-card bg-surface border border-edge p-4 mb-6 shadow-sm space-y-3">
						<div className="flex items-center justify-between">
							<p className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
								<Icon name="target" className="w-3.5 h-3.5 text-warning" />
								Perlu Dilatih Lagi ({missedCards.length} kata)
							</p>
						</div>
						<div className="space-y-2">
							{missedCards.map((c) => {
								const parsed = parseBackContent(c.back);
								return (
									<div
										key={c.id}
										className="p-3 rounded-control bg-surface-2/40 border border-edge/60 flex items-center justify-between gap-3"
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<button
													type="button"
													onClick={() => void speak(c.front, "en-US")}
													className="font-bold text-ink text-sm hover:text-primary transition flex items-center gap-1.5"
												>
													{c.front}
													<Icon
														name="volume"
														className="w-3.5 h-3.5 text-muted"
													/>
												</button>
												{parsed.pos && (
													<span className="font-mono text-[10px] font-bold italic px-1.5 py-0.5 rounded bg-surface text-muted">
														{parsed.pos}
													</span>
												)}
											</div>
											<p className="text-xs text-muted mt-0.5 truncate">
												{parsed.gloss}
											</p>
										</div>
									</div>
								);
							})}
						</div>
						<button
							type="button"
							onClick={() => {
								setQueue([...missedCards]);
								setCursor(0);
								setMissedCards([]);
								setSessionCoins(0);
								setSessionCount(0);
								setRatingCounts({ again: 0, hard: 0, good: 0, easy: 0 });
							}}
							className="w-full py-3 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-[0.98] transition shadow text-sm"
						>
							Latih {missedCards.length} Kata Sulit Ini Saja
						</button>
					</div>
				)}

				<div className="flex items-center justify-center gap-3">
					<button
						type="button"
						onClick={() => {
							setCursor(0);
							setMissedCards([]);
							setSessionCoins(0);
							setSessionCount(0);
							setSessionNonce((n) => n + 1);
						}}
						className="flex-1 py-3.5 border border-edge bg-surface text-ink font-bold rounded-control hover:bg-surface-2 active:scale-[0.98] transition"
					>
						Ulangi Sesi
					</button>
					<Link
						to="/"
						className="flex-1 text-center py-3.5 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-[0.98] transition shadow"
					>
						Kembali ke Beranda
					</Link>
				</div>
			</div>
		);
	}

	// ===== Sesi berjalan =====
	const currentCard = queue[cursor];
	const totalCards = queue.length;
	const progressPercent =
		totalCards > 0 ? Math.min(100, Math.round((cursor / totalCards) * 100)) : 0;
	const stageMeta = tahap ? getBandMeta(tahap) : null;

	return (
		<div className="py-6">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<Link
					to="/"
					className="font-mono text-[12px] font-bold text-muted hover:text-ink transition-colors uppercase tracking-wide inline-flex items-center gap-1"
				>
					<Icon name="chevron-left" className="w-4 h-4" />
					Beranda
				</Link>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => void toggleTts()}
						aria-label={ttsEnabled ? "Matikan suara" : "Nyalakan suara"}
						title={ttsEnabled ? "Suara Aktif" : "Suara Mati"}
						className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
							ttsEnabled
								? "bg-primary/10 text-primary"
								: "bg-surface-2 text-muted opacity-60"
						}`}
					>
						<Icon name="volume" className="w-4 h-4" />
					</button>
					{stageMeta && (
						<span
							className={`font-mono text-[11px] font-bold uppercase px-2.5 py-1 rounded-[8px] ${stageMeta.colorClass}`}
						>
							{stageMeta.title}
						</span>
					)}
					<span className="font-mono text-[11px] font-bold text-muted bg-surface border border-edge px-3 py-1 rounded-pill">
						{cursor}/{totalCards}
					</span>
				</div>
			</div>

			{/* Progress bar */}
			<div className="w-full h-2 bg-surface-2 rounded-full mb-6 overflow-hidden">
				<div
					className="h-full bg-primary rounded-full progress-fill"
					style={{ width: `${progressPercent}%` }}
				/>
			</div>

			{sessionCapped && queue.length > 0 && (
				<p className="text-[11px] text-muted text-center mb-3">
					Sesi ini disesuaikan dengan target harianmu — lanjut kapan saja.
				</p>
			)}

			<EkspedisiCard
				key={`${currentCard.id}-${cursor}`}
				card={currentCard}
				ttsEnabled={ttsEnabled}
				onReviewComplete={(result) => {
					if (result.rating === Rating.Again) {
						requeueAgain(queue, cursor, currentCard);
						setMissedCards((prev) => {
							if (prev.some((c) => c.id === currentCard.id)) return prev;
							return [...prev, currentCard];
						});
						setRatingCounts((prev) => ({ ...prev, again: prev.again + 1 }));
					} else if (result.rating === Rating.Hard) {
						setRatingCounts((prev) => ({ ...prev, hard: prev.hard + 1 }));
					} else if (result.rating === Rating.Good) {
						setRatingCounts((prev) => ({ ...prev, good: prev.good + 1 }));
					} else if (result.rating === Rating.Easy) {
						setRatingCounts((prev) => ({ ...prev, easy: prev.easy + 1 }));
					}
					setQueue([...queue]);
					setSessionCoins((c) => c + result.xpGained);
					setSessionCount((n) => n + 1);
					setCursor((i) => i + 1);
				}}
			/>

			<div className="flex items-center justify-between text-[11px] text-muted mt-6 font-medium px-1">
				<span>Tekan Spasi untuk membalik kartu</span>
				<span className="hidden md:inline">
					Gunakan tombol 1–4 untuk menilai
				</span>
			</div>
		</div>
	);
}

function SummaryTile({
	icon,
	value,
	label,
	tone,
}: {
	icon: IconName;
	value: string | number;
	label: string;
	tone: "accent" | "danger";
}) {
	const tones = {
		accent: "bg-accent/15 text-accent-ink",
		danger: "bg-danger/10 text-danger",
	} as const;
	return (
		<div
			className={`rounded-card p-4 text-center ${tones[tone]} flex flex-col items-center justify-center shadow-sm`}
		>
			<Icon name={icon} className="w-6 h-6 mb-1" />
			<p className="text-lg font-extrabold leading-tight">{value}</p>
			<p className="text-[11px] font-semibold opacity-80 mt-0.5">{label}</p>
		</div>
	);
}
