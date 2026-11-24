/*
 * Rute /kelola — Manajemen Deck & Kartu Kosakata.
 * Fitur: Tambah kartu baru (offline-first via createEmptyCard),
 * edit kata/arti/kategori, reset memori SRS, hapus kartu,
 * filter kategori pure-dynamic, sorting cerdas (Terbaru/A-Z/SRS), dan live search.
 */

import { createEmptyCard, normalizeCategory } from "@flashcard/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { BulkAddCardsModal } from "../components/BulkAddCardsModal";
import { Icon } from "../components/Icon";
import { SharedDeckImportModal } from "../components/SharedDeckImportModal";
import { scheduleCloudPush } from "../hooks/useCloudSync";
import { trackEvent } from "../lib/analytics";
import { BAND_ORDER, getBandMeta, parseBackContent } from "../lib/bands";
import { db, type LocalCard } from "../lib/db";
import { speak } from "../lib/tts";

interface KelolaSearch {
	importUser?: string;
}

export const Route = createFileRoute("/kelola")({
	validateSearch: (search: Record<string, unknown>): KelolaSearch => ({
		importUser:
			typeof search.importUser === "string" ? search.importUser : undefined,
	}),
	component: KelolaPage,
});

type SortOption = "created_desc" | "front_asc" | "front_desc" | "due_asc";

