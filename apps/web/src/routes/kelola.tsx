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
import { KelolaCardFormModal } from "../components/KelolaCardFormModal";
import { KelolaCardItem } from "../components/KelolaCardItem";
import { KelolaPagination } from "../components/KelolaPagination";
import { SharedDeckImportModal } from "../components/SharedDeckImportModal";
import { scheduleCloudPush } from "../hooks/useCloudSync";
import { BAND_ORDER, getBandMeta } from "../lib/bands";
import { db, type LocalCard } from "../lib/db";

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

	const filteredCards = useMemo(() => {
		if (!cards) return [];
		const q = searchQuery.trim().toLowerCase();
		const now = new Date();

		return cards
			.filter((c) => {
				if (selectedCategory !== "all") {
					const cat = normalizeCategory(c.category);
					if (cat !== selectedCategory) {
						return false;
					}
				}

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

	const handleDelete = async (id: string) => {
		await db.cards.delete(id);
		setDeleteConfirmId(null);
		if (lastCreatedId === id) setLastCreatedId(null);
		scheduleCloudPush(4000);
	};

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
							{paginatedCards.map((card) => (
								<KelolaCardItem
									key={card.id}
									card={card}
									isRecentlyCreated={lastCreatedId === card.id}
									onResetSrs={(c) => void handleResetSrs(c)}
									onEdit={(c) => {
										setEditingCard(c);
										setModalMode("edit");
									}}
									onDelete={(id) => setDeleteConfirmId(id)}
								/>
							))}
						</div>

						<KelolaPagination
							safePage={safePage}
							totalPages={totalPages}
							onPageChange={setPage}
						/>
					</div>
				)}
			</div>

			{/* ===== Modal Create / Edit Card ===== */}
			{modalMode && (
				<KelolaCardFormModal
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
