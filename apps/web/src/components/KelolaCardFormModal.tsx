// apps/web/src/components/KelolaCardFormModal.tsx
// Modal form tambah / edit satu kartu kosakata (front, arti, kategori,
// contoh kalimat). Dipakai rute /kelola untuk mode create dan edit.
import { createEmptyCard, normalizeCategory } from "@flashcard/shared";
import { useMemo, useState } from "react";
import { scheduleCloudPush } from "../hooks/useCloudSync";
import { trackEvent } from "../lib/analytics";
import { BAND_ORDER, parseBackContent } from "../lib/bands";
import { db, type LocalCard } from "../lib/db";
import { Icon } from "./Icon";

export function KelolaCardFormModal({
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

		let composedBack = cleanGloss;
		if (exampleEn.trim()) {
			if (exampleId.trim()) {
				composedBack += ` Ex: ${exampleEn.trim()} (${exampleId.trim()})`;
			} else {
				composedBack += ` Ex: ${exampleEn.trim()}`;
			}
		}

		const finalCategory = normalizeCategory(
			isCustomCat ? customCategory : category,
		);

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