function KelolaPage() {
	const searchParams = Route.useSearch();
	const cards = useLiveQuery(() => db.cards.toArray(), []);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [selectedState, setSelectedState] = useState<string>("all");
	const [sortBy, setSortBy] = useState<SortOption>("created_desc");
	const [page, setPage] = useState(1);
	const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
	const [editingCard, setEditingCard] = useState<LocalCard | null>(null);
	const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
	const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
	const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

	// Modal Impor dari Teman / Komunitas
	const [isImportModalOpen, setIsImportModalOpen] = useState(
		Boolean(searchParams.importUser),
	);
	const [importTargetHandle, setImportTargetHandle] = useState(
		searchParams.importUser || "",
	);

	const PAGE_SIZE = 30;

	// Deteksi seluruh kategori unik secara dinamis dari database (Pure Dynamic)
	const { availableCategories, categoryCounts } = useMemo(() => {
		const counts: Record<string, number> = {};
		if (!cards) return { availableCategories: [], categoryCounts: counts };

		const set = new Set<string>();
		for (const c of cards) {
			const cat = normalizeCategory(c.category);
			if (cat) {
				set.add(cat);
				counts[cat] = (counts[cat] || 0) + 1;
			}
		}

		// Standar bands dulu, lalu general, lalu kategori kustom alfabetis
		const standard = BAND_ORDER.filter((b) => set.has(b));
		const others = Array.from(set)
			.filter(
				(b) =>
					!(BAND_ORDER as readonly string[]).includes(b) && b !== "general",
			)
			.sort();
		const hasGeneral = set.has("general");

		const result = [...standard, ...(hasGeneral ? ["general"] : []), ...others];

		return { availableCategories: result, categoryCounts: counts };
	}, [cards]);

	// Filtered & Sorted cards list
	const filteredCards = useMemo(() => {
		if (!cards) return [];
		const q = searchQuery.trim().toLowerCase();
		const now = new Date();

		return cards
			.filter((c) => {
				// Category filter
				if (selectedCategory !== "all") {
					const cat = normalizeCategory(c.category);
					if (cat !== selectedCategory) {
						return false;
					}
				}

				// State filter
				if (selectedState !== "all") {
					if (selectedState === "due") {
						const due = new Date(c.due);
						if (due > now) return false;
					} else if (selectedState === "0" && c.state !== 0) {
						return false;
					} else if (selectedState === "1" && c.state !== 1 && c.state !== 3) {
						return false;
					} else if (selectedState === "2" && c.state !== 2) {
						return false;
					}
				}

				// Search query
				if (q.length > 0) {
					const cat = normalizeCategory(c.category);
					return (
						c.front.toLowerCase().includes(q) ||
						c.back.toLowerCase().includes(q) ||
						cat.includes(q)
					);
				}

				return true;
			})
			.sort((a, b) => {
				if (sortBy === "created_desc") {
					const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
					const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
					if (bTime !== aTime) return bTime - aTime;
					return a.front.localeCompare(b.front);
				}
				if (sortBy === "front_asc") {
					return a.front.localeCompare(b.front);
				}
				if (sortBy === "front_desc") {
					return b.front.localeCompare(a.front);
				}
				if (sortBy === "due_asc") {
					return new Date(a.due).getTime() - new Date(b.due).getTime();
				}
				return 0;
			});
	}, [cards, searchQuery, selectedCategory, selectedState, sortBy]);

	const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
	const safePage = Math.min(Math.max(1, page), totalPages);

	const paginatedCards = useMemo(() => {
		const start = (safePage - 1) * PAGE_SIZE;
		return filteredCards.slice(start, start + PAGE_SIZE);
	}, [filteredCards, safePage]);

	// Hapus kartu dari Dexie
	const handleDelete = async (id: string) => {
		await db.cards.delete(id);
		setDeleteConfirmId(null);
		if (lastCreatedId === id) setLastCreatedId(null);
		scheduleCloudPush(4000);
	};

	// Reset memori kartu ke status baru (state: 0)
	const handleResetSrs = async (card: LocalCard) => {
		const now = new Date();
		const empty = createEmptyCard(now);
		await db.cards.update(card.id, {
			due: now,
			state: 0,
			stability: empty.stability,
			difficulty: empty.difficulty,
			elapsed_days: 0,
			scheduled_days: 0,
			reps: 0,
			lapses: 0,
			last_review: undefined,
		});
		scheduleCloudPush(4000);
	};

	const totalCount = cards?.length ?? 0;

	return (
		<div className="pt-2 pb-6 sm:pb-8 space-y-6 w-full min-w-0">
			{/* ===== Header & Action Bar ===== */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
				<div>
					<div className="inline-flex items-center gap-2 px-3 py-1 rounded-pill bg-primary/10 border border-primary/20 text-primary font-mono text-[11px] font-bold uppercase tracking-wider mb-2.5">
						<Icon name="layers" className="w-3.5 h-3.5" />
						<span>Manajemen Kosakata</span>
					</div>
					<h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-ink tracking-tight leading-tight">
						Kelola Deck & Kosakata
					</h1>
					<p className="text-xs sm:text-sm text-muted font-medium mt-1.5 leading-relaxed">
						Buat kartu sendiri, kelola kategori kustom, atau kelola koleksi kata
						offline.
					</p>
				</div>

				<div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0 flex-wrap">
					<button
						type="button"
						onClick={() => setIsBulkModalOpen(true)}
						className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-control bg-surface border border-edge text-ink text-xs sm:text-sm font-extrabold hover:bg-surface-2 hover:border-primary/40 active:scale-[0.98] transition-all shadow-xs cursor-pointer"
						title="Tambah banyak kosakata sekaligus via tempel teks atau file CSV"
					>
						<Icon name="sparkles" className="w-4 h-4 text-primary" />
						<span>Impor CSV / Bulk</span>
					</button>

					<button
						type="button"
						onClick={() => {
							setImportTargetHandle("");
							setIsImportModalOpen(true);
						}}
						className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-control bg-surface border border-edge text-ink text-xs sm:text-sm font-extrabold hover:bg-surface-2 hover:border-primary/40 active:scale-[0.98] transition-all shadow-xs cursor-pointer"
						title="Unduh dan gabungkan kosakata dari ID pengguna lain"
					>
						<Icon name="download" className="w-4 h-4 text-primary" />
						<span>Unduh dari Teman / ID</span>
					</button>

					<button
						type="button"
						onClick={() => {
							setEditingCard(null);
							setModalMode("create");
						}}
						className="inline-flex items-center gap-1.5 px-4 sm:px-4.5 py-2.5 rounded-control bg-primary text-white text-xs sm:text-sm font-extrabold shadow-md shadow-primary/20 hover:bg-primary-hover active:scale-[0.98] transition-all cursor-pointer"
					>
						<Icon name="plus" className="w-4 h-4" />
						<span>Tambah Kata</span>
					</button>
				</div>
			</div>

			{/* ===== Filter & Search Controls ===== */}
			<div className="rounded-card bg-surface border border-edge p-4 sm:p-5 shadow-sm space-y-3.5 w-full min-w-0">
				{/* Search Input */}
				<div className="relative w-full min-w-0">
					<Icon
						name="search"
						className="w-4.5 h-4.5 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
					/>
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => {
							setSearchQuery(e.target.value);
							setPage(1);
						}}
						placeholder="Cari kata Inggris, arti bahasa Indonesia, atau kategori…"
						className="w-full pl-10 pr-10 py-2.5 rounded-control border border-edge bg-surface-2/60 text-ink placeholder:text-muted focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 text-sm font-medium transition"
					/>
					{searchQuery.length > 0 && (
						<button
							type="button"
							onClick={() => {
								setSearchQuery("");
								setPage(1);
							}}
							aria-label="Hapus pencarian"
							className="w-6 h-6 absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-surface text-muted hover:text-ink transition border border-edge/60"
						>
							<Icon name="x" className="w-3 h-3" />
						</button>
					)}
				</div>

				{/* Dynamic Category Filter Pills */}
				<div className="w-full min-w-0 overflow-x-auto pb-1 scrollbar-none flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => {
							setSelectedCategory("all");
							setPage(1);
						}}
						className={`px-3 py-1.5 rounded-pill text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${
							selectedCategory === "all"
								? "bg-primary text-white shadow-xs"
								: "bg-surface-2 text-muted hover:text-ink"
						}`}
					>
						<span>Semua</span>
						<span
							className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none ${
								selectedCategory === "all"
									? "bg-white/20 text-white"
									: "bg-edge text-muted"
							}`}
						>
							{totalCount}
						</span>
					</button>

					{availableCategories.map((catKey) => {
						const isStandard =
							(BAND_ORDER as readonly string[]).includes(catKey) ||
							catKey === "general";
						const meta = getBandMeta(catKey);
						const title = isStandard
							? meta.title
							: catKey.charAt(0).toUpperCase() + catKey.slice(1);
						const count = categoryCounts[catKey] ?? 0;
						const isSelected = selectedCategory === catKey;

						return (
							<button
								key={catKey}
								type="button"
								onClick={() => {
									setSelectedCategory(catKey);
									setPage(1);
								}}
								className={`px-3 py-1.5 rounded-pill text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${
									isSelected
										? "bg-primary text-white shadow-xs"
										: "bg-surface-2 text-muted hover:text-ink"
								}`}
							>
								<span>{title}</span>
								<span
									className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono leading-none ${
										isSelected ? "bg-white/20 text-white" : "bg-edge text-muted"
									}`}
								>
									{count}
								</span>
							</button>
						);
					})}
				</div>

				{/* Sort & State Filter Controls */}
				<div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-edge/60 text-xs">
					<div className="flex flex-wrap items-center gap-3">
						{/* Sort Dropdown */}
						<div className="flex items-center gap-1.5">
							<span className="font-mono text-[11px] font-bold text-muted uppercase">
								Urutan:
							</span>
							<select
								value={sortBy}
								onChange={(e) => {
									setSortBy(e.target.value as SortOption);
									setPage(1);
								}}
								className="px-2.5 py-1 rounded-control bg-surface-2 border border-edge text-ink text-xs font-bold focus:outline-none focus:border-primary"
							>
								<option value="created_desc">Terbaru Ditambahkan</option>
								<option value="front_asc">Abjad (A–Z)</option>
								<option value="front_desc">Abjad (Z–A)</option>
								<option value="due_asc">Jatuh Tempo (SRS)</option>
							</select>
						</div>

						{/* State Filter Dropdown */}
						<div className="flex items-center gap-1.5">
							<span className="font-mono text-[11px] font-bold text-muted uppercase">
								Status:
							</span>
							<select
								value={selectedState}
								onChange={(e) => {
									setSelectedState(e.target.value);
									setPage(1);
								}}
								className="px-2.5 py-1 rounded-control bg-surface-2 border border-edge text-ink text-xs font-bold focus:outline-none focus:border-primary"
							>
								<option value="all">Semua Status</option>
								<option value="due">Jatuh Tempo (Siap)</option>
								<option value="0">Baru</option>
								<option value="1">Sedang Belajar</option>
								<option value="2">Diingat (Matang)</option>
							</select>
						</div>
					</div>

					<span className="font-mono text-[11px] font-bold text-muted uppercase">
						Menampilkan {filteredCards.length} kata
					</span>
				</div>
			</div>

			{/* ===== Cards Grid Section ===== */}
			<div className="w-full min-w-0">
				{cards === undefined ? (
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
						{[...Array(6)].map((_, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
								key={i}
								className="h-36 rounded-card bg-surface-2/60 border border-edge animate-pulse"
							/>
						))}
					</div>
				) : filteredCards.length === 0 ? (
					<div className="py-16 text-center rounded-card bg-surface border border-dashed border-edge p-6 space-y-3">
						<div className="w-12 h-12 rounded-full bg-surface-2 text-muted flex items-center justify-center mx-auto">
							<Icon name="search" className="w-6 h-6" />
						</div>
						<h3 className="text-base font-black text-ink">
							Tidak Ada Kata Ditemukan
						</h3>
						<p className="text-xs text-muted max-w-sm mx-auto">
							Coba ubah kata kunci pencarian atau filter kategori di atas, atau
							tambahkan kata baru.
						</p>
						<button
							type="button"
							onClick={() => {
								setEditingCard(null);
								setModalMode("create");
							}}
							className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-bold rounded-control hover:bg-primary-hover transition"
						>
							<Icon name="plus" className="w-4 h-4" />
							<span>Tambah Kata Sekarang</span>
						</button>
					</div>
				) : (
					<div className="space-y-4 w-full min-w-0">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 w-full min-w-0">
							{paginatedCards.map((card) => {
								const parsed = parseBackContent(card.back);
								const meta = getBandMeta(card.category || "general");
								const isDue = new Date(card.due) <= new Date();
								const isRecentlyCreated = lastCreatedId === card.id;

								return (
									<div
										key={card.id}
										className={`rounded-card bg-surface border p-4 sm:p-4.5 shadow-sm transition flex flex-col justify-between gap-3 min-w-0 overflow-hidden group ${
											isRecentlyCreated
												? "border-primary ring-2 ring-primary/20 bg-primary/5"
												: "border-edge hover:border-primary/40"
										}`}
									>
										{/* Card Header Bar */}
										<div className="min-w-0">
											<div className="flex items-start justify-between gap-2 mb-2 min-w-0">
												<div className="flex items-center gap-2 min-w-0 flex-1">
													<button
														type="button"
														onClick={() => void speak(card.front, "en-US")}
														aria-label={`Dengarkan ${card.front}`}
														className="text-base sm:text-lg font-black text-ink hover:text-primary transition group-hover:text-primary break-words min-w-0 text-left"
													>
														{card.front}
													</button>
													<button
														type="button"
														onClick={() => void speak(card.front, "en-US")}
														aria-label="Putar suara"
														className="w-6 h-6 rounded-full bg-surface-2 text-muted hover:text-primary flex items-center justify-center shrink-0 transition"
													>
														<Icon name="volume" className="w-3.5 h-3.5" />
													</button>
													{isRecentlyCreated && (
														<span className="px-2 py-0.5 rounded-pill bg-primary text-white text-[9.5px] font-bold uppercase tracking-wider animate-pulse shrink-0">
															Baru
														</span>
													)}
												</div>

												<div className="flex items-center gap-1.5 shrink-0">
													<span
														className={`font-mono text-[9.5px] font-bold uppercase px-2 py-0.5 rounded-[6px] ${meta.colorClass}`}
													>
														{meta.title}
													</span>
													{isDue && (
														<span
															className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"
															title="Siap diulas"
														/>
													)}
												</div>
											</div>

											{/* Meaning & POS items */}
											<div className="flex flex-wrap items-center gap-1.5 my-1.5">
												{parsed.items.map((item) => (
													<div
														key={`${item.pos ?? "def"}:${item.text}`}
														className="inline-flex items-center gap-1 text-xs"
													>
														{item.pos && (
															<span
																title={item.posFull}
																className={`font-mono text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${
																	item.tone ??
																	"bg-surface-2 text-muted border-edge/60"
																}`}
															>
																{item.posLabel ?? item.pos}
															</span>
														)}
														<span className="font-bold text-ink">
															{item.text}
														</span>
													</div>
												))}
											</div>

											{/* Example sentence */}
											{parsed.exampleEn && (
												<div className="mt-2 p-2 rounded bg-surface-2/60 border-l-2 border-primary text-xs space-y-0.5">
													<p className="font-semibold text-ink">
														"{parsed.exampleEn}"
													</p>
													{parsed.exampleId && (
														<p className="text-muted text-[11px]">
															{parsed.exampleId}
														</p>
													)}
												</div>
											)}
										</div>

										{/* Card Footer: SRS Info & Actions */}
										<div className="pt-2 border-t border-edge/60 flex items-center justify-between gap-2 text-xs">
											<div className="flex items-center gap-2 font-mono text-[10px] text-muted">
												<span>
													{card.state === 0
														? "Baru"
														: card.state === 2
															? "Diingat"
															: "Belajar"}
												</span>
												<span>•</span>
												<span>Ulasan: {card.reps}x</span>
											</div>

											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => void handleResetSrs(card)}
													title="Reset ingatan SRS kartu ini"
													className="p-1.5 rounded-lg text-muted hover:text-amber-500 hover:bg-amber-500/10 transition"
												>
													<Icon name="rotate-ccw" className="w-3.5 h-3.5" />
												</button>
												<button
													type="button"
													onClick={() => {
														setEditingCard(card);
														setModalMode("edit");
													}}
													title="Edit kartu"
													className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition"
												>
													<Icon name="edit" className="w-3.5 h-3.5" />
												</button>
												<button
													type="button"
													onClick={() => setDeleteConfirmId(card.id)}
													title="Hapus kartu"
													className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition"
												>
													<Icon name="trash" className="w-3.5 h-3.5" />
												</button>
											</div>
										</div>
									</div>
								);
							})}
						</div>

						{/* Responsive Pagination Controls */}
						{totalPages > 1 && (
							<div className="flex items-center justify-between gap-2 pt-3 border-t border-edge/60 w-full min-w-0">
								<button
									type="button"
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									disabled={safePage <= 1}
									className="px-3 py-1.5 rounded-control border border-edge text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none transition flex items-center gap-1.5 shrink-0"
								>
									<Icon name="chevron-left" className="w-3.5 h-3.5" />
									<span className="hidden sm:inline">Sebelumnya</span>
								</button>

								{/* Mobile: Compact page badge */}
								<div className="sm:hidden font-mono text-xs font-bold text-muted bg-surface-2 px-2.5 py-1 rounded-pill">
									Hal {safePage} / {totalPages}
								</div>

								{/* Desktop: Numbered buttons */}
								<div className="hidden sm:flex items-center gap-1">
									{Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
										let pageNum: number;
										if (totalPages <= 5) {
											pageNum = idx + 1;
										} else if (safePage <= 3) {
											pageNum = idx + 1;
										} else if (safePage >= totalPages - 2) {
											pageNum = totalPages - 4 + idx;
										} else {
											pageNum = safePage - 2 + idx;
										}
										return (
											<button
												key={pageNum}
												type="button"
												onClick={() => setPage(pageNum)}
												className={`w-8 h-8 rounded-control font-mono text-xs font-bold transition ${
													pageNum === safePage
														? "bg-primary text-white shadow-xs"
														: "bg-surface-2 text-muted hover:text-ink"
												}`}
											>
												{pageNum}
											</button>
										);
									})}
								</div>

								<button
									type="button"
									onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
									disabled={safePage >= totalPages}
									className="px-3 py-1.5 rounded-control border border-edge text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none transition flex items-center gap-1.5 shrink-0"
								>
									<span className="hidden sm:inline">Berikutnya</span>
									<Icon name="arrow-right" className="w-3.5 h-3.5" />
								</button>
							</div>
						)}
					</div>
				)}
			</div>

			{/* ===== Modal Create / Edit Card ===== */}
			{modalMode && (
				<CardFormModal
					mode={modalMode}
					initialCard={editingCard}
					availableCategories={availableCategories}
					onSaved={(cardId, cardCategory) => {
						setLastCreatedId(cardId);
						setSelectedCategory(cardCategory);
						setSortBy("created_desc");
						setPage(1);
					}}
					onClose={() => {
						setModalMode(null);
						setEditingCard(null);
					}}
				/>
			)}

			{/* ===== Delete Confirmation Dialog ===== */}
			{deleteConfirmId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
					<div className="bg-surface rounded-card border border-edge p-6 max-w-sm w-full shadow-xl space-y-4">
						<div className="w-12 h-12 rounded-full bg-danger/10 text-danger flex items-center justify-center mx-auto">
							<Icon name="trash" className="w-6 h-6" />
						</div>
						<div className="text-center space-y-1">
							<h3 className="text-base font-black text-ink">Hapus Kosakata?</h3>
							<p className="text-xs text-muted">
								Kartu ini akan dihapus permanen dari database lokal perangkat
								Anda.
							</p>
						</div>
						<div className="flex items-center gap-2 pt-2">
							<button
								type="button"
								onClick={() => setDeleteConfirmId(null)}
								className="flex-1 py-2.5 rounded-control border border-edge text-ink text-xs font-bold hover:bg-surface-2 transition"
							>
								Batal
							</button>
							<button
								type="button"
								onClick={() => void handleDelete(deleteConfirmId)}
								className="flex-1 py-2.5 rounded-control bg-danger text-white text-xs font-bold hover:bg-red-600 transition shadow-xs"
							>
								Hapus Sekarang
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Modal Unduh Koleksi dari Teman / ID */}
			<SharedDeckImportModal
				isOpen={isImportModalOpen}
				initialHandle={importTargetHandle}
				onClose={() => setIsImportModalOpen(false)}
			/>

			{/* Modal Tambah Banyak Kata Sekaligus / Impor CSV */}
			<BulkAddCardsModal
				isOpen={isBulkModalOpen}
				onClose={() => setIsBulkModalOpen(false)}
			/>
		</div>
	);
}

