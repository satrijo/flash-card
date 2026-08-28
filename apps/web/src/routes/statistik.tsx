/*
 * Rute /statistik — wawasan belajar dan analitik SRS dari data lokal.
 * Total, retensi, aktivitas 7 hari, penguasaan per tahap, kata sering lupa.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { getBandMeta } from "../lib/bands";
import { computeStats } from "../lib/stats";
import { speak } from "../lib/tts";

export const Route = createFileRoute("/statistik")({
	component: StatistikPage,
});

export function StatistikPage() {
	const stats = useLiveQuery(() => computeStats(), []);
	const [activeBarKey, setActiveBarKey] = useState<string | null>(null);

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
			{/* Header */}
			<section className="animate-fade-in-up">
				<Link
					to="/"
					className="font-mono text-[12px] font-bold text-muted hover:text-ink transition-colors uppercase tracking-wide inline-flex items-center gap-1 mb-2"
				>
					<Icon name="chevron-left" className="w-4 h-4" />
					Beranda
				</Link>
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-extrabold text-ink tracking-tight">
							Statistik Belajar
						</h1>
						<p className="text-xs text-muted mt-0.5 font-medium">
							{stats.rankName} · Level {stats.level}
						</p>
					</div>
					<div className="px-3 py-1.5 rounded-pill bg-success/10 text-success text-xs font-bold font-mono flex items-center gap-1.5">
						<Icon name="sparkles" className="w-3.5 h-3.5" />
						{retentionRate}% Retensi
					</div>
				</div>
			</section>

			{/* Stat Grid */}
			<section className="grid grid-cols-2 gap-3 animate-fade-in-up stagger-1">
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

			{/* Aktivitas 7 Hari */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-2">
				<div className="flex items-center justify-between mb-4">
					<h2 className="font-mono text-[12px] font-bold uppercase tracking-widest text-muted">
						Aktivitas 7 Hari
					</h2>
					{activeBarKey && (
						<span className="text-xs font-bold text-primary animate-fade-in-up">
							{stats.week.find((d) => d.key === activeBarKey)?.count ?? 0}{" "}
							ulasan
						</span>
					)}
				</div>
				{hasActivity ? (
					<div className="flex items-end gap-2 h-32 pt-4">
						{stats.week.map((d) => {
							const heightPct =
								max > 0 ? Math.max(8, Math.round((d.count / max) * 100)) : 8;
							const isActive = activeBarKey === d.key;
							return (
								<button
									type="button"
									key={d.key}
									onClick={() => setActiveBarKey(isActive ? null : d.key)}
									onMouseEnter={() => setActiveBarKey(d.key)}
									onMouseLeave={() => setActiveBarKey(null)}
									className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full focus:outline-none group cursor-pointer"
								>
									<div className="w-full relative flex items-end justify-center h-full">
										{d.count > 0 && (
											<span className="absolute -top-6 text-[10px] font-bold font-mono text-ink opacity-0 group-hover:opacity-100 transition-opacity">
												{d.count}
											</span>
										)}
										<div
											className={`w-full rounded-t-md transition-all ${
												d.count > 0
													? isActive
														? "bg-primary"
														: "bg-accent hover:bg-primary"
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
					<p className="text-sm text-muted text-center py-6">
						Belum ada aktivitas ulasan minggu ini
					</p>
				)}
			</section>

			{/* Penguasaan Per Tahap */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-3">
				<div className="flex items-center justify-between mb-3">
					<h2 className="font-mono text-[12px] font-bold uppercase tracking-widest text-muted">
						Penguasaan Per Tahap
					</h2>
					<span className="text-xs text-muted font-medium">
						{stats.habitats.length} Tahap
					</span>
				</div>
				<div className="space-y-4">
					{stats.habitats.map((h) => {
						const meta = getBandMeta(h.category);
						const maturePct = h.total > 0 ? (h.mature / h.total) * 100 : 0;
						const learningPct = h.total > 0 ? (h.learning / h.total) * 100 : 0;
						const totalStudiedPct =
							h.total > 0 ? (h.studied / h.total) * 100 : 0;

						return (
							<div
								key={h.category}
								className="p-4 rounded-control bg-surface-2/40 border border-edge/60 space-y-3"
							>
								{/* Header tahap: Baris 1 = Badge (kiri) & Counter/Status (kanan) */}
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

								{/* Baris 2: Subtitle deskripsi tahap */}
								<p className="text-xs text-muted font-medium leading-tight">
									{meta.subtitle}
								</p>

								{/* Segmented Progress Bar: Matang (Hijau) | Belajar (Primary) | Belum (Surface) */}
								<div className="h-2.5 rounded-full bg-surface border border-edge/50 overflow-hidden flex">
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
													title={`Matang: ${h.mature} kata`}
												/>
											)}
											{learningPct > 0 && (
												<div
													className="h-full bg-primary transition-all"
													style={{
														width: `${(h.learning / h.studied) * 100}%`,
													}}
													title={`Sedang Belajar: ${h.learning} kata`}
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
			</section>

			{/* Kata Sering Lupa (Weak Words) */}
			<section className="rounded-card bg-surface border border-edge p-5 shadow-sm animate-fade-in-up stagger-4">
				<div className="flex items-center justify-between mb-3">
					<h2 className="font-mono text-[12px] font-bold uppercase tracking-widest text-muted">
						Kata Sering Lupa
					</h2>
					<span className="text-xs text-muted font-medium">
						{stats.weakWords.length} kata
					</span>
				</div>
				{stats.weakWords.length === 0 ? (
					<div className="text-center py-6">
						<Icon
							name="check-circle"
							className="w-8 h-8 text-success mx-auto mb-2"
						/>
						<p className="text-sm text-ink font-bold">Ingatanmu Sangat Baik!</p>
						<p className="text-xs text-muted mt-0.5">
							Belum ada kata yang sering lupa.
						</p>
					</div>
				) : (
					<div className="space-y-2.5">
						{stats.weakWords.map((w) => {
							const meta = getBandMeta(w.category);
							return (
								<div
									key={w.id}
									className="p-3.5 rounded-control bg-surface-2/40 border border-edge/60 hover:border-primary/50 transition space-y-2"
								>
									<div className="flex items-center justify-between gap-3">
										<div className="flex items-center gap-2 min-w-0">
											<button
												type="button"
												onClick={() => void speak(w.front, "en-US")}
												aria-label={`Dengarkan ${w.front}`}
												className="font-extrabold text-ink text-base hover:text-primary transition flex items-center gap-1.5 truncate"
											>
												{w.front}
												<Icon
													name="volume"
													className="w-4 h-4 text-muted shrink-0"
												/>
											</button>
											{w.pos && (
												<span className="font-mono text-[10px] font-bold italic px-1.5 py-0.5 rounded bg-surface text-muted border border-edge/50 shrink-0">
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
											<span className="font-mono text-[10px] font-bold bg-danger/10 text-danger px-2 py-0.5 rounded-pill">
												{w.lapses}x lupa
											</span>
										</div>
									</div>

									<p className="text-sm font-semibold text-ink leading-snug">
										{w.gloss}
									</p>

									{w.exampleEn && (
										<div className="p-2.5 rounded bg-surface/80 border border-edge/60 text-xs">
											<p className="font-medium text-ink">"{w.exampleEn}"</p>
											{w.exampleId && (
												<p className="text-muted mt-0.5">{w.exampleId}</p>
											)}
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
		default: "bg-surface border border-edge text-ink",
		success: "bg-success/10 text-success",
		accent: "bg-accent/15 text-accent-ink",
		danger: "bg-danger/10 text-danger",
	} as const;
	return (
		<div className={`rounded-card p-3.5 ${tones[tone]} shadow-sm`}>
			<Icon name={icon} className="w-5 h-5 mb-1" />
			<p className="text-lg font-extrabold leading-tight">{value}</p>
			<p className="text-[11px] font-semibold opacity-80 mt-0.5">{label}</p>
		</div>
	);
}
