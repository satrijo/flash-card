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
import { trackEvent } from "../lib/analytics";
import {
	bandIndex,
	getBandMeta,
	getUnlockedBands,
	parseBackContent,
} from "../lib/bands";
import { db, type LocalCard, type PracticeCardLog } from "../lib/db";
import { ensureGameStats, levelFromXp } from "../lib/game";
import { savePracticeSession } from "../lib/history";
import { buildEkspedisiQueue, requeueAgain } from "../lib/session";
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

function LatihanPage() {
	const { tahap } = Route.useSearch();

	const [queue, setQueue] = useState<LocalCard[]>([]);
	const [cursor, setCursor] = useState(0);
	const [missedCards, setMissedCards] = useState<LocalCard[]>([]);
	const [sessionCoins, setSessionCoins] = useState(0);
	const [sessionCount, setSessionCount] = useState(0);
	const [sessionNonce, setSessionNonce] = useState(0);
	const [ttsEnabled, setTtsEnabledState] = useState(true);
	const [loading, setLoading] = useState(true);
	const [initialLevel, setInitialLevel] = useState<number | null>(null);
	const [reviewedLogs, setReviewedLogs] = useState<PracticeCardLog[]>([]);
	const [historySaved, setHistorySaved] = useState(false);
	const [wordsListFilter, setWordsListFilter] = useState<
		"all" | "again" | "success"
	>("all");
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
		setReviewedLogs([]);
		setHistorySaved(false);
		setSessionCoins(0);
		setSessionCount(0);
		setRatingCounts({ again: 0, hard: 0, good: 0, easy: 0 });

		void buildEkspedisiQueue(tahap).then((built) => {
			if (cancelled) return;
			setQueue(built);
			setLoading(false);
		});

		return () => {
			cancelled = true;
		};
	}, [tahap, sessionNonce]);

	useEffect(() => {
		if (queue.length > 0 && cursor >= queue.length) {
			trackEvent("session_completed", {
				stage: tahap || "all",
				words_count: sessionCount,
				xp_gained: sessionCoins,
			});

			if (!historySaved && reviewedLogs.length > 0) {
				setHistorySaved(true);
				void savePracticeSession({
					timestamp: Date.now(),
					tahap,
					wordsCount: new Set(reviewedLogs.map((c) => c.id)).size,
					reviewCount: sessionCount,
					xpGained: sessionCoins,
					ratings: ratingCounts,
					cards: reviewedLogs,
				});
			}
		}
	}, [
		cursor,
		queue.length,
		tahap,
		sessionCount,
		sessionCoins,
		historySaved,
		reviewedLogs,
		ratingCounts,
	]);

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
			<div className="flex-1 overflow-y-auto scrollbar-none py-4 md:py-6 animate-masked-reveal max-w-xl mx-auto w-full">
				<div className="text-center mb-6">
					<div className="w-18 h-18 rounded-3xl bg-gradient-to-tr from-amber-400 via-amber-500 to-amber-600 text-amber-950 flex items-center justify-center mx-auto mb-4 animate-soft-pulse shadow-lg shadow-amber-500/30">
						<Icon name="trophy" className="w-9 h-9 fill-amber-950" />
					</div>
					<h1 className="text-3xl font-black text-ink mb-2 tracking-tight">
						Latihan Selesai!
					</h1>
					<p className="text-muted text-sm font-medium">
						Kamu telah melatih{" "}
						<strong className="text-ink">{uniqueLearned} kata</strong>
						{sessionCount > uniqueLearned ? ` (${sessionCount} ulasan)` : ""}
						{tahap ? ` di tahap ${getBandMeta(tahap).title}` : ""}.
					</p>

					{didLevelUp && (
						<div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-pill bg-gradient-to-r from-primary to-indigo-600 text-white font-bold text-sm animate-coin-pop shadow-md shadow-primary/25">
							<Icon name="arrow-up" className="w-4 h-4" />
							Selamat! Naik ke Level {level.level} ({level.rankName})
						</div>
					)}
				</div>

				{/* Perayaan Capaian Target Harian */}
				{isGoalMet && (
					<div className="mb-6 p-4.5 rounded-card bg-success/15 border border-success/30 flex items-center gap-3 text-success animate-fade-in-up shadow-xs">
						<Icon name="sparkles" className="w-6 h-6 shrink-0" />
						<div className="min-w-0">
							<p className="font-black text-sm text-ink">
								Target Harian Tercapai!
							</p>
							<p className="text-xs text-muted mt-0.5">
								Kamu telah menyelesaikan target {gameStats.dailyGoal} kata hari
								ini. Rentetan 🔥 aman!
							</p>
						</div>
					</div>
				)}

				<div className="grid grid-cols-3 gap-2.5 mb-6">
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
					<div className="rounded-card border border-success/25 bg-success/10 p-3.5 flex flex-col items-center justify-center gap-1 text-center shadow-xs">
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
						<p className="text-[11px] font-semibold opacity-80 text-success truncate">
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
											</div>
											<div className="flex flex-wrap items-center gap-1.5 mt-1">
												{parsed.items.map((item) => (
													<div
														key={`${item.pos ?? "def"}:${item.text}`}
														className="inline-flex items-center gap-1 text-xs"
													>
														{item.pos && (
															<span
																title={item.posFull}
																className={`font-mono text-[9px] font-extrabold uppercase px-1 py-0.5 rounded border ${
																	item.tone ??
																	"bg-surface text-muted border-edge/60"
																}`}
															>
																{item.posLabel ?? item.pos}
															</span>
														)}
														<span className="text-xs text-ink/90 font-medium">
															{item.text}
														</span>
													</div>
												))}
											</div>
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

				{/* Rincian Semua Kosakata yang Baru Saja Dihapal */}
				{reviewedLogs.length > 0 && (
					<div className="rounded-card bg-surface border border-edge p-4 sm:p-5 mb-6 shadow-sm space-y-3.5">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1 border-b border-edge/60">
							<div>
								<h3 className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
									<Icon name="book" className="w-3.5 h-3.5 text-primary" />
									<span>
										Kosakata yang Dilatih ({reviewedLogs.length} kata)
									</span>
								</h3>
								<p className="text-xs text-muted font-medium mt-0.5">
									Daftar kata yang kamu ulas pada sesi ini
								</p>
							</div>

							{/* Filter Chips */}
							<div className="flex items-center gap-1 p-0.5 rounded-pill bg-surface-2 border border-edge/60 text-[11px] font-bold">
								<button
									type="button"
									onClick={() => setWordsListFilter("all")}
									className={`px-2.5 py-1 rounded-pill transition ${
										wordsListFilter === "all"
											? "bg-surface text-ink shadow-2xs font-extrabold"
											: "text-muted hover:text-ink"
									}`}
								>
									Semua ({reviewedLogs.length})
								</button>
								<button
									type="button"
									onClick={() => setWordsListFilter("again")}
									className={`px-2.5 py-1 rounded-pill transition ${
										wordsListFilter === "again"
											? "bg-danger/15 text-danger font-extrabold shadow-2xs"
											: "text-muted hover:text-ink"
									}`}
								>
									Lupa ({reviewedLogs.filter((c) => c.rating === 1).length})
								</button>
								<button
									type="button"
									onClick={() => setWordsListFilter("success")}
									className={`px-2.5 py-1 rounded-pill transition ${
										wordsListFilter === "success"
											? "bg-success/15 text-success font-extrabold shadow-2xs"
											: "text-muted hover:text-ink"
									}`}
								>
									Hapal ({reviewedLogs.filter((c) => c.rating > 1).length})
								</button>
							</div>
						</div>

						{/* List Items */}
						<div className="space-y-2 max-h-72 overflow-y-auto pr-1 scrollbar-none">
							{reviewedLogs
								.filter((c) => {
									if (wordsListFilter === "again") return c.rating === 1;
									if (wordsListFilter === "success") return c.rating > 1;
									return true;
								})
								.map((c) => {
									const parsed = parseBackContent(c.back);
									const ratingMeta =
										c.rating === 1
											? {
													label: "Ulang",
													bg: "bg-danger/10 text-danger border-danger/20",
												}
											: c.rating === 2
												? {
														label: "Susah",
														bg: "bg-amber-500/10 text-amber-500 border-amber-500/20",
													}
												: c.rating === 3
													? {
															label: "Oke",
															bg: "bg-success/10 text-success border-success/20",
														}
													: {
															label: "Gampang",
															bg: "bg-blue-500/10 text-blue-500 border-blue-500/20",
														};

									return (
										<div
											key={c.id}
											className="p-3 rounded-control bg-surface-2/40 border border-edge/60 flex items-center justify-between gap-3 hover:border-primary/40 transition group"
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<button
														type="button"
														onClick={() => void speak(c.front, "en-US")}
														className="font-black text-ink text-sm sm:text-base hover:text-primary transition flex items-center gap-1.5"
													>
														<span>{c.front}</span>
														<Icon
															name="volume"
															className="w-3.5 h-3.5 text-muted group-hover:text-primary transition-colors"
														/>
													</button>
												</div>
												<div className="flex flex-wrap items-center gap-1.5 mt-0.5">
													{parsed.items.map((item) => (
														<div
															key={`${item.pos ?? "def"}:${item.text}`}
															className="inline-flex items-center gap-1 text-xs"
														>
															{item.pos && (
																<span
																	title={item.posFull}
																	className={`font-mono text-[9px] font-extrabold uppercase px-1 py-0.5 rounded border ${
																		item.tone ??
																		"bg-surface text-muted border-edge/60"
																	}`}
																>
																	{item.posLabel ?? item.pos}
																</span>
															)}
															<span className="text-xs text-ink/90 font-medium">
																{item.text}
															</span>
														</div>
													))}
												</div>
											</div>

											{/* Rating Badge */}
											<span
												className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-pill border shrink-0 ${ratingMeta.bg}`}
											>
												{ratingMeta.label}
											</span>
										</div>
									);
								})}
						</div>

						<Link
							to="/statistik"
							className="text-center block text-xs font-bold text-primary hover:underline pt-1"
						>
							Lihat Semua Riwayat Sesi Latihan di Menu Statistik →
						</Link>
					</div>
				)}

				<div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3">
					<button
						type="button"
						onClick={() => {
							setCursor(0);
							setMissedCards([]);
							setReviewedLogs([]);
							setHistorySaved(false);
							setSessionCoins(0);
							setSessionCount(0);
							setSessionNonce((n) => n + 1);
						}}
						className="w-full sm:flex-1 py-3.5 border border-edge bg-surface text-ink font-bold rounded-control hover:bg-surface-2 active:scale-[0.98] transition text-sm"
					>
						Ulangi Sesi
					</button>
					<Link
						to="/"
						className="w-full sm:flex-1 text-center py-3.5 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-[0.98] transition shadow text-sm"
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
		<div className="flex-1 flex flex-col justify-between h-full w-full max-w-xl md:max-w-2xl mx-auto px-1 py-1 select-none overflow-hidden min-h-0">
			{/* Header Navigation & Session Stats */}
			<div className="shrink-0 space-y-2.5">
				<div className="flex items-center justify-between gap-3 px-1">
					<Link
						to="/"
						className="font-mono text-xs font-bold text-muted hover:text-ink transition-colors uppercase tracking-wider inline-flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-surface-2"
					>
						<Icon name="chevron-left" className="w-4 h-4" />
						<span>Beranda</span>
					</Link>

					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void toggleTts()}
							aria-label={
								ttsEnabled
									? "Matikan suara otomatis"
									: "Nyalakan suara otomatis"
							}
							title={
								ttsEnabled ? "Suara Aktif (Tekan S untuk putar)" : "Suara Mati"
							}
							className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition shadow-2xs border ${
								ttsEnabled
									? "bg-primary/10 text-primary border-primary/20"
									: "bg-surface-2 text-muted border-edge/60 opacity-70"
							}`}
						>
							<Icon name="volume" className="w-4 h-4" />
						</button>

						{stageMeta && (
							<span
								className={`font-mono text-[10.5px] font-bold uppercase px-2.5 py-0.5 sm:py-1 rounded-[8px] ${stageMeta.colorClass}`}
							>
								{stageMeta.title}
							</span>
						)}

						<span className="font-mono text-xs font-bold text-ink bg-surface border border-edge/80 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-pill shadow-2xs">
							{cursor + 1}/{totalCards}
						</span>
					</div>
				</div>

				{/* Progress bar */}
				<div className="w-full h-1.5 sm:h-2 bg-surface-2 rounded-full overflow-hidden shadow-inner">
					<div
						className="h-full bg-gradient-to-r from-primary via-indigo-500 to-primary rounded-full progress-fill"
						style={{ width: `${progressPercent}%` }}
					/>
				</div>
			</div>

			{/* Center Card Container — Perfectly Centered Vertically */}
			<div className="flex-1 flex flex-col justify-center items-center py-2 min-h-0 w-full my-auto">
				<EkspedisiCard
					key={`${currentCard.id}-${cursor}`}
					card={currentCard}
					ttsEnabled={ttsEnabled}
					onReviewComplete={(result) => {
						setReviewedLogs((prev) => {
							const existing = prev.filter((c) => c.id !== currentCard.id);
							return [
								...existing,
								{
									id: currentCard.id,
									front: currentCard.front,
									back: currentCard.back,
									category: currentCard.category,
									rating: result.rating,
								},
							];
						});

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
			</div>

			{/* Keyboard Shortcut Hints Footer */}
			<div className="flex items-center justify-between text-xs text-muted font-medium px-2 py-1 shrink-0">
				<div className="flex items-center gap-1.5">
					<span className="kbd-hint">Spasi</span>
					<span>Balik kartu</span>
				</div>
				<div className="hidden md:flex items-center gap-3">
					<div className="flex items-center gap-1">
						<span className="kbd-hint">S</span>
						<span>Audio</span>
					</div>
					<div className="flex items-center gap-1.5">
						<span className="kbd-hint">1–4</span>
						<span>Pilihan nilai</span>
					</div>
				</div>
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
		accent: "bg-accent/15 text-accent-ink border-accent/25",
		danger: "bg-danger/10 text-danger border-danger/25",
	} as const;
	return (
		<div
			className={`rounded-card p-3.5 text-center border ${tones[tone]} flex flex-col items-center justify-center shadow-xs`}
		>
			<Icon name={icon} className="w-5 h-5 mb-1 opacity-90" />
			<p className="text-lg font-black leading-tight text-ink">{value}</p>
			<p className="text-[11px] font-semibold opacity-75 mt-0.5 truncate">
				{label}
			</p>
		</div>
	);
}
