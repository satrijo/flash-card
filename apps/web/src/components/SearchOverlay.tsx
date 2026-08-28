/*
 * SearchOverlay — Cari Kata: kamus offline dari ribuan kartu di IndexedDB.
 * Live search (debounce 300ms) di front/back, hasil diurutkan exact →
 * startsWith → contains, tap hasil → TTS en-US.
 */

import { useEffect, useRef, useState } from "react";
import { getBandMeta, parseBackContent } from "../lib/bands";
import { db, type LocalCard } from "../lib/db";
import { speak } from "../lib/tts";
import { Icon } from "./Icon";

function rankOf(front: string, q: string): number {
	const f = front.toLowerCase();
	if (f === q) return 0;
	if (f.startsWith(q)) return 1;
	return 2;
}

function sortResults(cards: LocalCard[], q: string): LocalCard[] {
	return [...cards].sort((a, b) => {
		const ra = rankOf(a.front, q);
		const rb = rankOf(b.front, q);
		if (ra !== rb) return ra - rb;
		if (a.front.length !== b.front.length) {
			return a.front.length - b.front.length;
		}
		return a.front.localeCompare(b.front);
	});
}

export function SearchOverlay({ onClose }: { onClose: () => void }) {
	const [query, setQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [results, setResults] = useState<LocalCard[] | null>(null);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	// Live search — debounce 300ms; scan penuh 23k kartu via Dexie filter.
	useEffect(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2 && selectedCategory === "all") {
			setResults([]);
			setBusy(false);
			return;
		}
		let cancelled = false;
		setBusy(true);
		const timer = window.setTimeout(() => {
			void (async () => {
				const found = await db.cards
					.filter((c) => {
						if (selectedCategory !== "all" && c.category !== selectedCategory) {
							return false;
						}
						if (q.length < 2) return true;
						return (
							c.front.toLowerCase().includes(q) ||
							c.back.toLowerCase().includes(q)
						);
					})
					.toArray();
				if (cancelled) return;
				setResults(
					q.length >= 2
						? sortResults(found, q).slice(0, 40)
						: found.slice(0, 30),
				);
				setBusy(false);
			})();
		}, 250);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [query, selectedCategory]);

	const categories = [
		{ id: "all", label: "Semua" },
		{ id: "inggris-easy", label: "Easy" },
		{ id: "inggris-medium", label: "Medium" },
		{ id: "inggris-advance", label: "Advance" },
		{ id: "inggris-native", label: "Native" },
	];

	return (
		<div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur flex flex-col items-center p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
			<div className="max-w-md w-full mx-auto">
				{/* Header */}
				<div className="flex items-center justify-between mb-4">
					<div className="flex items-center gap-2">
						<Icon name="search" className="w-5 h-5 text-muted" />
						<span className="font-mono text-[11px] font-bold uppercase text-muted">
							Cari Kata
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Tutup"
						className="w-9 h-9 flex items-center justify-center rounded-full bg-surface border border-edge text-muted hover:bg-surface-2 active:scale-95 transition"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>

				{/* Filter Tahap Pills */}
				<div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none mb-2">
					{categories.map((cat) => (
						<button
							key={cat.id}
							type="button"
							onClick={() => setSelectedCategory(cat.id)}
							className={`px-3 py-1 rounded-pill text-xs font-bold transition whitespace-nowrap ${
								selectedCategory === cat.id
									? "bg-primary text-white"
									: "bg-surface border border-edge text-muted hover:text-ink"
							}`}
						>
							{cat.label}
						</button>
					))}
				</div>

				{/* Input pencarian */}
				<div className="relative">
					<Icon
						name="search"
						className="w-5 h-5 text-muted absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
					/>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Cari kata atau artinya…"
						className="w-full pl-11 px-4 py-3 rounded-control border border-edge bg-surface text-ink placeholder:text-muted focus:outline-none focus:border-primary text-base"
					/>
				</div>

				{/* Hasil */}
				<div className="mt-4 space-y-2 max-h-[60dvh] overflow-y-auto overscroll-contain">
					{busy ? (
						<>
							<div className="skeleton h-16 w-full" />
							<div className="skeleton h-16 w-full" />
							<div className="skeleton h-16 w-full" />
						</>
					) : results && results.length > 0 ? (
						results.map((card) => <ResultCard key={card.id} card={card} />)
					) : query.trim().length >= 2 || selectedCategory !== "all" ? (
						<p className="text-sm text-muted text-center py-8">
							Tidak ada kata yang cocok
						</p>
					) : (
						<p className="text-sm text-muted text-center py-8">
							Ketik minimal 2 huruf — cari kata atau artinya
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

function ResultCard({ card }: { card: LocalCard }) {
	const parsed = parseBackContent(card.back);
	const meta = getBandMeta(card.category || "general");

	return (
		<div className="rounded-control border border-edge bg-surface p-4 hover:border-primary/50 transition">
			<div className="flex items-center justify-between gap-3">
				<button
					type="button"
					onClick={() => void speak(card.front, "en-US")}
					aria-label={`Dengarkan ${card.front}`}
					className="flex items-center gap-2 min-w-0 text-left hover:text-primary transition group"
				>
					<span className="text-lg font-extrabold text-ink group-hover:text-primary break-words min-w-0">
						{card.front}
					</span>
					<Icon
						name="volume"
						className="w-4 h-4 text-muted group-hover:text-primary shrink-0"
					/>
				</button>
				<div className="flex items-center gap-1.5 shrink-0">
					{parsed.pos && (
						<span className="font-mono text-[10px] font-bold italic px-1.5 py-0.5 rounded bg-surface-2 text-muted">
							{parsed.pos}
						</span>
					)}
					<span
						className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded-[8px] ${meta.colorClass}`}
					>
						{meta.title}
					</span>
				</div>
			</div>
			<p className="text-sm font-semibold text-ink mt-1.5">{parsed.gloss}</p>
			{parsed.exampleEn && (
				<div className="mt-2 p-2.5 rounded bg-surface-2/60 border border-edge/60 text-xs">
					<p className="font-medium text-ink">"{parsed.exampleEn}"</p>
					{parsed.exampleId && (
						<p className="text-muted mt-0.5">{parsed.exampleId}</p>
					)}
				</div>
			)}
		</div>
	);
}
