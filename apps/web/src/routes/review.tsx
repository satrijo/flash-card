/*
 * DESIGN READ: Systems Architecture — Neuform Featured, Meng To
 * Dark theme, category-aware review, lime progress bar.
 *
 * DIALS: DESIGN_VARIANCE=8, MOTION_INTENSITY=6, VISUAL_DENSITY=7
 * LAYOUT: Centered single-card focus with category filter
 * STATES: Loading skeleton (dark), empty composed, completed composed
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../lib/db";
import { ReviewCard } from "../components/ReviewCard";

// Validate search params — plain function (no Zod dependency)
function validateSearch(search: Record<string, unknown>) {
  return {
    category:
      typeof search.category === "string" && search.category.length > 0
        ? search.category
        : undefined,
  };
}

export const Route = createFileRoute("/review")({
  validateSearch,
  component: ReviewPage,
});

function ReviewPage() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const { category } = Route.useSearch();

  // Query due cards, optionally filtered by category
  const dueCards = useLiveQuery(async () => {
    const now = new Date();
    let collection = db.cards.where("due").below(now);

    let cards = await collection.toArray();

    if (category) {
      cards = cards.filter((c) => c.category === category);
    }

    return cards.sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [category]);

  // Loading state — dark skeleton
  if (dueCards === undefined) {
    return (
      <div className="py-12 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="skeleton h-4 w-20" />
          <div className="skeleton h-6 w-16 rounded-full" />
        </div>
        <div className="h-1.5 bg-[#4C4C4C] rounded-full mb-8 overflow-hidden">
          <div className="skeleton h-full w-1/4 rounded-full" />
        </div>
        <div className="bg-[#0a0a0a] rounded-[8px] border border-[#4C4C4C] p-8">
          <div className="skeleton h-7 w-3/4 mx-auto mb-4" />
          <div className="skeleton h-5 w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  // Empty state
  if (dueCards.length === 0) {
    return (
      <div className="py-12 max-w-2xl mx-auto text-center">
        <div className="py-16">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#4C4C4C]/30 flex items-center justify-center">
            <svg className="w-10 h-10 text-[#C7F300]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-medium text-white mb-2">All caught up</h1>
          <p className="text-[#A1A1AA] mb-2 max-w-sm mx-auto">
            No cards are due for review right now.
            {category && (
              <>
                {" "}
                <span className="font-mono text-[12px] font-semibold uppercase tracking-wide text-[#4330C2]">
                  {category}
                </span>
              </>
            )}
          </p>
          <p className="text-sm text-[#A1A1AA] mb-8">
            Come back later, create new cards, or sync from cloud.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#C7F300] text-[#050505] text-sm font-semibold rounded-[8px] hover:bg-[#d4f733] active:scale-[0.98] transition-all tactile-btn"
            >
              Back to cards
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Completed state
  if (currentIndex >= dueCards.length) {
    return (
      <div className="py-12 max-w-2xl mx-auto text-center">
        <div className="py-16">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#4330C2]/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-[#4330C2]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-medium text-white mb-2">Session complete</h1>
          <p className="text-[#A1A1AA] mb-2">
            You reviewed {dueCards.length} cards
            {category && (
              <>
                {" "}in{" "}
                <span className="font-mono text-[12px] font-semibold uppercase tracking-wide text-[#4330C2]">
                  {category}
                </span>
              </>
            )}
            .
          </p>
          <p className="text-sm text-[#A1A1AA] mb-8">
            Cards rescheduled by FSRS. Syncing to cloud in the background.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setCurrentIndex(0)}
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#4C4C4C] text-[#A1A1AA] text-sm font-semibold rounded-[8px] hover:border-[#C7F300] hover:text-[#C7F300] active:scale-[0.98] transition-all tactile-btn"
            >
              Repeat session
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#C7F300] text-[#050505] text-sm font-semibold rounded-[8px] hover:bg-[#d4f733] active:scale-[0.98] transition-all tactile-btn"
            >
              Back to cards
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentCard = dueCards[currentIndex];
  const progress = `${currentIndex + 1} / ${dueCards.length}`;
  const progressPercent = ((currentIndex + 1) / dueCards.length) * 100;

  return (
    <div className="py-12 max-w-2xl mx-auto">
      {/* Header — back link + progress badge + category label */}
      <div className="flex items-center justify-between mb-8">
        <Link
          to="/"
          className="font-mono text-[12px] font-semibold text-[#A1A1AA] hover:text-white transition-colors uppercase tracking-wide"
        >
          Back
        </Link>
        <div className="flex items-center gap-3">
          {category && (
            <span className="font-mono text-[12px] font-semibold uppercase tracking-wide px-2 py-1 rounded-[8px] bg-[#4330C2] text-white">
              {category}
            </span>
          )}
          <span className="font-mono text-[12px] font-semibold text-[#A1A1AA] bg-[#0a0a0a] border border-[#4C4C4C] px-3 py-1 rounded-full">
            {progress}
          </span>
        </div>
      </div>

      {/* Progress bar — lime on dark track */}
      <div className="w-full h-1.5 bg-[#4C4C4C] rounded-full mb-8 overflow-hidden">
        <div
          className="h-full bg-[#C7F300] rounded-full progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Review Card */}
      <ReviewCard
        key={currentCard.id}
        card={currentCard}
        onReviewComplete={() => setCurrentIndex((i) => i + 1)}
      />

      {/* Footer note */}
      <p className="text-center font-mono text-[12px] text-[#A1A1AA] mt-6 uppercase tracking-wide">
        Scheduling computed locally via FSRS. Saved atomically to IndexedDB.
      </p>
    </div>
  );
}
