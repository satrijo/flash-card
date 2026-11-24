// apps/web/src/components/SharedCardMessageBubble.tsx
// Kartu lampiran flashcard interaktif dan estetik di dalam obrolan komunitas (Full Dual-Theme Light/Dark Support)

import { createEmptyCard, normalizeCategory } from "@flashcard/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { scheduleCloudPush } from "../hooks/useCloudSync";
import { trackEvent } from "../lib/analytics";
import { parseBackContent } from "../lib/bands";
import { db } from "../lib/db";
import { speak } from "../lib/tts";
import { Icon } from "./Icon";

interface SharedCardMessageBubbleProps {
	cardRef: {
		front: string;
		back: string;
		category?: string;
	};
	authorUsername: string;
	isMe: boolean;
	onOpenAuthorDeck?: (username: string) => void;
}

export function SharedCardMessageBubble({
	cardRef,
	authorUsername,
	isMe,
	onOpenAuthorDeck,
}: SharedCardMessageBubbleProps) {
	const [justSaved, setJustSaved] = useState(false);
	const parsed = parseBackContent(cardRef.back);
	const category = normalizeCategory(cardRef.category);

	const isAlreadyInDeck = useLiveQuery(async () => {
		const normFront = cardRef.front.trim().toLowerCase();
		const all = await db.cards.toArray();
		return all.some((c) => c.front.trim().toLowerCase() === normFront);
	}, [cardRef.front]);

	const handleSaveCard = async () => {
		const cleanFront = cardRef.front.trim();
		const cleanBack = cardRef.back.trim();
		const now = new Date();
		const empty = createEmptyCard(now);

		await db.cards.add({
			...empty,
			id: crypto.randomUUID(),
			front: cleanFront,
			back: cleanBack,
			category,
			due: now,
			createdAt: now,
		});
		scheduleCloudPush(2000);

		setJustSaved(true);
		trackEvent("shared_card_saved_from_chat", {
			front: cleanFront,
			category,
			author: authorUsername,
		});
		setTimeout(() => setJustSaved(false), 3000);
	};

	return (
		<div
			className={`mt-2.5 rounded-2xl border text-left p-3.5 space-y-2.5 transition-all shadow-md ${
				isMe
					? "bg-black/35 border-white/20 text-white shadow-black/20"
					: "bg-surface border-edge text-ink dark:bg-[#0c0c0e] dark:border-primary/30 shadow-xs"
			}`}
		>
			{/* Top Bar: Category Pill & Audio Button */}
			<div
				className={`flex items-center justify-between gap-2 pb-1 border-b ${
					isMe ? "border-white/10" : "border-edge dark:border-white/10"
				}`}
			>
				<div className="flex items-center gap-1.5 min-w-0">
					<span className="font-mono text-[9.5px] font-extrabold uppercase px-2 py-0.5 rounded-pill bg-primary/20 text-primary border border-primary/30 shrink-0">
						🔖 {category}
					</span>
					<span className="text-[10px] text-muted truncate hidden xs:inline">
						Flashcard Kosakata
					</span>
				</div>

				<button
					type="button"
					onClick={() => void speak(cardRef.front, "en-US")}
					className={`p-1.5 rounded-full transition flex items-center gap-1 text-[10.5px] font-mono font-bold ${
						isMe
							? "hover:bg-white/20 text-white"
							: "hover:bg-primary/20 text-primary bg-primary/10"
					}`}
					title="Dengarkan pengucapan"
				>
					<Icon name="volume" className="w-3.5 h-3.5" />
					<span className="text-[9px] pr-0.5">Suara</span>
				</button>
			</div>

			{/* Word Title (Front) */}
			<div>
				<h4
					className={`text-base sm:text-lg font-black tracking-tight leading-tight ${
						isMe ? "text-white" : "text-ink dark:text-white"
					}`}
				>
					{cardRef.front}
				</h4>
			</div>

			{/* Meanings / POS breakdown (Back) */}
			<div className="space-y-1 text-xs">
				{parsed.items.length > 0 ? (
					<div className="space-y-1">
						{parsed.items.map((item) => (
							<div
								key={`${item.pos}-${item.text}`}
								className={`flex items-start gap-1.5 ${
									isMe ? "text-white/90" : "text-ink/90 dark:text-neutral-200"
								}`}
							>
								{item.pos && (
									<span className="px-1.5 py-0.2 rounded-pill bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono text-[9px] font-bold border border-amber-500/30 shrink-0 mt-0.5">
										{item.pos}
									</span>
								)}
								<span className="leading-snug">{item.text}</span>
							</div>
						))}
					</div>
				) : (
					<p
						className={`font-medium leading-relaxed ${
							isMe ? "text-white/90" : "text-ink/80 dark:text-neutral-300"
						}`}
					>
						{cardRef.back}
					</p>
				)}

				{/* Example sentence if available */}
				{parsed.exampleEn && (
					<div
						className={`mt-2 p-2 rounded-xl border-l-2 border-primary text-[11px] space-y-0.5 ${
							isMe
								? "bg-white/10 text-white/90"
								: "bg-surface-2 text-ink/90 dark:bg-white/5 dark:text-neutral-300"
						}`}
					>
						<p className="italic font-medium">"{parsed.exampleEn}"</p>
						{parsed.exampleId && (
							<p className="text-muted text-[10px]">{parsed.exampleId}</p>
						)}
					</div>
				)}
			</div>

			{/* Interactive Action Bar */}
			<div
				className={`pt-2 border-t flex items-center justify-between gap-2 flex-wrap text-xs ${
					isMe ? "border-white/10" : "border-edge dark:border-white/10"
				}`}
			>
				{/* Save to my deck button */}
				{!isMe ? (
					isAlreadyInDeck || justSaved ? (
						<span className="inline-flex items-center gap-1 text-[11px] font-bold text-success font-mono">
							<Icon name="check" className="w-3.5 h-3.5" />
							<span>
								{justSaved ? "Tersimpan di Deck!" : "Sudah di Koleksimu"}
							</span>
						</span>
					) : (
						<button
							type="button"
							onClick={() => void handleSaveCard()}
							className="px-2.5 py-1 rounded-pill bg-primary text-white font-extrabold text-[11px] hover:bg-primary-hover active:scale-95 transition flex items-center gap-1 shadow-xs shadow-primary/20"
						>
							<Icon name="plus" className="w-3.5 h-3.5" />
							<span>Simpan Kartu Ini</span>
						</button>
					)
				) : (
					<span className="text-[10px] text-white/70 font-mono">
						✓ Dibagikan oleh Anda
					</span>
				)}

				{/* View full author deck */}
				{!isMe && onOpenAuthorDeck && (
					<button
						type="button"
						onClick={() => onOpenAuthorDeck(authorUsername)}
						className="text-[10.5px] font-bold text-primary hover:underline flex items-center gap-1 ml-auto"
					>
						<span>Lihat Deck @{authorUsername}</span>
						<span>→</span>
					</button>
				)}
			</div>
		</div>
	);
}
