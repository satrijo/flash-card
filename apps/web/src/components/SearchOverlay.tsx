import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
	const [mounted, setMounted] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setMounted(true);
		inputRef.current?.focus();
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	// Live search — debounce 200ms; hanya mencari saat query >= 2 huruf
	useEffect(() => {
		const q = query.trim().toLowerCase();
		if (q.length < 2) {
			setResults(null);
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
						return (
							c.front.toLowerCase().includes(q) ||
							c.back.toLowerCase().includes(q)
						);
					})
					.toArray();
				if (cancelled) return;
				setResults(sortResults(found, q).slice(0, 40));
				setBusy(false);
			})();
		}, 200);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [query, selectedCategory]);

	const categories = [
		{ id: "all", label: "Semua" },
		{ id: "inggris-easy", label: "Easy (A1–A2)" },
		{ id: "inggris-medium", label: "Medium (B1–B2)" },
		{ id: "inggris-advance", label: "Advance (C1)" },
		{ id: "inggris-native", label: "Native (C2)" },
	];

	if (!mounted || typeof document === "undefined") {
		return null;
	}

	return createPortal(
		<div className="fixed inset-0 z-[200] flex flex-col items-center justify-start p-3 sm:p-5 md:p-8 pt-[max(1rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)] animate-fade-in-up">
			{/* Backdrop overlay — klik di luar modal untuk menutup */}
			<button
				type="button"
				aria-label="Tutup pencarian"
				onClick={onClose}
				className="fixed inset-0 bg-black/60 backdrop-blur-md cursor-default z-0"
			/>

			{/* Kontainer Utama Search — Lebar lega di desktop (max-w-3xl), pas di mobile */}
			<div className="relative z-10 max-w-xl md:max-w-2xl lg:max-w-3xl w-full mx-auto flex flex-col flex-1 min-h-0 space-y-3.5 bg-surface p-4 sm:p-6 rounded-2xl border border-edge shadow-2xl overflow-hidden">
				{/* Header dengan Tombol Tutup Proporsional */}
				<div className="flex items-center justify-between pb-1 shrink-0">
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
							<Icon name="search" className="w-4 h-4" />
						</div>
						<span className="font-mono text-xs font-bold uppercase text-ink tracking-wider">
							Kamus & Cari Kata
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Tutup pencarian"
						className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-2 border border-edge text-muted hover:text-ink hover:bg-surface active:scale-95 transition shadow-2xs shrink-0"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>

				{/* Filter Tahap Pills */}
				<div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none shrink-0">
					{categories.map((cat) => (
						<button
							key={cat.id}
							type="button"
							onClick={() => setSelectedCategory(cat.id)}
							className={`px-3 py-1.5 rounded-pill text-xs font-extrabold transition-all whitespace-nowrap ${
								selectedCategory === cat.id
									? "bg-primary text-white shadow-sm shadow-primary/20"
									: "bg-surface-2/80 border border-edge text-muted hover:text-ink hover:bg-surface-2"
							}`}
						>
							{cat.label}
						</button>
					))}
				</div>

				{/* Input pencarian dengan tombol hapus */}
				<div className="relative shrink-0">
					<Icon
						name="search"
						className="w-4.5 h-4.5 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
					/>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Cari kata atau terjemahan…"
						className="w-full pl-10 pr-10 py-3 rounded-control border border-edge bg-surface-2/60 text-ink placeholder:text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm sm:text-base font-medium transition shadow-xs"
					/>
					{query.length > 0 && (
						<button
							type="button"
							onClick={() => {
								setQuery("");
								inputRef.current?.focus();
							}}
							aria-label="Hapus kata kunci"
							className="w-6 h-6 absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-surface text-muted hover:text-ink active:scale-90 transition border border-edge/60 shadow-2xs"
						>
							<Icon name="x" className="w-3 h-3" />
						</button>
					)}
				</div>

				{/* Hasil Pencarian yang Scrollable Natural */}
				<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-2.5 pt-1 pb-2">
					{busy ? (
						<div className="space-y-2.5">
							<div className="skeleton h-16 w-full" />
							<div className="skeleton h-16 w-full" />
							<div className="skeleton h-16 w-full" />
						</div>
					) : query.trim().length < 2 ? (
						<div className="text-center py-12 space-y-2">
							<div className="w-12 h-12 mx-auto rounded-full bg-surface-2 flex items-center justify-center text-primary/80">
								<Icon name="search" className="w-6 h-6" />
							</div>
							<p className="text-sm font-bold text-ink">Cari Kosakata</p>
							<p className="text-xs text-muted max-w-xs mx-auto">
								Ketik minimal 2 huruf untuk mencari kata bahasa Inggris atau
								artinya
							</p>
						</div>
					) : results && results.length > 0 ? (
						<>
							<p className="font-mono text-[11px] font-bold text-muted px-1 pb-1">
								Ditemukan {results.length} kata
							</p>
							{results.map((card) => (
								<ResultCard key={card.id} card={card} />
							))}
						</>
					) : (
						<div className="text-center py-12 space-y-2">
							<div className="w-12 h-12 mx-auto rounded-full bg-surface-2 flex items-center justify-center text-muted">
								<Icon name="search" className="w-6 h-6 opacity-60" />
							</div>
							<p className="text-sm font-bold text-ink">
								Tidak ada kata yang cocok
							</p>
							<p className="text-xs text-muted">
								Coba periksa ejaan atau ganti filter tahap
							</p>
						</div>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}

function ResultCard({ card }: { card: LocalCard }) {
	const parsed = parseBackContent(card.back);
	const meta = getBandMeta(card.category || "general");

	return (
		<div className="rounded-control border border-edge/80 bg-surface p-4 hover:border-primary/40 hover:shadow-xs transition">
			<div className="flex items-center justify-between gap-3">
				<button
					type="button"
					onClick={() => void speak(card.front, "en-US")}
					aria-label={`Dengarkan ${card.front}`}
					className="flex items-center gap-2 min-w-0 text-left hover:text-primary transition group"
				>
					<span className="text-lg font-black text-ink group-hover:text-primary break-words min-w-0 tracking-tight">
						{card.front}
					</span>
					<Icon
						name="volume"
						className="w-4 h-4 text-muted group-hover:text-primary shrink-0"
					/>
				</button>
				<div className="flex items-center gap-1.5 shrink-0">
					<span
						className={`font-mono text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-[6px] ${meta.colorClass}`}
					>
						{meta.title}
					</span>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 mt-2">
				{parsed.items.map((item) => (
					<div
						key={`${item.pos ?? "def"}:${item.text}`}
						className="inline-flex items-center gap-1.5"
					>
						{item.pos && (
							<span
								title={item.posFull}
								className={`font-mono text-[9.5px] font-black uppercase px-1.5 py-0.5 rounded border ${
									item.tone ?? "bg-surface-2 text-muted border-edge/60"
								}`}
							>
								{item.posLabel ?? item.pos}
							</span>
						)}
						<span className="text-sm font-bold text-ink">{item.text}</span>
					</div>
				))}
			</div>
			{parsed.exampleEn && (
				<div className="mt-2.5 p-2.5 rounded-r-lg rounded-l-xs bg-surface-2/60 border-l-2 border-primary text-xs space-y-0.5">
					<p className="font-semibold text-ink">"{parsed.exampleEn}"</p>
					{parsed.exampleId && (
						<p className="text-muted text-[11px]">{parsed.exampleId}</p>
					)}
				</div>
			)}
		</div>
	);
}
