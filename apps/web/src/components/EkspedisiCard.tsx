/*
 * EkspedisiCard — kartu flip depan(kata EN)/belakang(arti ID).
 * TTS: autoplay kata depan saat muncul (jika suara aktif),
 * tombol speaker di dua sisi. Rating playful: Ulang/Susah/Oke/Gampang
 * dengan hint interval hasil FSRS + keyboard shortcuts (Space/1/2/3/4/S).
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

function formatInterval(due: Date, now: Date): string {
	const diffMs = due.getTime() - now.getTime();
	if (diffMs < 60 * 1000) return "< 1 mnt";
	if (diffMs < 60 * 60 * 1000)
		return `~${Math.round(diffMs / (60 * 1000))} mnt`;
	if (diffMs < 24 * 60 * 60 * 1000)
		return `~${Math.round(diffMs / (60 * 60 * 1000))} jam`;
	return `~${Math.round(diffMs / (24 * 60 * 60 * 1000))} hari`;
}

function stateBadge(state: number): { label: string; tone: string } {
	switch (state) {
		case 0:
			return { label: "Baru", tone: "bg-primary/10 text-primary" };
		case 1:
			return { label: "Belajar", tone: "bg-accent/15 text-accent-ink" };
		case 2:
			return { label: "Diingat", tone: "bg-success/10 text-success" };
		case 3:
			return { label: "Relearning", tone: "bg-danger/10 text-danger" };
		default:
			return { label: "Baru", tone: "bg-primary/10 text-primary" };
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

	// Autoplay pengucapan kata depan saat kartu tampil.
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

				// Beri waktu animasi poin terlihat sebelum pindah kartu.
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

	// Dukungan keyboard shortcuts (Space/Enter to flip, 1-4 for ratings, S for audio)
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
					isFlipped ? card.back : card.front,
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
	}, [isFlipped, isSubmitting, card, handleFlip, handleReview]);

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
		<div className="w-full animate-fade-in-up relative">
			{/* Poin melayang saat menjawab */}
			{coinFeedback !== null && (
				<span className="absolute top-0 right-2 z-10 animate-coin-pop pointer-events-none">
					<span className="px-3 py-1 rounded-pill bg-accent text-accent-ink font-extrabold text-sm shadow-md inline-flex items-center gap-1">
						<Icon name="star" className="w-4 h-4" />+{coinFeedback}
					</span>
				</span>
			)}

			<div
				className="relative bg-surface rounded-card border border-edge overflow-hidden shadow-sm hover-lift"
				style={{ perspective: "1200px" }}
			>
				<div
					className={`flip-card-inner ${isFlipped ? "flipped" : ""}`}
					style={{ minHeight: "400px" }}
				>
					{/* Depan — kata Inggris */}
					<div className="flip-card-front absolute inset-0 flex flex-col p-6 md:p-8">
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-2">
								<span
									className={`inline-block font-mono text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-[8px] ${bandMeta.colorClass}`}
								>
									{bandMeta.title}
								</span>
								<span
									className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill ${memoryState.tone}`}
								>
									{memoryState.label}
								</span>
							</div>
							<button
								type="button"
								onClick={() => void speak(card.front, "en-US")}
								aria-label="Dengarkan pengucapan kata"
								title="Dengarkan pengucapan (Tekan S)"
								className="w-11 h-11 inline-flex items-center justify-center rounded-full bg-surface-2 text-muted hover:text-primary active:scale-95 transition-transform"
							>
								<Icon name="volume" className="w-5 h-5" />
							</button>
						</div>

						<div className="flex-1 flex flex-col items-center justify-center text-center px-2">
							<h2 className="text-3xl md:text-5xl font-extrabold text-ink leading-tight max-w-lg break-words tracking-tight">
								{card.front}
							</h2>
							<p className="text-xs text-muted mt-3 font-medium hidden md:block">
								Tekan <span className="kbd-hint">Spasi</span> untuk melihat arti
							</p>
						</div>

						{!isFlipped && (
							<div className="pt-4">
								<button
									type="button"
									onClick={handleFlip}
									className="w-full py-4 bg-primary text-white text-base font-bold rounded-control hover:bg-primary-hover active:scale-[0.98] transition-all tactile-btn inline-flex items-center justify-center gap-2 shadow"
								>
									Lihat artinya
									<Icon name="arrow-right" className="w-5 h-5" />
								</button>
							</div>
						)}
					</div>

					{/* Belakang — terjemahan & contoh */}
					{isFlipped && (
						<div className="flip-card-back absolute inset-0 flex flex-col p-6 md:p-8">
							<div className="pb-3 border-b border-edge flex items-center justify-between">
								<div className="flex items-center gap-2 min-w-0">
									<span
										className={`inline-block font-mono text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-[8px] ${bandMeta.colorClass}`}
									>
										{bandMeta.title}
									</span>
									{parsed.pos && (
										<span className="font-mono text-[11px] font-bold italic px-2 py-0.5 rounded-[6px] bg-surface-2 text-muted">
											{parsed.pos}
										</span>
									)}
								</div>
								<button
									type="button"
									onClick={() => void speak(parsed.gloss, "id-ID")}
									aria-label="Dengarkan terjemahan"
									className="w-10 h-10 inline-flex items-center justify-center rounded-full bg-surface-2 text-muted hover:text-primary active:scale-95 transition-transform shrink-0"
								>
									<Icon name="volume" className="w-5 h-5" />
								</button>
							</div>

							<div className="flex-1 flex flex-col justify-center py-3 overflow-y-auto overscroll-contain text-center">
								<p className="text-xs font-mono font-bold uppercase tracking-widest text-muted mb-1">
									{card.front}
								</p>
								<p className="text-2xl md:text-3xl font-extrabold text-ink leading-snug break-words">
									{parsed.gloss}
								</p>

								{/* Contoh kalimat jika ada */}
								{parsed.exampleEn && (
									<div className="mt-4 p-3 rounded-control bg-surface-2/60 border border-edge/60 text-left">
										<p className="text-[13px] font-semibold text-ink leading-relaxed">
											"{parsed.exampleEn}"
										</p>
										{parsed.exampleId && (
											<p className="text-[12px] text-muted mt-0.5">
												{parsed.exampleId}
											</p>
										)}
									</div>
								)}
							</div>

							<div className="pt-2 grid grid-cols-4 gap-2">
								{ratingButtons.map((b) => (
									<button
										type="button"
										key={b.label}
										onClick={() => void handleReview(b.rating)}
										disabled={isSubmitting}
										className="relative flex flex-col items-center justify-center gap-0.5 py-3 px-1 border rounded-control transition-all disabled:opacity-50 active:scale-[0.97] tactile-btn"
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
										<span className="text-sm font-extrabold">{b.label}</span>
										<span
											className="font-mono text-[10px] font-semibold"
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
