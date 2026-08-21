/*
 * DESIGN READ: Systems Architecture — Neuform Featured, Meng To
 * Dark theme, bento category grid, lime/purple accents.
 *
 * DIALS: DESIGN_VARIANCE=8, MOTION_INTENSITY=6, VISUAL_DENSITY=7
 * LAYOUT: Hero (64px display) → bento category pills → card grid → create form
 * HERO: "Structure dictates function." — display-lg Inter, left-aligned
 * BENTO: Category pill toggles with dueCount per category
 * CARD GRID: 2-col, category badge (JetBrains Mono 12px/600), hover-lift
 * CREATE: Offline-first inline form, writes to Dexie via createEmptyCard
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState, useMemo, useCallback } from "react";
import { createEmptyCard } from "@flashcard/shared";
import { api } from "../lib/api";
import { db, type LocalCard } from "../lib/db";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const localCards = useLiveQuery(() => db.cards.toArray());
  const dueCount = useLiveQuery(
    () => db.cards.where("due").below(new Date()).count(),
    [],
  );
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const categories = useMemo(() => {
    if (!localCards) return [];
    const fromCards = new Set(localCards.map((c) => c.category || "general"));
    return Array.from(fromCards).sort((a, b) => {
      if (a === "general") return -1;
      if (b === "general") return 1;
      return a.localeCompare(b);
    });
  }, [localCards]);

  // Due count per category
  const dueCountByCategory = useLiveQuery(async () => {
    const allDue = await db.cards.where("due").below(new Date()).toArray();
    const map: Record<string, number> = {};
    for (const card of allDue) {
      const cat = card.category || "general";
      map[cat] = (map[cat] || 0) + 1;
    }
    return map;
  }, []);

  // Filtered cards
  const filteredCards = useMemo(() => {
    if (!localCards) return undefined;
    if (activeCategory === "all") return localCards;
    return localCards.filter((c) => c.category === activeCategory);
  }, [localCards, activeCategory]);

  // Due count for filtered view
  const filteredDueCount = useMemo(() => {
    if (!dueCountByCategory) return 0;
    if (activeCategory === "all") return dueCount ?? 0;
    return dueCountByCategory[activeCategory] ?? 0;
  }, [dueCountByCategory, activeCategory, dueCount]);

  const syncFromServer = useCallback(async () => {
    try {
      const res = await api.api.cards.$get();
      const serverCards = await res.json();
      await db.cards.bulkPut(serverCards as unknown as LocalCard[]);
    } catch (error) {
      console.error("Sync failed:", error);
    }
  }, []);

  return (
    <div className="py-12">
      {/* ===== Hero Section ===== */}
      <section className="mb-20">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 items-start">
          {/* Left: display heading + subtext + CTAs */}
          <div className="lg:col-span-3 space-y-6">
            <h1 className="text-5xl md:text-6xl lg:text-[64px] font-medium leading-[1.04] tracking-normal text-white animate-masked-reveal">
              Structure dictates
              <br />
              function.
            </h1>
            <p className="text-base text-[#A1A1AA] leading-relaxed max-w-lg animate-fade-in-up stagger-1">
              Offline-first spaced repetition with category-driven organization.
              Study anywhere, sync when connected.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2 animate-fade-in-up stagger-2">
              {/* Primary CTA — lime */}
              <Link
                to="/review"
                search={{ category: activeCategory !== "all" ? activeCategory : undefined }}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#C7F300] text-[#050505] text-sm font-semibold rounded-[8px] hover:bg-[#d4f733] active:scale-[0.98] transition-all tactile-btn"
              >
                Review
                {filteredDueCount > 0 && (
                  <span className="px-2 py-0.5 bg-[#050505]/20 rounded-full text-xs font-mono font-semibold">
                    {filteredDueCount}
                  </span>
                )}
              </Link>

              {/* Secondary CTA — purple */}
              <button
                onClick={syncFromServer}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#4330C2] text-white text-sm font-semibold rounded-[8px] hover:bg-[#5544d4] active:scale-[0.98] transition-all tactile-btn"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                </svg>
                Sync
              </button>

              {/* Tertiary — create card */}
              <button
                onClick={() => setShowCreateForm((v) => !v)}
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#4C4C4C] text-[#A1A1AA] text-sm font-semibold rounded-[8px] hover:border-[#C7F300] hover:text-[#C7F300] active:scale-[0.98] transition-all tactile-btn"
              >
                {showCreateForm ? "Close" : "Create Card"}
              </button>
            </div>
          </div>

          {/* Right: decorative stat panel */}
          <div className="lg:col-span-2 hidden lg:block animate-fade-in-up stagger-3">
            <div className="rounded-[8px] border border-[#4C4C4C] bg-[#0a0a0a] p-6 space-y-4">
              <p className="font-mono text-[12px] font-semibold uppercase tracking-widest text-[#A1A1AA]">
                Cognitive Engine
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-3xl font-medium text-white">
                    {localCards?.length ?? "—"}
                  </p>
                  <p className="font-mono text-[12px] font-semibold text-[#A1A1AA] uppercase tracking-wide">
                    Total cards
                  </p>
                </div>
                <div>
                  <p className="text-3xl font-medium text-[#C7F300]">
                    {dueCount ?? "—"}
                  </p>
                  <p className="font-mono text-[12px] font-semibold text-[#A1A1AA] uppercase tracking-wide">
                    Due now
                  </p>
                </div>
                <div>
                  <p className="text-3xl font-medium text-[#4330C2]">
                    {categories.length}
                  </p>
                  <p className="font-mono text-[12px] font-semibold text-[#A1A1AA] uppercase tracking-wide">
                    Categories
                  </p>
                </div>
                <div>
                  <p className="text-3xl font-medium text-white">
                    {localCards ? Math.round((localCards.length - (dueCount ?? 0)) / Math.max(localCards.length, 1) * 100) : "—"}%
                  </p>
                  <p className="font-mono text-[12px] font-semibold text-[#A1A1AA] uppercase tracking-wide">
                    Retained
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Inline Create Card Form ===== */}
      {showCreateForm && (
        <CreateCardForm
          categories={categories}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {/* ===== Bento Category Filter ===== */}
      <section className="mb-12">
        <h2 className="font-mono text-[12px] font-semibold uppercase tracking-widest text-[#A1A1AA] mb-4">
          Accuracy you can measure.
        </h2>
        <div className="flex flex-wrap gap-2">
          {/* "All" pill */}
          <button
            onClick={() => setActiveCategory("all")}
            className={`px-4 py-2 rounded-full font-mono text-[12px] font-semibold uppercase tracking-wide transition-all tactile-btn ${
              activeCategory === "all"
                ? "bg-[#C7F300] text-[#050505]"
                : "border border-[#4C4C4C] text-[#A1A1AA] hover:border-[#A1A1AA] hover:text-white"
            }`}
          >
            All
            {dueCount !== undefined && dueCount > 0 && (
              <span className="ml-2 opacity-70">{dueCount}</span>
            )}
          </button>

          {/* Category pills */}
          {categories.map((cat, i) => {
            const catDue = dueCountByCategory?.[cat] ?? 0;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full font-mono text-[12px] font-semibold uppercase tracking-wide transition-all tactile-btn animate-fade-in-up stagger-${Math.min(i + 1, 8)} ${
                  activeCategory === cat
                    ? "bg-[#C7F300] text-[#050505]"
                    : "border border-[#4C4C4C] text-[#A1A1AA] hover:border-[#A1A1AA] hover:text-white"
                }`}
              >
                {cat}
                {catDue > 0 && (
                  <span className="ml-2 opacity-70">{catDue}</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ===== Card Grid Section ===== */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {activeCategory === "all" ? "Your cards" : activeCategory}
          </h2>
          {filteredCards !== undefined && filteredCards.length > 0 && (
            <span className="font-mono text-[12px] font-semibold text-[#A1A1AA] uppercase tracking-wide">
              {filteredCards.length} total
            </span>
          )}
        </div>

        {/* Loading state — dark skeletons */}
        {filteredCards === undefined && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-6 bg-[#0a0a0a] rounded-[8px] border border-[#4C4C4C]">
                <div className="skeleton h-5 w-3/4 mb-3" />
                <div className="skeleton h-4 w-full mb-2" />
                <div className="skeleton h-4 w-2/3" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {filteredCards !== undefined && filteredCards.length === 0 && (
          <div className="text-center py-16 px-6">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#4C4C4C]/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-[#A1A1AA]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">
              {activeCategory === "all" ? "No cards yet" : `No cards in "${activeCategory}"`}
            </h3>
            <p className="text-sm text-[#A1A1AA] mb-6 max-w-sm mx-auto">
              {activeCategory === "all"
                ? "Sync from the cloud to pull your cards, or create one to get started."
                : "Create a card in this category or select a different one."}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={syncFromServer}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#C7F300] text-[#050505] text-sm font-semibold rounded-[8px] hover:bg-[#d4f733] active:scale-[0.98] transition-all tactile-btn"
              >
                Sync from Cloud
              </button>
            </div>
          </div>
        )}

        {/* Card grid — 2 col, hover-lift, category badge */}
        {filteredCards !== undefined && filteredCards.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredCards.map((card, i) => (
              <Link
                key={card.id}
                to="/review"
                search={{ category: card.category !== "general" ? card.category : undefined }}
                className={`group block p-6 bg-[#0a0a0a] rounded-[8px] border border-[#4C4C4C] hover-lift hover:border-[#A1A1AA] transition-colors animate-fade-in-up stagger-${Math.min(i + 1, 8)}`}
              >
                {/* Category badge */}
                <span className="inline-block font-mono text-[12px] font-semibold uppercase tracking-wide px-2 py-1 rounded-[8px] bg-[#4330C2] text-white mb-3">
                  {card.category || "general"}
                </span>
                <h3 className="font-medium text-white text-base leading-snug mb-2 line-clamp-2">
                  {card.front}
                </h3>
                <p className="text-sm text-[#A1A1AA] leading-relaxed line-clamp-2">
                  {card.back}
                </p>
                {/* Due indicator */}
                {card.due <= new Date() && (
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#C7F300] animate-pulse" />
                    <span className="font-mono text-[12px] font-semibold text-[#C7F300] uppercase tracking-wide">
                      Due
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ===== Bottom decorative section ===== */}
      <section className="mt-20 mb-8 border-t border-[#4C4C4C] pt-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="font-mono text-[12px] font-semibold uppercase tracking-widest text-[#C7F300] mb-2">
              Logic emerges from patterns
            </h3>
            <p className="text-sm text-[#A1A1AA] leading-relaxed">
              Every card is scheduled by FSRS — an algorithm that adapts to your memory, not the other way around.
            </p>
          </div>
          <div>
            <h3 className="font-mono text-[12px] font-semibold uppercase tracking-widest text-[#4330C2] mb-2">
              Engineered for scale
            </h3>
            <p className="text-sm text-[#A1A1AA] leading-relaxed">
              Categories organize knowledge into domains. Study languages, sciences, or anything — one system, infinite subjects.
            </p>
          </div>
          <div>
            <h3 className="font-mono text-[12px] font-semibold uppercase tracking-widest text-[#C7F300] mb-2">
              Offline-first architecture
            </h3>
            <p className="text-sm text-[#A1A1AA] leading-relaxed">
              Create and review cards without connectivity. Background sync preserves every mutation to the cloud.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ===== Create Card Form Component ===== */

interface CreateCardFormProps {
  categories: string[];
  onClose: () => void;
}

function CreateCardForm({ categories, onClose }: CreateCardFormProps) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [category, setCategory] = useState("general");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;

    setIsSubmitting(true);
    try {
      const emptyCard = createEmptyCard();
      const now = new Date();
      const newCard: LocalCard = {
        id: crypto.randomUUID(),
        front: front.trim(),
        back: back.trim(),
        category: category.trim() || "general",
        ...emptyCard,
        due: now,
        last_review: undefined,
      };

      await db.cards.add(newCard);

      // Reset form
      setFront("");
      setBack("");
      setCategory("general");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (error) {
      console.error("Failed to create card:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mb-12 animate-fade-in-up">
      <div className="rounded-[8px] border border-[#4C4C4C] bg-[#0a0a0a] p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-mono text-[12px] font-semibold uppercase tracking-widest text-[#C7F300]">
            Create new card
          </h2>
          <button
            onClick={onClose}
            className="text-[#A1A1AA] hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Front */}
            <div>
              <label className="block font-mono text-[12px] font-semibold uppercase tracking-wide text-[#A1A1AA] mb-2">
                Front
              </label>
              <textarea
                value={front}
                onChange={(e) => setFront(e.target.value)}
                placeholder="Question or prompt..."
                rows={3}
                className="w-full px-4 py-3 bg-[#050505] border border-[#4C4C4C] rounded-[8px] text-white text-sm placeholder:text-[#4C4C4C] focus:outline-none focus:border-[#C7F300] transition-colors resize-none"
                required
              />
            </div>

            {/* Back */}
            <div>
              <label className="block font-mono text-[12px] font-semibold uppercase tracking-wide text-[#A1A1AA] mb-2">
                Back
              </label>
              <textarea
                value={back}
                onChange={(e) => setBack(e.target.value)}
                placeholder="Answer or explanation..."
                rows={3}
                className="w-full px-4 py-3 bg-[#050505] border border-[#4C4C4C] rounded-[8px] text-white text-sm placeholder:text-[#4C4C4C] focus:outline-none focus:border-[#C7F300] transition-colors resize-none"
                required
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block font-mono text-[12px] font-semibold uppercase tracking-wide text-[#A1A1AA] mb-2">
              Category
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="category-suggestions"
                placeholder="general"
                className="flex-1 px-4 py-3 bg-[#050505] border border-[#4C4C4C] rounded-[8px] text-white text-sm placeholder:text-[#4C4C4C] focus:outline-none focus:border-[#C7F300] transition-colors"
              />
              <datalist id="category-suggestions">
                {categories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>

              <button
                type="submit"
                disabled={isSubmitting || !front.trim() || !back.trim()}
                className="px-6 py-3 bg-[#C7F300] text-[#050505] text-sm font-semibold rounded-[8px] hover:bg-[#d4f733] active:scale-[0.98] transition-all tactile-btn disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Saving..." : success ? "Saved!" : "Add Card"}
              </button>
            </div>
          </div>

          {success && (
            <p className="font-mono text-[12px] font-semibold text-[#C7F300] uppercase tracking-wide animate-fade-in-up">
              Card created — stored locally, will sync when online.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
