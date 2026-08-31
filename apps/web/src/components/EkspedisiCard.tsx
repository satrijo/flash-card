/*
 * EkspedisiCard — kartu flashcard SRS dual-side (depan EN / belakang ID).
 * Desain: Modern Minimalist & Clean Editorial.
 * Fitur: TTS otomatis/manual, hierarki tipografi tegas, label kelas kata POS,
 * callout contoh kalimat beraksen, serta 4 tombol ulasan ergonomis FSRS.
 */

import { fsrsEngine, Rating } from "@flashcard/shared";
import { useCallback, useEffect, useState } from "react";
import { getBandMeta, parseBackContent } from "../lib/bands";
import { db, type LocalCard } from "../lib/db";
import { awardReview } from "../lib/game";
import { speak } from "../lib/tts";
import { Icon } from "./Icon";

const RATING_LABELS: Record<string, string> = {
	again: "Ulang",
	hard: "Susah",
	good: "Oke",
	easy: "Gampang",
};

interface EkspedisiCardProps {
	card: LocalCard;
	ttsEnabled: boolean;
	onReviewComplete: (result: { xpGained: number; rating: Rating }) => void;
}

export function formatInterval(due: Date, now: Date): string {
	const diffMs = due.getTime() - now.getTime();
	if (diffMs <= 0) return "segera";
	const diffMins = Math.round(diffMs / (60 * 1000));
	if (diffMins < 1) return "< 1 mnt";
	if (diffMins < 60) return `${diffMins} mnt`;
	const diffHours = Math.round(diffMs / (60 * 60 * 1000));
	if (diffHours < 24) return `${diffHours} jam`;
	const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
	if (diffDays < 30) return `${diffDays} hr`;
	if (diffDays < 365) {
		const months = (diffDays / 30.4375).toFixed(1).replace(/\.0$/, "");
		return `${months} bln`;
	}
	const years = (diffDays / 365.25).toFixed(1).replace(/\.0$/, "");
	return `${years} thn`;
}

function stateBadge(state: number): {
	label: string;
	dot: string;
	tone: string;
} {
	switch (state) {
		case 0:
			return {
				label: "Baru",
				dot: "bg-primary",
				tone: "bg-primary/10 text-primary border-primary/20",
			};
		case 1:
			return {
				label: "Belajar",
				dot: "bg-amber-500",
				tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
			};
		case 2:
			return {
				label: "Diingat",
				dot: "bg-emerald-500",
				tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
			};
		case 3:
			return {
				label: "Relearning",
				dot: "bg-rose-500",
				tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
			};
		default:
			return {
				label: "Baru",
				dot: "bg-primary",
				tone: "bg-primary/10 text-primary border-primary/20",
			};
	}
}

