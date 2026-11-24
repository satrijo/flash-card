// apps/web/src/components/KelolaCardItem.tsx
// Satu kartu kosakata di grid Kelola: kata depan + arti/POS + contoh,
// footer SRS (status, jumlah ulasan), aksi reset / edit / hapus.
import { getBandMeta, parseBackContent } from "../lib/bands";
import type { LocalCard } from "../lib/db";
import { speak } from "../lib/tts";
import { Icon } from "./Icon";

export function KelolaCardItem({
	card,
	isRecentlyCreated,
	onResetSrs,
	onEdit,
	onDelete,
}: {
	card: LocalCard;
	isRecentlyCreated: boolean;
	onResetSrs: (card: LocalCard) => void;
	onEdit: (card: LocalCard) => void;
	onDelete: (id: string) => void;
}) {
	const parsed = parseBackContent(card.back);
	const meta = getBandMeta(card.category || "general");
	const isDue = new Date(card.due) <= new Date();

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
										item.tone ?? "bg-surface-2 text-muted border-edge/60"
									}`}
								>
									{item.posLabel ?? item.pos}
								</span>
							)}
							<span className="font-bold text-ink">{item.text}</span>
						</div>
					))}
				</div>

				{/* Example sentence */}
				{parsed.exampleEn && (
					<div className="mt-2 p-2 rounded bg-surface-2/60 border-l-2 border-primary text-xs space-y-0.5">
						<p className="font-semibold text-ink">"{parsed.exampleEn}"</p>
						{parsed.exampleId && (
							<p className="text-muted text-[11px]">{parsed.exampleId}</p>
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
						onClick={() => void onResetSrs(card)}
						title="Reset ingatan SRS kartu ini"
						className="p-1.5 rounded-lg text-muted hover:text-amber-500 hover:bg-amber-500/10 transition"
					>
						<Icon name="rotate-ccw" className="w-3.5 h-3.5" />
					</button>
					<button
						type="button"
						onClick={() => onEdit(card)}
						title="Edit kartu"
						className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition"
					>
						<Icon name="edit" className="w-3.5 h-3.5" />
					</button>
					<button
						type="button"
						onClick={() => onDelete(card.id)}
						title="Hapus kartu"
						className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition"
					>
						<Icon name="trash" className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>
		</div>
	);
}