// Modal Form Tambah / Edit Kartu
function CardFormModal({
	mode,
	initialCard,
	availableCategories,
	onSaved,
	onClose,
}: {
	mode: "create" | "edit";
	initialCard: LocalCard | null;
	availableCategories: string[];
	onSaved?: (id: string, category: string) => void;
	onClose: () => void;
}) {
	const [front, setFront] = useState(initialCard?.front ?? "");
	const [backGloss, setBackGloss] = useState(() => {
		if (!initialCard) return "";
		const parsed = parseBackContent(initialCard.back);
		return parsed.items
			.map((i) => (i.pos ? `[${i.pos}] ${i.text}` : i.text))
			.join("; ");
	});
	const [category, setCategory] = useState(
		initialCard?.category ?? "inggris-easy",
	);
	const [customCategory, setCustomCategory] = useState(() => {
		if (
			initialCard?.category &&
			!(BAND_ORDER as readonly string[]).includes(initialCard.category) &&
			initialCard.category !== "general"
		) {
			return initialCard.category;
		}
		return "";
	});
	const [exampleEn, setExampleEn] = useState(() => {
		if (!initialCard) return "";
		return parseBackContent(initialCard.back).exampleEn ?? "";
	});
	const [exampleId, setExampleId] = useState(() => {
		if (!initialCard) return "";
		return parseBackContent(initialCard.back).exampleId ?? "";
	});
	const [error, setError] = useState<string | null>(null);

	const customCategoriesList = useMemo(() => {
		return availableCategories.filter(
			(c) => !(BAND_ORDER as readonly string[]).includes(c) && c !== "general",
		);
	}, [availableCategories]);

	const isCustomCat = category === "custom";

	// Insert quick POS tag marker
	const insertPos = (tag: string) => {
		setBackGloss((prev) => (prev ? `${prev}; [${tag}] ` : `[${tag}] `));
	};

	const handleSubmit = async (addAnother = false) => {
		const cleanFront = front.trim();
		const cleanGloss = backGloss.trim();

		if (!cleanFront) {
			setError("Kata bahasa Inggris wajib diisi.");
			return;
		}
		if (!cleanGloss) {
			setError("Arti / terjemahan bahasa Indonesia wajib diisi.");
			return;
		}

		// Compose back string: gloss + optional Ex: exampleEn (exampleId)
		let composedBack = cleanGloss;
		if (exampleEn.trim()) {
			if (exampleId.trim()) {
				composedBack += ` Ex: ${exampleEn.trim()} (${exampleId.trim()})`;
			} else {
				composedBack += ` Ex: ${exampleEn.trim()}`;
			}
		}

		const finalCategory =
			(isCustomCat ? customCategory.trim().toLowerCase() : category) ||
			"general";

		const now = new Date();

		if (mode === "edit" && initialCard) {
			await db.cards.update(initialCard.id, {
				front: cleanFront,
				back: composedBack,
				category: finalCategory,
			});
			trackEvent("card_updated", { category: finalCategory });
			onSaved?.(initialCard.id, finalCategory);
			scheduleCloudPush(4000);
			onClose();
		} else {
			const emptyCard = createEmptyCard(now);
			const newCardId =
				typeof crypto !== "undefined" && "randomUUID" in crypto
					? crypto.randomUUID()
					: `${Date.now()}-${Math.random().toString(36).slice(2)}`;

			const newCard: LocalCard = {
				id: newCardId,
				front: cleanFront,
				back: composedBack,
				category: finalCategory,
				...emptyCard,
				due: now,
				createdAt: now,
			};

			await db.cards.add(newCard);
			trackEvent("card_created", { category: finalCategory });
			onSaved?.(newCardId, finalCategory);
			scheduleCloudPush(4000);

			if (addAnother) {
				setFront("");
				setBackGloss("");
				setExampleEn("");
				setExampleId("");
				setError(null);
			} else {
				onClose();
			}
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-fade-in-up">
			<div className="bg-surface rounded-card border border-edge max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 my-auto">
				{/* Modal Header */}
				<div className="flex items-center justify-between pb-2 border-b border-edge/80">
					<div className="flex items-center gap-2">
						<div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
							<Icon
								name={mode === "create" ? "plus" : "edit"}
								className="w-4 h-4"
							/>
						</div>
						<h2 className="text-base sm:text-lg font-black text-ink">
							{mode === "create" ? "Tambah Kosakata Baru" : "Edit Kosakata"}
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="w-8 h-8 rounded-full bg-surface-2 text-muted hover:text-ink flex items-center justify-center transition"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>

				{error && (
					<div className="p-3 rounded-control bg-danger/10 border border-danger/20 text-danger text-xs font-semibold">
						{error}
					</div>
				)}

				<div className="space-y-3.5 text-xs">
					{/* Input Kata Depan */}
					<div className="space-y-1">
						<label
							htmlFor="input-front"
							className="font-mono font-bold text-ink uppercase tracking-wider block"
						>
							Kata Bahasa Inggris (Front) *
						</label>
						<input
							id="input-front"
							type="text"
							value={front}
							onChange={(e) => setFront(e.target.value)}
							placeholder="Contoh: serendipity, resilient, versatile"
							className="w-full px-3.5 py-2.5 rounded-control border border-edge bg-surface-2 text-ink text-sm font-bold focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
						/>
					</div>

					{/* Kategori / Tahap */}
					<div className="space-y-1">
						<label
							htmlFor="select-category"
							className="font-mono font-bold text-ink uppercase tracking-wider block"
						>
							Tahap / Kategori
						</label>
						<select
							id="select-category"
							value={isCustomCat ? "custom" : category}
							onChange={(e) => {
								const val = e.target.value;
								setCategory(val);
								if (val !== "custom") {
									setCustomCategory("");
								}
							}}
							className="w-full px-3 py-2 rounded-control border border-edge bg-surface-2 text-ink text-xs font-bold focus:outline-none focus:border-primary"
						>
							<optgroup label="Tahap Standar">
								<option value="inggris-easy">Easy (A1–A2) — Dasar</option>
								<option value="inggris-medium">
									Medium (B1–B2) — Percakapan
								</option>
								<option value="inggris-advance">
									Advance (C1) — Profesional
								</option>
								<option value="inggris-native">Native (C2) — Mahir</option>
								<option value="general">General / Umum</option>
							</optgroup>

							{customCategoriesList.length > 0 && (
								<optgroup label="Kategori Kustom Anda">
									{customCategoriesList.map((c) => (
										<option key={c} value={c}>
											{c.charAt(0).toUpperCase() + c.slice(1)}
										</option>
									))}
								</optgroup>
							)}

							<optgroup label="Buat Baru">
								<option value="custom">+ Tambah Kategori Kustom Baru…</option>
							</optgroup>
						</select>

						{isCustomCat && (
							<div className="space-y-1 pt-1">
								<input
									id="input-custom-category"
									type="text"
									list="existing-custom-cats"
									value={customCategory}
									onChange={(e) => setCustomCategory(e.target.value)}
									placeholder="Ketik nama kategori baru (misal: bisnis, teknologi, medis)"
									className="w-full px-3 py-2 rounded-control border border-edge bg-surface-2 text-ink text-xs font-medium focus:outline-none focus:border-primary"
								/>
								<datalist id="existing-custom-cats">
									{customCategoriesList.map((c) => (
										<option key={c} value={c} />
									))}
								</datalist>
							</div>
						)}
					</div>

					{/* Input Arti / Back */}
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<label
								htmlFor="input-back-gloss"
								className="font-mono font-bold text-ink uppercase tracking-wider block"
							>
								Arti / Terjemahan (Back) *
							</label>
							<div className="flex items-center gap-1">
								<span className="text-[10px] text-muted">Sisipkan:</span>
								{["n", "v", "adj", "adv"].map((tag) => (
									<button
										key={tag}
										type="button"
										onClick={() => insertPos(tag)}
										className="px-1.5 py-0.5 rounded bg-surface-2 text-primary font-mono text-[10px] font-bold border border-edge/60 hover:bg-primary/10"
									>
										+{tag}
									</button>
								))}
							</div>
						</div>
						<textarea
							id="input-back-gloss"
							rows={2}
							value={backGloss}
							onChange={(e) => setBackGloss(e.target.value)}
							placeholder="Contoh: [n] keberuntungan yang tidak disengaja; berkah tak terduga"
							className="w-full px-3.5 py-2.5 rounded-control border border-edge bg-surface-2 text-ink text-sm font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
						/>
					</div>

					{/* Contoh Kalimat */}
					<div className="space-y-1.5 pt-1">
						<label
							htmlFor="input-example-en"
							className="font-mono font-bold text-ink uppercase tracking-wider block"
						>
							Contoh Kalimat (Opsional)
						</label>
						<input
							id="input-example-en"
							type="text"
							value={exampleEn}
							onChange={(e) => setExampleEn(e.target.value)}
							placeholder="Kalimat Inggris: Finding this book was pure serendipity."
							className="w-full px-3 py-2 rounded-control border border-edge bg-surface-2 text-ink text-xs font-medium focus:outline-none focus:border-primary"
						/>
						<input
							id="input-example-id"
							type="text"
							value={exampleId}
							onChange={(e) => setExampleId(e.target.value)}
							placeholder="Arti Kalimat: Menemukan buku ini benar-benar keberuntungan tak sengaja."
							className="w-full px-3 py-2 rounded-control border border-edge bg-surface-2 text-ink text-xs font-medium focus:outline-none focus:border-primary"
						/>
					</div>
				</div>

				{/* Modal Footer Buttons */}
				<div className="flex items-center justify-end gap-2 pt-3 border-t border-edge/80">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2.5 rounded-control border border-edge text-ink text-xs font-bold hover:bg-surface-2 transition"
					>
						Batal
					</button>

					{mode === "create" && (
						<button
							type="button"
							onClick={() => void handleSubmit(true)}
							className="px-4 py-2.5 rounded-control bg-surface-2 border border-edge text-ink text-xs font-extrabold hover:bg-edge transition"
						>
							Simpan & Tambah Lagi
						</button>
					)}

					<button
						type="button"
						onClick={() => void handleSubmit(false)}
						className="px-5 py-2.5 rounded-control bg-primary text-white text-xs font-extrabold hover:bg-primary-hover transition shadow-sm shadow-primary/20"
					>
						{mode === "create" ? "Simpan Kartu" : "Perbarui Kartu"}
					</button>
				</div>
			</div>
		</div>
	);
}
