/*
 * DESIGN READ: Systems Architecture — Neuform Featured, Meng To
 * Dark card, lime reveal, purple/accent ratings, JetBrains Mono badges.
 *
 * DIALS: DESIGN_VARIANCE=8, MOTION_INTENSITY=6, VISUAL_DENSITY=7
 * MOTION: Card flip (CSS 3D transform, motivated - reveals answer), tactile active states
 * SHAPE: rounded-[8px] cards, consistent radius language
 * INTERACTION: Tactile :active scale-[0.98], no duplicate CTA intent
 */

import { useState } from "react";
import { fsrsEngine, Rating } from "@flashcard/shared";
import { db, type LocalCard } from "../lib/db";

interface ReviewCardProps {
  card: LocalCard;
  onReviewComplete: () => void;
}

function formatInterval(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime();
  if (diffMs < 60 * 1000) return "< 1m";
  if (diffMs < 60 * 60 * 1000) return `~${Math.round(diffMs / (60 * 1000))}m`;
  if (diffMs < 24 * 60 * 60 * 1000) return `~${Math.round(diffMs / (60 * 60 * 1000))}h`;
  return `~${Math.round(diffMs / (24 * 60 * 60 * 1000))}d`;
}

export function ReviewCard({ card, onReviewComplete }: ReviewCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Preview FSRS scheduling for all ratings
  const nowForPreview = new Date();
  const preview = fsrsEngine.repeat(card, nowForPreview);

  const handleReview = async (rating: Rating) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const now = new Date();
    const schedulingRecords = fsrsEngine.repeat(card, now);
    const nextCardState = schedulingRecords[rating as Exclude<Rating, Rating.Manual>].card;

    try {
      await db.transaction("rw", db.cards, db.syncQueue, async () => {
        await db.cards.update(card.id, {
          due: nextCardState.due,
          state: nextCardState.state,
          stability: nextCardState.stability,
          difficulty: nextCardState.difficulty,
          elapsed_days: nextCardState.elapsed_days,
          scheduled_days: nextCardState.scheduled_days,
          reps: nextCardState.reps,
          lapses: nextCardState.lapses,
          last_review: nextCardState.last_review,
        });

        await db.syncQueue.add({
          action: "REVIEW_CARD",
          payload: {
            id: card.id,
            nextState: nextCardState,
          },
        });
      });

      setIsFlipped(false);
      onReviewComplete();
    } catch (error) {
      console.error("Failed to save review:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full animate-fade-in-up">
      {/* Card container with flip perspective */}
      <div
        className="relative bg-[#0a0a0a] rounded-[8px] border border-[#4C4C4C] overflow-hidden"
        style={{ perspective: "1000px" }}
      >
        <div
          className={`flip-card-inner ${isFlipped ? "flipped" : ""}`}
          style={{ minHeight: "320px" }}
        >
          {/* Front — Question */}
          <div className="flip-card-front absolute inset-0 flex flex-col p-8">
            {/* Category badge */}
            <div className="mb-4">
              <span className="inline-block font-mono text-[12px] font-semibold uppercase tracking-wide px-2 py-1 rounded-[8px] bg-[#4330C2] text-white">
                {card.category || "general"}
              </span>
            </div>

            <div className="flex-1 flex items-center justify-center">
              <h2 className="text-2xl md:text-3xl font-medium text-white text-center leading-tight max-w-lg">
                {card.front}
              </h2>
            </div>

            {/* Reveal button — lime */}
            {!isFlipped && (
              <div className="pt-6">
                <button
                  onClick={() => setIsFlipped(true)}
                  className="w-full py-3.5 bg-[#C7F300] text-[#050505] text-sm font-semibold rounded-[8px] hover:bg-[#d4f733] active:scale-[0.98] transition-all tactile-btn"
                >
                  Show answer
                </button>
              </div>
            )}
          </div>

          {/* Back — Answer */}
          {isFlipped && (
            <div className="flip-card-back absolute inset-0 flex flex-col p-8">
              {/* Category badge + question (dimmed) */}
              <div className="pb-4 border-b border-[#4C4C4C]">
                <span className="inline-block font-mono text-[12px] font-semibold uppercase tracking-wide px-2 py-1 rounded-[8px] bg-[#4330C2] text-white mb-2">
                  {card.category || "general"}
                </span>
                <p className="text-sm text-[#A1A1AA] font-medium">{card.front}</p>
              </div>

              {/* Answer */}
              <div className="flex-1 flex items-center justify-center py-6">
                <p className="text-xl text-white text-center leading-relaxed whitespace-pre-wrap max-w-lg">
                  {card.back}
                </p>
              </div>

              {/* Rating buttons */}
              <div className="pt-4 grid grid-cols-4 gap-2">
                {/* Again — red accent */}
                <button
                  onClick={() => handleReview(Rating.Again)}
                  disabled={isSubmitting}
                  className="flex flex-col items-center gap-1 py-3 px-2 bg-[#1a0a0a] hover:bg-[#2a1010] border border-[#4C2020] rounded-[8px] transition-all disabled:opacity-50 active:scale-[0.98] tactile-btn"
                >
                  <span className="text-sm font-semibold text-[#ff6b6b]">Again</span>
                  <span className="font-mono text-[12px] font-semibold text-[#ff6b6b]/60">
                    {formatInterval(preview[Rating.Again].card.due, nowForPreview)}
                  </span>
                </button>

                {/* Hard — amber */}
                <button
                  onClick={() => handleReview(Rating.Hard)}
                  disabled={isSubmitting}
                  className="flex flex-col items-center gap-1 py-3 px-2 bg-[#1a1508] hover:bg-[#2a2010] border border-[#4C3C20] rounded-[8px] transition-all disabled:opacity-50 active:scale-[0.98] tactile-btn"
                >
                  <span className="text-sm font-semibold text-[#fbbf24]">Hard</span>
                  <span className="font-mono text-[12px] font-semibold text-[#fbbf24]/60">
                    {formatInterval(preview[Rating.Hard].card.due, nowForPreview)}
                  </span>
                </button>

                {/* Good — lime (primary) */}
                <button
                  onClick={() => handleReview(Rating.Good)}
                  disabled={isSubmitting}
                  className="flex flex-col items-center gap-1 py-3 px-2 bg-[#0a1a08] hover:bg-[#102a10] border border-[#2C4C20] rounded-[8px] transition-all disabled:opacity-50 active:scale-[0.98] tactile-btn"
                >
                  <span className="text-sm font-semibold text-[#C7F300]">Good</span>
                  <span className="font-mono text-[12px] font-semibold text-[#C7F300]/60">
                    {formatInterval(preview[Rating.Good].card.due, nowForPreview)}
                  </span>
                </button>

                {/* Easy — purple (secondary/accent) */}
                <button
                  onClick={() => handleReview(Rating.Easy)}
                  disabled={isSubmitting}
                  className="flex flex-col items-center gap-1 py-3 px-2 bg-[#0a081a] hover:bg-[#10102a] border border-[#30204C] rounded-[8px] transition-all disabled:opacity-50 active:scale-[0.98] tactile-btn"
                >
                  <span className="text-sm font-semibold text-[#8b7cf0]">Easy</span>
                  <span className="font-mono text-[12px] font-semibold text-[#8b7cf0]/60">
                    {formatInterval(preview[Rating.Easy].card.due, nowForPreview)}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
