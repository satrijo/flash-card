// apps/web/src/components/KomunitasShareModal.tsx
// Modal pilih kartu kosakata dari koleksi sendiri untuk dibagikan ke obrolan.

import type { LocalCard } from "../lib/db";
import { Icon } from "./Icon";

export function KomunitasShareModal({
	searchQuery,
	onSearchQuery,
	cards,
	onSelect,
	onClose,
}: {
	searchQuery: string;
	onSearchQuery: (value: string) => void;
	cards: LocalCard[] | undefined;
	onSelect: (card: LocalCard) => void;
	onClose: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
			<div className="bg-surface rounded-2xl border border-edge max-w-md w-full p-4 sm:p-5 shadow-2xl space-y-3.5 max-h-[85vh] flex flex-col">
				<div className="flex items-center justify-between pb-2 border-b border-edge">
					<div className="flex items-center gap-2">
						<Icon name="share" className="w-4 h-4 text-primary" />
						<h3 className="text-sm font-black text-ink">
							Pilih Kartu untuk Dibagikan
						</h3>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-muted hover:text-ink"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>

				{/* Search Bar in Picker */}
				<div className="relative">
					<Icon
						name="search"
						className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2"
					/>
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => onSearchQuery(e.target.value)}
						placeholder="Cari kata di deck Anda…"
						className="w-full pl-9 pr-3 py-2 rounded-control border border-edge bg-surface-2 text-xs text-ink font-medium focus:outline-none focus:border-primary"
					/>
				</div>

				<div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-none">
					{cards?.length === 0 ? (
						<p className="text-xs text-muted text-center py-6">
							Tidak ada kartu yang cocok.
						</p>
					) : (
						cards?.map((card) => (
							<button
								key={card.id}
								type="button"
								onClick={() => onSelect(card)}
								className="w-full p-2.5 rounded-xl bg-surface-2 hover:bg-primary/10 border border-edge hover:border-primary/40 text-left transition flex items-center justify-between gap-3 group"
							>
								<div className="min-w-0">
									<div className="font-bold text-xs sm:text-sm text-ink group-hover:text-primary transition">
										{card.front}
									</div>
									<div className="text-[11px] text-muted truncate">
										{card.back}
									</div>
								</div>
								<Icon
									name="plus"
									className="w-4 h-4 text-muted group-hover:text-primary shrink-0"
								/>
							</button>
						))
					)}
				</div>
			</div>
		</div>
	);
}
