/*
 * Rute /statistik — wawasan belajar dan analitik SRS dari data lokal.
 * Total, retensi, aktivitas 7 hari, penguasaan per tahap, kata sering lupa.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { getBandMeta, parseBackContent } from "../lib/bands";
import { db } from "../lib/db";
import { clearPracticeHistory } from "../lib/history";
import { computeStats } from "../lib/stats";
import { speak } from "../lib/tts";

function formatSessionTime(timestamp: number): string {
	const d = new Date(timestamp);
	const now = new Date();
	const isToday = d.toDateString() === now.toDateString();
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	const isYesterday = d.toDateString() === yesterday.toDateString();

	const timeStr = d.toLocaleTimeString("id-ID", {
		hour: "2-digit",
		minute: "2-digit",
	});

	if (isToday) return `Hari ini, ${timeStr}`;
	if (isYesterday) return `Kemarin, ${timeStr}`;
	return `${d.toLocaleDateString("id-ID", { day: "numeric", month: "short" })}, ${timeStr}`;
}

export const Route = createFileRoute("/statistik")({
	component: StatistikPage,
});

function StatistikPage() {
	const stats = useLiveQuery(() => computeStats(), []);
	const practiceHistory = useLiveQuery(
		() => db.practiceHistory.orderBy("timestamp").reverse().limit(30).toArray(),
		[],
	);
	const [activeBarKey, setActiveBarKey] = useState<string | null>(null);
	const [expandedSessionId, setExpandedSessionId] = useState<number | null>(
		null,
	);
	const [historySearch, setHistorySearch] = useState("");

	if (stats === undefined) {
		return (
			<div className="py-8 space-y-4 animate-fade-in-up">
				<div className="skeleton h-24 w-full" />
				<div className="skeleton h-32 w-full" />
				<div className="skeleton h-40 w-full" />
			</div>
		);
	}

	if (stats.total === 0) {
		return (
			<div className="py-12 text-center animate-fade-in-up">
				<div className="w-16 h-16 rounded-full bg-surface-2 text-muted flex items-center justify-center mx-auto mb-6">
					<Icon name="book" className="w-8 h-8" />
				</div>
				<h1 className="text-2xl font-extrabold text-ink mb-2">
					Belum Ada Data
				</h1>
				<p className="text-muted max-w-sm mx-auto mb-8 text-sm">
					Data statistik akan muncul setelah kamu mulai melatih kosakata di
					Beranda.
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

	const max = Math.max(...stats.week.map((d) => d.count), 0);
	const hasActivity = stats.week.some((d) => d.count > 0);
	const retentionRate = stats.retentionRate;

	return (
		<div className="py-6 space-y-5">
			{/* Header & Player Rank Banner */}
			<section className="animate-fade-in-up">
				<Link
					to="/"
					className="font-mono text-[12px] font-bold text-muted hover:text-ink transition-colors uppercase tracking-wide inline-flex items-center gap-1 mb-3"
				>
					<Icon name="chevron-left" className="w-4 h-4" />
					Beranda
				</Link>
				<div className="p-5 rounded-card bg-surface border border-edge shadow-sm flex items-center justify-between gap-3 relative overflow-hidden">
					<div className="flex items-center gap-3.5 min-w-0">
						<div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-primary to-indigo-500 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-md shadow-primary/25">
							<Icon name="chart" className="w-6 h-6" />
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<h1 className="text-xl font-black text-ink tracking-tight truncate">
									Statistik Belajar
								</h1>
								<span className="px-2 py-0.5 rounded-pill bg-primary/10 text-primary font-mono text-[10px] font-bold uppercase shrink-0">
									LVL {stats.level}
								</span>
							</div>
							<p className="text-xs text-muted mt-0.5 font-medium truncate">
								Gelar: <strong className="text-ink">{stats.rankName}</strong>
							</p>
						</div>
					</div>
					<div className="px-3 py-1.5 rounded-pill bg-success/15 border border-success/30 text-success text-xs font-bold font-mono flex items-center gap-1.5 shrink-0 shadow-xs">
						<Icon name="sparkles" className="w-3.5 h-3.5" />
						{retentionRate}% Retensi
					</div>
				</div>
			</section>

			{/* Stat Grid (Bento 4-Column on Desktop) */}
			<section className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in-up stagger-1">
				<StatTile
					icon="book"
					value={stats.total.toLocaleString("id-ID")}
					label="Total Kosakata"
				/>
				<StatTile
					icon="target"
					value={stats.dueNow}
					label="Kata Siap Latih"
					tone="success"
				/>
				<StatTile
					icon="sparkles"
					value={stats.mature}
					label="Kata Matang"
					tone="accent"
				/>
				<StatTile
					icon="flame"
					value={`${stats.reviewedToday} Ulasan`}
					label="Aktivitas Hari Ini"
					tone="danger"
				/>
			</section>

			{/* Analytics Section: 2 Columns on Desktop */}
			<section className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-fade-in-up stagger-2">
				{/* Left (6 cols): Aktivitas 7 Hari */}
				<div className="lg:col-span-6 rounded-card bg-surface border border-edge p-5 shadow-sm flex flex-col justify-between">
					<div className="flex items-center justify-between mb-4">
						<div>
							<h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
								Aktivitas 7 Hari
							</h2>
							<p className="text-xs text-muted mt-0.5 font-medium">
								Konsistensi latihan mingguan
							</p>
						</div>
						{activeBarKey && (
							<span className="text-xs font-bold text-primary font-mono bg-primary/10 px-2.5 py-1 rounded-pill animate-fade-in-up">
								{stats.week.find((d) => d.key === activeBarKey)?.count ?? 0}{" "}
								ulasan
							</span>
						)}
					</div>
					{hasActivity ? (
						<div className="flex items-end gap-2.5 h-44 pt-4 px-1">
							{stats.week.map((d) => {
								const heightPct =
									max > 0
										? Math.max(10, Math.round((d.count / max) * 100))
										: 10;
								const isActive = activeBarKey === d.key;
								return (
									<button
										type="button"
										key={d.key}
										onClick={() => setActiveBarKey(isActive ? null : d.key)}
										onMouseEnter={() => setActiveBarKey(d.key)}
										onMouseLeave={() => setActiveBarKey(null)}
										className="flex-1 flex flex-col items-center justify-end gap-2 h-full focus:outline-none group cursor-pointer"
									>
										<div className="w-full relative flex items-end justify-center h-full">
											{d.count > 0 && (
												<span className="absolute -top-6 text-[10px] font-bold font-mono text-ink opacity-0 group-hover:opacity-100 transition-opacity bg-surface border border-edge px-1.5 py-0.5 rounded shadow-xs">
													{d.count}
												</span>
											)}
											<div
												className={`w-full rounded-t-lg transition-all ${
													d.count > 0
														? isActive
															? "bg-gradient-to-t from-primary to-indigo-400 shadow-md shadow-primary/30"
															: "bg-gradient-to-t from-primary/80 to-primary hover:from-primary hover:to-indigo-400"
														: "bg-surface-2"
												}`}
												style={{ height: `${heightPct}%` }}
											/>
										</div>
										<span
											className={`text-[10px] font-semibold transition-colors ${isActive ? "text-primary font-bold" : "text-muted"}`}
										>
											{d.label}
										</span>
									</button>
								);
							})}
						</div>
					) : (
						<p className="text-sm text-muted text-center py-12">
							Belum ada aktivitas ulasan minggu ini
						</p>
					)}
				</div>

				{/* Right (6 cols): Penguasaan Per Tahap */}
				<div className="lg:col-span-6 rounded-card bg-surface border border-edge p-5 shadow-sm flex flex-col justify-between">
					<div className="flex items-center justify-between mb-3">
						<h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
							Penguasaan Per Tahap
						</h2>
						<span className="text-xs text-muted font-medium font-mono">
							{stats.habitats.length} Tahap
						</span>
					</div>
					<div className="space-y-3 flex-1 flex flex-col justify-around">
						{stats.habitats.map((h) => {
							const meta = getBandMeta(h.category);
							const maturePct = h.total > 0 ? (h.mature / h.total) * 100 : 0;
							const learningPct =
								h.total > 0 ? (h.learning / h.total) * 100 : 0;
							const totalStudiedPct =
								h.total > 0 ? (h.studied / h.total) * 100 : 0;

							return (
								<div
									key={h.category}
									className="p-3.5 rounded-control bg-surface-2/40 border border-edge/60 space-y-2"
								>
									{/* Header tahap: Baris 1 = Badge & Counter */}
									<div className="flex items-center justify-between gap-2">
										<span
											className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-[6px] ${meta.colorClass} shrink-0`}
										>
											{meta.title}
										</span>
										<div className="font-mono text-xs font-bold text-ink shrink-0">
											{h.isLocked ? (
												<span className="text-muted text-[11px] flex items-center gap-1">
													<Icon name="lock" className="w-3.5 h-3.5" />
													Terkunci
												</span>
											) : (
												<span>
													{h.studied > 0
														? `${h.studied.toLocaleString("id-ID")}/${h.total.toLocaleString("id-ID")} (${h.progressPct}%)`
														: `0/${h.total.toLocaleString("id-ID")} (0%)`}
												</span>
											)}
										</div>
									</div>

									{/* Progress bar */}
									<div className="h-2 rounded-full bg-surface border border-edge/50 overflow-hidden flex">
										{h.studied > 0 ? (
											<div
												className="h-full flex transition-all duration-300"
												style={{
													width: `${Math.max(totalStudiedPct, 3)}%`,
													minWidth: "10px",
												}}
											>
												{maturePct > 0 && (
													<div
														className="h-full bg-success transition-all"
														style={{
															width: `${(h.mature / h.studied) * 100}%`,
														}}
													/>
												)}
												{learningPct > 0 && (
													<div
														className="h-full bg-primary transition-all"
														style={{
															width: `${(h.learning / h.studied) * 100}%`,
														}}
													/>
												)}
											</div>
										) : (
											<div className="h-full w-0" />
										)}
									</div>

									{/* Breakdown Status */}
									<div className="flex items-center justify-between text-[11px] text-muted font-medium">
										<div className="flex items-center gap-2.5 flex-wrap">
											<span className="flex items-center gap-1 text-success font-semibold">
												<span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
												{h.mature} matang
											</span>
											<span className="flex items-center gap-1 text-primary font-semibold">
												<span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
												{h.learning} belajar
											</span>
											<span className="flex items-center gap-1">
												<span className="w-1.5 h-1.5 rounded-full bg-muted/40 inline-block" />
												{h.fresh.toLocaleString("id-ID")} baru
											</span>
										</div>
										{h.dueReviews > 0 ? (
											<span className="font-bold text-danger text-[10px] bg-danger/10 px-1.5 py-0.5 rounded">
												{h.dueReviews} siap ulas
											</span>
										) : h.studied > 0 ? (
											<span className="text-[10px] font-mono text-muted">
												{h.retentionPct}% retensi
											</span>
										) : null}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</section>
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-3">
				<div className="flex items-center justify-between mb-4">
					<div>
						<h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
							Kata Sering Lupa
						</h2>
						<p className="text-xs text-muted mt-0.5 font-medium">
							Fokus perbaiki kosakata dengan riwayat lupa tertinggi
						</p>
					</div>
					<span className="text-xs text-muted font-medium font-mono bg-surface-2 px-2.5 py-1 rounded-pill">
						{stats.weakWords.length} kata
					</span>
				</div>
				{stats.weakWords.length === 0 ? (
					<div className="text-center py-8">
						<Icon
							name="check-circle"
							className="w-10 h-10 text-success mx-auto mb-2 opacity-80"
						/>
						<p className="text-sm text-ink font-bold">Ingatanmu Sangat Baik!</p>
						<p className="text-xs text-muted mt-0.5">
							Belum ada kata dengan catatan sering lupa.
						</p>
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						{stats.weakWords.map((w) => {
							const meta = getBandMeta(w.category);
							return (
								<div
									key={w.id}
									className="p-4 rounded-control bg-surface-2/40 border border-edge/60 hover:border-primary/50 transition space-y-2.5 flex flex-col justify-between"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0">
											<button
												type="button"
												onClick={() => void speak(w.front, "en-US")}
												aria-label={`Dengarkan ${w.front}`}
												className="font-black text-ink text-base hover:text-primary transition flex items-center gap-1.5 truncate"
											>
												{w.front}
												<Icon
													name="volume"
													className="w-4 h-4 text-muted shrink-0"
												/>
											</button>
											{w.pos && (
												<span className="font-mono text-[10px] font-bold italic px-1.5 py-0.5 rounded bg-surface border border-edge/40 text-muted shrink-0">
													{w.pos}
												</span>
											)}
										</div>
										<div className="flex items-center gap-1.5 shrink-0">
											<span
												className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-[6px] ${meta.colorClass}`}
											>
												{meta.title}
											</span>
											<span className="font-mono text-[10px] font-bold bg-danger/10 text-danger border border-danger/20 px-2 py-0.5 rounded-pill">
												{w.lapses}x
											</span>
										</div>
									</div>

									<p className="text-sm font-bold text-ink leading-snug">
										{w.gloss}
									</p>

									{w.exampleEn && (
										<div className="p-2.5 rounded bg-surface/80 border border-edge/60 text-xs mt-auto space-y-0.5">
											<p className="font-medium text-ink">"{w.exampleEn}"</p>
											{w.exampleId && (
												<p className="text-muted text-[11px]">{w.exampleId}</p>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</section>

			{/* SECTION 4: RIWAYAT SESI LATIHAN KOSAKATA */}
			<section
				id="riwayat"
				className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-3 space-y-4"
			>
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-edge/60">
					<div>
						<div className="flex items-center gap-2">
							<h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
								Riwayat Sesi Latihan
							</h2>
							<span className="px-2 py-0.5 rounded-pill bg-primary/10 text-primary font-mono text-[10px] font-bold">
								{practiceHistory?.length ?? 0} Sesi Tersimpan
							</span>
						</div>
						<p className="text-xs text-muted mt-0.5 font-medium">
							Cek kosakata yang telah kamu pelajari di setiap sesi latihan
						</p>
					</div>

					{practiceHistory && practiceHistory.length > 0 && (
						<button
							type="button"
							onClick={() => {
								if (
									window.confirm(
										"Apakah kamu yakin ingin menghapus seluruh riwayat latihan?",
									)
								) {
									void clearPracticeHistory();
								}
							}}
							className="text-[11px] font-bold text-muted hover:text-danger self-start sm:self-auto transition"
						>
							Hapus Riwayat
						</button>
					)}
				</div>

				{/* Search Bar in Practice History */}
				{practiceHistory && practiceHistory.length > 0 && (
					<div className="relative">
						<Icon
							name="search"
							className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2"
						/>
						<input
							type="text"
							value={historySearch}
							onChange={(e) => setHistorySearch(e.target.value)}
							placeholder="Cari kata atau tahap yang pernah kamu latih…"
							className="w-full pl-9.5 pr-3.5 py-2.5 rounded-control border border-edge bg-surface-2 text-xs text-ink font-medium focus:outline-none focus:border-primary transition"
						/>
					</div>
				)}

				{!practiceHistory || practiceHistory.length === 0 ? (
					<div className="text-center py-8 space-y-2 text-muted">
						<div className="w-12 h-12 rounded-2xl bg-surface-2 text-muted flex items-center justify-center mx-auto mb-1">
							<Icon name="layers" className="w-6 h-6" />
						</div>
						<p className="text-sm text-ink font-bold">Belum Ada Riwayat Sesi</p>
						<p className="text-xs max-w-xs mx-auto">
							Selesaikan latihan pertama kamu di Beranda untuk melihat daftar
							kata yang kamu hapal di sini!
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{practiceHistory
							.filter((session) => {
								if (!historySearch.trim()) return true;
								const q = historySearch.toLowerCase();
								const matchesStage = session.tahap?.toLowerCase().includes(q);
								const matchesWord = session.cards?.some(
									(c) =>
										c.front.toLowerCase().includes(q) ||
										c.back.toLowerCase().includes(q),
								);
								return matchesStage || matchesWord;
							})
							.map((session) => {
								const isExpanded = expandedSessionId === session.id;
								const stageMeta = session.tahap
									? getBandMeta(session.tahap)
									: null;
								const formattedTime = formatSessionTime(session.timestamp);

								return (
									<div
										key={session.id}
										className="rounded-xl bg-surface-2/40 border border-edge/60 overflow-hidden transition-all"
									>
										{/* Session Header Card */}
										<button
											type="button"
											onClick={() =>
												setExpandedSessionId(
													isExpanded ? null : (session.id ?? null),
												)
											}
											className="w-full p-3.5 sm:p-4 flex items-center justify-between gap-3 text-left hover:bg-surface-2/80 transition"
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2 flex-wrap">
													<span className="font-bold text-xs sm:text-sm text-ink">
														{formattedTime}
													</span>
													{stageMeta ? (
														<span
															className={`font-mono text-[9.5px] font-bold uppercase px-2 py-0.5 rounded-[6px] ${stageMeta.colorClass}`}
														>
															{stageMeta.title}
														</span>
													) : (
														<span className="font-mono text-[9.5px] font-bold uppercase px-2 py-0.5 rounded-[6px] bg-surface border border-edge text-muted">
															Semua Tahap
														</span>
													)}
												</div>

												{/* Quick Stats Bar */}
												<div className="flex items-center gap-3 mt-1 text-[11px] text-muted flex-wrap">
													<span className="font-semibold text-ink">
														📚 {session.wordsCount} Kata
													</span>
													<span>•</span>
													<span className="font-semibold text-primary">
														⭐ +{session.xpGained} XP
													</span>
													{session.ratings && (
														<>
															<span>•</span>
															<div className="flex items-center gap-1 font-mono text-[10px]">
																{session.ratings.again > 0 && (
																	<span className="text-danger font-bold">
																		{session.ratings.again} Ulang
																	</span>
																)}
																{session.ratings.again > 0 &&
																	session.ratings.good + session.ratings.easy >
																		0 && <span>,</span>}
																{session.ratings.good + session.ratings.easy >
																	0 && (
																	<span className="text-success font-bold">
																		{session.ratings.good +
																			session.ratings.easy}{" "}
																		Hapal
																	</span>
																)}
															</div>
														</>
													)}
												</div>
											</div>

											<div className="flex items-center gap-2 shrink-0">
												<span className="text-[11px] font-bold text-primary hidden sm:inline">
													{isExpanded ? "Tutup Kata" : "Lihat Kata"}
												</span>
												<Icon
													name={isExpanded ? "chevron-up" : "chevron-down"}
													className="w-4 h-4 text-muted"
												/>
											</div>
										</button>

										{/* Expanded Word List for this session */}
										{isExpanded && (
											<div className="p-3.5 sm:p-4 border-t border-edge/60 bg-surface/60 space-y-2.5 animate-fade-in-up">
												<p className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-muted">
													Daftar {session.cards?.length ?? 0} Kosakata di Sesi
													Ini:
												</p>
												<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1 scrollbar-none">
													{session.cards?.map((card) => {
														const parsed = parseBackContent(card.back);
														const ratingMeta =
															card.rating === 1
																? {
																		label: "Ulang",
																		bg: "bg-danger/10 text-danger border-danger/20",
																	}
																: card.rating === 2
																	? {
																			label: "Susah",
																			bg: "bg-amber-500/10 text-amber-500 border-amber-500/20",
																		}
																	: card.rating === 3
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
																key={card.id}
																className="p-3 rounded-xl bg-surface border border-edge/80 shadow-2xs flex items-center justify-between gap-2.5 group"
															>
																<div className="min-w-0 flex-1">
																	<button
																		type="button"
																		onClick={() =>
																			void speak(card.front, "en-US")
																		}
																		className="font-bold text-xs sm:text-sm text-ink hover:text-primary transition flex items-center gap-1.5 truncate text-left"
																	>
																		<span>{card.front}</span>
																		<Icon
																			name="volume"
																			className="w-3.5 h-3.5 text-muted group-hover:text-primary transition-colors shrink-0"
																		/>
																	</button>
																	<p className="text-[11.5px] text-muted truncate mt-0.5">
																		{parsed.items[0]?.text ?? card.back}
																	</p>
																</div>
																<span
																	className={`font-mono text-[9px] font-bold px-2 py-0.5 rounded-pill border shrink-0 ${ratingMeta.bg}`}
																>
																	{ratingMeta.label}
																</span>
															</div>
														);
													})}
												</div>
											</div>
										)}
									</div>
								);
							})}
					</div>
				)}
			</section>
		</div>
	);
}

function StatTile({
	icon,
	value,
	label,
	tone = "default",
}: {
	icon: IconName;
	value: number | string;
	label: string;
	tone?: "default" | "success" | "accent" | "danger";
}) {
	const tones = {
		default: "bg-surface border-edge text-ink",
		success: "bg-success/10 border-success/25 text-success",
		accent: "bg-accent/15 border-accent/25 text-accent-ink",
		danger: "bg-danger/10 border-danger/25 text-danger",
	} as const;
	return (
		<div
			className={`rounded-card p-4 border ${tones[tone]} shadow-xs flex flex-col justify-between`}
		>
			<Icon name={icon} className="w-5 h-5 mb-1.5 opacity-90" />
			<div>
				<p className="text-xl font-black leading-tight text-ink">{value}</p>
				<p className="text-[11px] font-semibold opacity-75 mt-0.5 truncate">
					{label}
				</p>
			</div>
		</div>
	);
}