export function EkspedisiCard({
	card,
	ttsEnabled,
	onReviewComplete,
}: EkspedisiCardProps) {
	const [isFlipped, setIsFlipped] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [coinFeedback, setCoinFeedback] = useState<number | null>(null);

	// Autoplay pengucapan kata depan saat kartu tampil pertama kali
	useEffect(() => {
		if (!ttsEnabled) return;
		void speak(card.front, "en-US");
	}, [card.front, ttsEnabled]);

	const nowForPreview = new Date();
	const preview = fsrsEngine.repeat(card, nowForPreview);
	const parsed = parseBackContent(card.back);
	const bandMeta = getBandMeta(card.category || "general");
	const memoryState = stateBadge(card.state);

	const handleFlip = useCallback(() => {
		setIsFlipped(true);
	}, []);

	const handleReview = useCallback(
		async (rating: Rating) => {
			if (isSubmitting) return;
			setIsSubmitting(true);

			const now = new Date();
			const schedulingRecords = fsrsEngine.repeat(card, now);
			const nextCardState =
				schedulingRecords[rating as Exclude<Rating, Rating.Manual>].card;

			try {
				await db.transaction("rw", db.cards, async () => {
					await db.cards.update(card.id, {
						due: nextCardState.due,
						state: nextCardState.state,
						stability: nextCardState.stability,
						difficulty: nextCardState.difficulty,
						elapsed_days: nextCardState.elapsed_days,
						scheduled_days: nextCardState.scheduled_days,
						learning_steps: nextCardState.learning_steps,
						reps: nextCardState.reps,
						lapses: nextCardState.lapses,
						last_review: nextCardState.last_review,
					});
				});

				const award = await awardReview(rating, now);
				setCoinFeedback(award.xpGained);

				// Beri waktu animasi poin terlihat sebelum beralih ke kartu berikutnya
				setTimeout(() => {
					setIsFlipped(false);
					onReviewComplete({ xpGained: award.xpGained, rating });
				}, 450);
			} catch (error) {
				console.error("Gagal menyimpan review:", error);
			} finally {
				setIsSubmitting(false);
			}
		},
		[card, isSubmitting, onReviewComplete],
	);

	// Dukungan shortcut keyboard (Spasi/Enter untuk balik, 1-4 untuk nilai, S untuk audio)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			) {
				return;
			}
			if (e.key === " " || e.key === "Enter") {
				e.preventDefault();
				if (!isFlipped) handleFlip();
			} else if (
				e.key === "s" ||
				e.key === "S" ||
				e.key === "v" ||
				e.key === "V"
			) {
				e.preventDefault();
				void speak(
					isFlipped ? parsed.gloss || card.back : card.front,
					isFlipped ? "id-ID" : "en-US",
				);
			} else if (isFlipped && !isSubmitting) {
				if (e.key === "1") {
					e.preventDefault();
					void handleReview(Rating.Again);
				} else if (e.key === "2") {
					e.preventDefault();
					void handleReview(Rating.Hard);
				} else if (e.key === "3") {
					e.preventDefault();
					void handleReview(Rating.Good);
				} else if (e.key === "4") {
					e.preventDefault();
					void handleReview(Rating.Easy);
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFlipped, isSubmitting, card, parsed.gloss, handleFlip, handleReview]);

	const ratingButtons = [
		{
			rating: Rating.Again,
			keyHint: "1",
			label: RATING_LABELS.again,
			bg: "var(--rating-again-bg)",
			border: "var(--rating-again-border)",
			text: "var(--rating-again-text)",
		},
		{
			rating: Rating.Hard,
			keyHint: "2",
			label: RATING_LABELS.hard,
			bg: "var(--rating-hard-bg)",
			border: "var(--rating-hard-border)",
			text: "var(--rating-hard-text)",
		},
		{
			rating: Rating.Good,
			keyHint: "3",
			label: RATING_LABELS.good,
			bg: "var(--rating-good-bg)",
			border: "var(--rating-good-border)",
			text: "var(--rating-good-text)",
		},
		{
			rating: Rating.Easy,
			keyHint: "4",
			label: RATING_LABELS.easy,
			bg: "var(--rating-easy-bg)",
			border: "var(--rating-easy-border)",
			text: "var(--rating-easy-text)",
		},
	] as const;

	return (
		<div className="w-full max-w-lg md:max-w-xl mx-auto animate-fade-in-up relative select-none">
			{/* Poin XP melayang saat menjawab */}
			{coinFeedback !== null && (
				<div className="absolute -top-4 right-3 z-30 animate-coin-pop pointer-events-none">
					<span className="px-3.5 py-1.5 rounded-pill bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 font-black text-xs sm:text-sm shadow-xl shadow-amber-500/30 inline-flex items-center gap-1.5 border border-amber-300/40">
						<Icon name="star" className="w-4 h-4 fill-amber-950" />+
						{coinFeedback} XP
					</span>
				</div>
			)}

			{/* Kartu Utama dengan 3D Perspective & Proporsi Alami */}
			<div
				className="relative w-full h-[280px] xs:h-[300px] sm:h-[325px] md:h-[345px] max-h-[48dvh] bg-surface rounded-[20px] sm:rounded-[26px] border border-edge/80 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.06),0_8px_10px_-6px_rgba(0,0,0,0.04)] dark:shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7)] transition-all duration-300 overflow-hidden"
				style={{ perspective: "1400px" }}
			>
				<div
					className={`flip-card-inner w-full h-full ${isFlipped ? "flipped" : ""}`}
				>
					{/* ======================================================== */}
					{/* biome-ignore lint/a11y/noStaticElementInteractions: flashcard face container click-to-flip */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: handled via window keydown listener and action button */}
					<div
						onClick={() => {
							if (!isFlipped) handleFlip();
						}}
						className="flip-card-front absolute inset-0 flex flex-col justify-between p-4 sm:p-5 md:p-6 bg-surface cursor-pointer overflow-hidden"
					>
						{/* Header Metadata Bar */}
						<div className="flex items-center justify-between gap-3 shrink-0">
							<div className="flex items-center gap-2">
								<span
									className={`inline-block font-mono text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-[6px] ${bandMeta.colorClass}`}
								>
									{bandMeta.title}
								</span>
								<span
									className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill border ${memoryState.tone}`}
								>
									<span
										className={`w-1.5 h-1.5 rounded-full ${memoryState.dot}`}
									/>
									{memoryState.label}
								</span>
							</div>

							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									void speak(card.front, "en-US");
								}}
								aria-label="Dengarkan pengucapan kata"
								title="Dengarkan pengucapan (Tekan S)"
								className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-full bg-surface-2 border border-edge/60 text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/10 active:scale-95 transition-all shadow-2xs"
							>
								<Icon name="volume" className="w-4 h-4" />
							</button>
						</div>

						{/* Area Tengah: Kata Kosakata Utama */}
						<div className="flex-1 flex flex-col items-center justify-center text-center px-2 py-2 my-auto min-h-0">
							<h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-ink leading-tight max-w-lg break-words tracking-tight select-all">
								{card.front}
							</h2>
						</div>

						{/* Tombol Aksi Bawah */}
						{!isFlipped && (
							<div className="pt-1.5 shrink-0">
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										handleFlip();
									}}
									className="w-full py-3 sm:py-3.5 px-4 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary-hover hover:to-indigo-700 text-white text-sm sm:text-base font-extrabold rounded-control active:scale-[0.98] transition-all tactile-btn flex items-center justify-between shadow-md shadow-primary/25 group"
								>
									<span className="flex items-center gap-2">
										<Icon name="sparkles" className="w-4 h-4 text-white/90" />
										<span>Lihat Artinya</span>
									</span>
									<span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold bg-white/20 px-2 py-0.5 rounded-md text-white/95 backdrop-blur-xs group-hover:translate-x-0.5 transition-transform">
										<span>Spasi ␣</span>
										<Icon name="arrow-right" className="w-3.5 h-3.5" />
									</span>
								</button>
							</div>
						)}
					</div>

					{/* ======================================================== */}
					{/* SISI BELAKANG (Arti, POS, Contoh & Tombol Ulasan FSRS)    */}
					{/* ======================================================== */}
					{isFlipped && (
						<div className="flip-card-back absolute inset-0 flex flex-col justify-between p-4 sm:p-5 md:p-6 bg-surface overflow-hidden">
							{/* Header Bar */}
							<div className="pb-2 sm:pb-2.5 border-b border-edge/70 flex items-center justify-between gap-3 shrink-0">
								<div className="flex items-center gap-2 min-w-0">
									<span
										className={`inline-block font-mono text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-[6px] ${bandMeta.colorClass}`}
									>
										{bandMeta.title}
									</span>
									<span className="font-mono text-xs font-bold text-muted truncate bg-surface-2 px-2 py-0.5 rounded-md border border-edge/50">
										{card.front}
									</span>
								</div>

								<button
									type="button"
									onClick={() => void speak(parsed.gloss || card.back, "id-ID")}
									aria-label="Dengarkan terjemahan"
									title="Dengarkan terjemahan (Tekan S)"
									className="w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-full bg-surface-2 border border-edge/60 text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/10 active:scale-95 transition-all shrink-0 shadow-2xs"
								>
									<Icon name="volume" className="w-4 h-4" />
								</button>
							</div>

							{/* Area Tengah: Terjemahan, Kelas Kata & Contoh */}
							<div className="flex-1 flex flex-col justify-center py-2 overflow-y-auto scrollbar-none text-center my-auto min-h-0">
								<p className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted/70 mb-1.5 shrink-0">
									{card.front}
								</p>

								{/* Daftar arti kata dengan label POS */}
								<div className="flex flex-col items-center justify-center gap-1.5 max-w-lg mx-auto w-full px-1">
									{parsed.items.map((item) => (
										<div
											key={`${item.pos ?? "def"}:${item.text}`}
											className="flex flex-wrap items-center justify-center gap-2 py-0.5"
										>
											{item.pos && (
												<span
													title={item.posFull}
													className={`font-mono text-[9.5px] sm:text-[10px] font-black uppercase px-1.5 py-0.5 rounded-[6px] border ${
														item.tone ??
														"bg-surface-2 text-muted border-edge/60"
													} shrink-0 select-none shadow-2xs`}
												>
													{item.posLabel ?? item.pos}
												</span>
											)}
											<span className="text-lg sm:text-2xl md:text-3xl font-black text-ink leading-tight tracking-tight">
												{item.text}
											</span>
										</div>
									))}
								</div>

								{/* Contoh Kalimat (Editorial Quote Block) */}
								{parsed.exampleEn && (
									<div className="mt-2.5 p-2.5 sm:p-3 rounded-r-xl rounded-l-xs bg-surface-2/60 border-l-[3px] border-primary text-left space-y-0.5 shadow-2xs">
										<p className="text-xs sm:text-[12.5px] font-semibold text-ink leading-relaxed">
											"{parsed.exampleEn}"
										</p>
										{parsed.exampleId && (
											<p className="text-[10.5px] sm:text-[11.5px] text-muted leading-snug">
												{parsed.exampleId}
											</p>
										)}
									</div>
								)}
							</div>

							{/* 4 Tombol Ulasan Ergonomis FSRS */}
							<div className="pt-2 grid grid-cols-4 gap-1.5 sm:gap-2 shrink-0">
								{ratingButtons.map((b) => (
									<button
										type="button"
										key={b.label}
										onClick={() => void handleReview(b.rating)}
										disabled={isSubmitting}
										className="relative flex flex-col items-center justify-center gap-0.5 py-2 sm:py-2.5 px-1 border rounded-control transition-all disabled:opacity-50 active:scale-[0.96] tactile-btn shadow-xs hover-lift cursor-pointer"
										style={{
											backgroundColor: b.bg,
											borderColor: b.border,
											color: b.text,
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.borderColor = b.text;
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.borderColor = b.border;
										}}
									>
										<span className="hidden md:inline-block absolute top-1 right-1 text-[9px] font-mono font-bold opacity-60">
											{b.keyHint}
										</span>
										<span className="text-xs sm:text-sm font-extrabold truncate w-full text-center">
											{b.label}
										</span>
										<span
											className="font-mono text-[9px] sm:text-[10px] font-bold opacity-90 truncate w-full text-center"
											style={{ color: b.text }}
										>
											{formatInterval(
												preview[b.rating].card.due,
												nowForPreview,
											)}
										</span>
									</button>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
