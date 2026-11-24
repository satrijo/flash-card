// apps/web/src/components/KelolaPagination.tsx
// Kontrol halaman grid Kelola: tombol sebelum/berikut + nomor halaman
// (maksimal 5 nomor, jendela mengikuti halaman aktif).
import { Icon } from "./Icon";

export function KelolaPagination({
	safePage,
	totalPages,
	onPageChange,
}: {
	safePage: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}) {
	if (totalPages <= 1) return null;
	return (
		<div className="flex items-center justify-between gap-2 pt-3 border-t border-edge/60 w-full min-w-0">
			<button
				type="button"
				onClick={() => onPageChange(Math.max(1, safePage - 1))}
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
							onClick={() => onPageChange(pageNum)}
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
				onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
				disabled={safePage >= totalPages}
				className="px-3 py-1.5 rounded-control border border-edge text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none transition flex items-center gap-1.5 shrink-0"
			>
				<span className="hidden sm:inline">Berikutnya</span>
				<Icon name="arrow-right" className="w-3.5 h-3.5" />
			</button>
		</div>
	);
}
