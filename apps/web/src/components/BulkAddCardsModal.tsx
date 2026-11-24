// apps/web/src/components/BulkAddCardsModal.tsx
// Modal canggih untuk menambah kosakata secara massal (Bulk Add) via tempel teks cepat atau unggah file CSV/TSV
// Mengikuti standar format persis seperti packages/db/seed/inggris-easy.csv:
// "front", "back", "category" (kategori selalu di akhir, contoh kalimat di dalam back via Ex: ... — ...)

import { createEmptyCard, normalizeCategory } from "@flashcard/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useRef, useState } from "react";
import { scheduleCloudPush } from "../hooks/useCloudSync";
import { trackEvent } from "../lib/analytics";
import { parseBackContent } from "../lib/bands";
import { db, type LocalCard } from "../lib/db";
import { Icon } from "./Icon";

interface BulkAddCardsModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: (count: number) => void;
}

interface ParsedRow {
	id: string;
	front: string;
	back: string;
	category: string;
	glossDisplay: string;
	exampleEn?: string;
	exampleId?: string;
	pos?: string;
	status: "new" | "duplicate" | "invalid";
	reason?: string;
}

/**
 * Parser baris CSV yang mendukung quotes standar RFC 4180, tab, pipe, dan delimiter lainnya
 */
function parseCsvLine(line: string): string[] {
	const trimmed = line.trim();
	if (!trimmed) return [];

	// Jika format TSV (Tab Separated)
	if (trimmed.includes("\t")) {
		return trimmed.split("\t").map((s) => s.trim().replace(/^["']|["']$/g, ""));
	}

	// Jika format Pipe Separated
	if (trimmed.includes("|")) {
		return trimmed.split("|").map((s) => s.trim().replace(/^["']|["']$/g, ""));
	}

	// Parser CSV dengan dukungan string dalam tanda petik ganda "..."
	const fields: string[] = [];
	let currentField = "";
	let inQuotes = false;

	for (let i = 0; i < trimmed.length; i++) {
		const char = trimmed[i];
		const nextChar = trimmed[i + 1];

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				currentField += '"';
				i++; // Lewati escaped quote
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			fields.push(currentField.trim().replace(/^["']|["']$/g, ""));
			currentField = "";
		} else {
			currentField += char;
		}
	}
	fields.push(currentField.trim().replace(/^["']|["']$/g, ""));

	// Fallback jika tidak ada koma tetapi menggunakan ' - ' atau ' = '
	if (fields.length <= 1) {
		if (trimmed.includes(" - ")) {
			return trimmed
				.split(" - ")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""));
		}
		if (trimmed.includes(" = ")) {
			return trimmed
				.split(" = ")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""));
		}
	}

	return fields;
}

export function BulkAddCardsModal({
	isOpen,
	onClose,
	onSuccess,
}: BulkAddCardsModalProps) {
	const [activeTab, setActiveTab] = useState<"paste" | "file">("paste");
	const [rawText, setRawText] = useState("");
	const [defaultCategory, setDefaultCategory] = useState("inggris-easy");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [resultCount, setResultCount] = useState<number | null>(null);
	const [addedCategories, setAddedCategories] = useState<string[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const existingCards = useLiveQuery(() => db.cards.toArray(), []);

	const existingWordSet = useMemo(() => {
		const set = new Set<string>();
		if (!existingCards) return set;
		for (const c of existingCards) {
			set.add(c.front.trim().toLowerCase());
		}
		return set;
	}, [existingCards]);

	// Parse teks menjadi baris kartu persis mengikuti standar seed CSV
	const parsedRows = useMemo<ParsedRow[]>(() => {
		if (!rawText.trim()) return [];

		const lines = rawText.split(/\r?\n/);
		const rows: ParsedRow[] = [];
		const seenInBatch = new Set<string>();

		for (let i = 0; i < lines.length; i++) {
			const rawLine = lines[i]?.trim();
			if (!rawLine) continue;

			// Lewati baris header CSV jika ada
			if (
				i === 0 &&
				(rawLine.toLowerCase().startsWith('"front"') ||
					rawLine.toLowerCase().startsWith("front,") ||
					rawLine.toLowerCase().startsWith("kata,") ||
					rawLine.toLowerCase().startsWith("word,"))
			) {
				continue;
			}

			const parts = parseCsvLine(rawLine);
			if (parts.length === 0) continue;

			const front = parts[0]?.trim() ?? "";
			let back = "";
			let category = "";

			// Kategori SELALU di akhir (mengikuti seed dan 3-column / 5-column standard)
			if (parts.length >= 3) {
				// Standar seed: front = parts[0], category = parts[parts.length - 1], back = sisanya
				category = normalizeCategory(
					parts[parts.length - 1]?.trim() || defaultCategory || "inggris-easy",
				);

				if (parts.length === 3) {
					back = parts[1]?.trim() ?? "";
				} else if (parts.length === 4) {
					// front, back, example_en, category
					const gloss = parts[1]?.trim() ?? "";
					const exEn = parts[2]?.trim() ?? "";
					back = exEn ? `${gloss} Ex: ${exEn}` : gloss;
				} else if (parts.length >= 5) {
					// front, back, example_en, example_id, category
					const gloss = parts[1]?.trim() ?? "";
					const exEn = parts[2]?.trim() ?? "";
					const exId = parts[3]?.trim() ?? "";
					back = exEn
						? `${gloss} Ex: ${exEn}${exId ? ` — ${exId}` : ""}`
						: gloss;
				}
			} else if (parts.length === 2) {
				// front, back (kategori pakai defaultCategory)
				back = parts[1]?.trim() ?? "";
				category = normalizeCategory(defaultCategory || "inggris-easy");
			} else {
				back = "";
				category = normalizeCategory(defaultCategory || "inggris-easy");
			}

			const key = front.toLowerCase();

			// Parse isi field back untuk pratinjau POS & contoh kalimat
			const parsedBack = parseBackContent(back);
			const glossDisplay =
				parsedBack.items.length > 0
					? parsedBack.items.map((it) => it.text).join("; ")
					: back;
			const firstPos = parsedBack.items[0]?.pos;

			if (!front || !back) {
				rows.push({
					id: `row-${i}`,
					front: front || "(kosong)",
					back: back || "(kosong)",
					category,
					glossDisplay: glossDisplay || "(kosong)",
					exampleEn: parsedBack.exampleEn,
					exampleId: parsedBack.exampleId,
					pos: firstPos,
					status: "invalid",
					reason: !front ? "Kata depan kosong" : "Arti terjemahan kosong",
				});
				continue;
			}

			if (existingWordSet.has(key) || seenInBatch.has(key)) {
				rows.push({
					id: `row-${i}`,
					front,
					back,
					category,
					glossDisplay,
					exampleEn: parsedBack.exampleEn,
					exampleId: parsedBack.exampleId,
					pos: firstPos,
					status: "duplicate",
					reason: existingWordSet.has(key)
						? "Sudah ada di koleksi"
						: "Duplikat di dalam batch teks",
				});
				continue;
			}

			seenInBatch.add(key);
			rows.push({
				id: `row-${i}`,
				front,
				back,
				category,
				glossDisplay,
				exampleEn: parsedBack.exampleEn,
				exampleId: parsedBack.exampleId,
				pos: firstPos,
				status: "new",
			});
		}

		return rows;
	}, [rawText, defaultCategory, existingWordSet]);

	const stats = useMemo(() => {
		let newCount = 0;
		let duplicateCount = 0;
		let invalidCount = 0;
		const catSet = new Set<string>();

		for (const r of parsedRows) {
			if (r.status === "new") {
				newCount++;
				catSet.add(r.category);
			} else if (r.status === "duplicate") {
				duplicateCount++;
			} else {
				invalidCount++;
			}
		}

		return {
			newCount,
			duplicateCount,
			invalidCount,
			categories: Array.from(catSet),
		};
	}, [parsedRows]);

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (event) => {
			const text = event.target?.result as string;
			if (text) {
				setRawText(text);
				setActiveTab("paste"); // Beralih ke editor teks untuk pratinjau
			}
		};
		reader.readAsText(file);
	};

	const handleDownloadTemplate = () => {
		// Format persis standar seed: "front","back","category" (kategori di akhir)
		const csvContent =
			`"front","back","category"\n` +
			`"able","a mampu; bisa. Ex: She is able to swim well. — Dia mampu berenang dengan baik.","inggris-easy"\n` +
			`"serendipity","n keberuntungan tanpa sengaja. Ex: We found this cafe by pure serendipity. — Kami menemukan kafe ini karena ketidaksengajaan yang menyenangkan.","slang"\n` +
			`"tenacious","a ulet; pantang menyerah. Ex: She was tenacious in pursuing her dreams. — Dia sangat ulet dalam mengejar impiannya.","inggris-advance"\n` +
			`"ubiquitous","a ada di mana-mana; lazim. Ex: Smartphones have become ubiquitous in daily life. — Ponsel pintar telah menjadi hal yang lazim dalam kehidupan sehari-hari.","inggris-advance"\n`;

		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.setAttribute("download", "template-kosakata-kata.csv");
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	const handleSaveBulk = async () => {
		const newRows = parsedRows.filter((r) => r.status === "new");
		if (newRows.length === 0) return;

		setIsSubmitting(true);
		const now = new Date();
		const toAdd: LocalCard[] = [];

		for (const r of newRows) {
			const empty = createEmptyCard(now);

			toAdd.push({
				...empty,
				id: crypto.randomUUID(),
				front: r.front.trim(),
				back: r.back.trim(),
				category: normalizeCategory(r.category),
				due: now,
				createdAt: now,
			});
		}

		await db.cards.bulkAdd(toAdd);
		scheduleCloudPush(2000);
		setIsSubmitting(false);
		setResultCount(toAdd.length);
		setAddedCategories(stats.categories);

		trackEvent("bulk_cards_created", {
			count: toAdd.length,
			categories: stats.categories,
		});

		if (onSuccess) {
			onSuccess(toAdd.length);
		}
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
			<div className="bg-surface rounded-2xl border border-edge max-w-xl w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between pb-2 border-b border-edge shrink-0">
					<div className="flex items-center gap-2.5">
						<span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
							<Icon name="sparkles" className="w-4 h-4" />
						</span>
						<div>
							<h3 className="text-sm sm:text-base font-black text-ink">
								Tambah Banyak Kata Sekaligus
							</h3>
							<p className="text-[11px] text-muted">
								Format standar seed: <code>front, back, category</code>{" "}
								(kategori di akhir)
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-muted hover:text-ink p-1 rounded-lg hover:bg-surface-2 transition cursor-pointer"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>

				{/* Body Content */}
				<div className="flex-1 overflow-y-auto space-y-3.5 pr-1 min-h-0">
					{resultCount !== null ? (
						<div className="p-5 rounded-2xl bg-primary/10 border border-primary/20 text-center space-y-3 animate-fade-in-up">
							<div className="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center mx-auto shadow-md shadow-primary/20 animate-soft-pulse">
								<Icon name="check" className="w-6 h-6" />
							</div>
							<h4 className="text-base font-black text-ink">
								{resultCount} Kosakata Berhasil Ditambahkan!
							</h4>
							<p className="text-xs text-muted max-w-xs mx-auto leading-relaxed">
								Semua kartu baru dan contoh kalimat telah tersimpan di
								penyimpanan lokal perangkat dan siap untuk Anda latih hari ini.
							</p>

							{addedCategories.length > 0 && (
								<div className="inline-flex items-center gap-1.5 p-2 rounded-xl bg-surface border border-edge text-xs font-mono">
									<span className="text-muted">Kategori:</span>
									<span className="font-bold text-primary">
										{addedCategories.join(", ")}
									</span>
								</div>
							)}

							<div className="pt-2">
								<button
									type="button"
									onClick={onClose}
									className="w-full py-2.5 rounded-control bg-primary text-white font-extrabold text-xs hover:bg-primary-hover shadow-xs transition cursor-pointer"
								>
									Selesai & Lihat Kosakata
								</button>
							</div>
						</div>
					) : (
						<>
							{/* Tab Switcher */}
							<div className="grid grid-cols-2 p-1 rounded-pill bg-surface-2 border border-edge text-xs font-bold gap-1">
								<button
									type="button"
									onClick={() => setActiveTab("paste")}
									className={`py-1.5 px-3 rounded-pill transition flex items-center justify-center gap-1.5 cursor-pointer ${
										activeTab === "paste"
											? "bg-surface text-ink shadow-2xs font-extrabold"
											: "text-muted hover:text-ink"
									}`}
								>
									<Icon name="plus" className="w-3.5 h-3.5" />
									<span>Tempel Teks Cepat</span>
								</button>

								<button
									type="button"
									onClick={() => setActiveTab("file")}
									className={`py-1.5 px-3 rounded-pill transition flex items-center justify-center gap-1.5 cursor-pointer ${
										activeTab === "file"
											? "bg-surface text-ink shadow-2xs font-extrabold"
											: "text-muted hover:text-ink"
									}`}
								>
									<Icon name="download" className="w-3.5 h-3.5" />
									<span>Unggah File CSV / TSV</span>
								</button>
							</div>

							{/* Option 1: Quick Paste */}
							{activeTab === "paste" ? (
								<div className="space-y-2">
									<div className="flex items-center justify-between text-xs">
										<label
											htmlFor="textarea-raw-bulk"
											className="font-bold text-ink"
										>
											Tulis / Tempel Baris CSV:
										</label>
										<button
											type="button"
											onClick={() =>
												setRawText(
													`"serendipity","n keberuntungan tanpa sengaja. Ex: We found this cafe by serendipity. — Kami menemukan kafe ini tanpa sengaja.","slang"\n"tenacious","a ulet; pantang menyerah. Ex: She was tenacious in pursuing dreams. — Dia sangat ulet mengejar mimpinya.","inggris-advance"\n"ubiquitous","a ada di mana-mana. Ex: Smartphones are ubiquitous. — Ponsel pintar ada di mana-mana.","inggris-advance"`,
												)
											}
											className="text-[11px] text-primary font-bold hover:underline cursor-pointer"
										>
											Isi Contoh Seed CSV
										</button>
									</div>

									<textarea
										id="textarea-raw-bulk"
										rows={5}
										value={rawText}
										onChange={(e) => setRawText(e.target.value)}
										placeholder={`Format standar per baris:\n"front","back","category"\n\nContoh:\n"able","a mampu; bisa. Ex: She is able to swim well. — Dia mampu berenang dengan baik.","inggris-easy"`}
										className="w-full p-3 rounded-xl border border-edge bg-surface-2 text-ink font-mono text-xs focus:outline-none focus:border-primary resize-y leading-relaxed"
									/>
								</div>
							) : (
								/* Option 2: File Upload */
								<div className="space-y-3">
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										className="w-full p-6 rounded-2xl border-2 border-dashed border-edge hover:border-primary/50 bg-surface-2/40 text-center cursor-pointer transition space-y-2 block"
									>
										<div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
											<Icon name="download" className="w-5 h-5" />
										</div>
										<p className="text-xs font-bold text-ink">
											Klik untuk memilih file CSV, TSV, atau TXT
										</p>
										<p className="text-[11px] text-muted font-mono">
											Format kolom: <code>"front", "back", "category"</code>
										</p>
									</button>
									<input
										ref={fileInputRef}
										type="file"
										accept=".csv,.tsv,.txt"
										onChange={handleFileUpload}
										className="hidden"
									/>

									<div className="flex items-center justify-between text-xs pt-1">
										<span className="text-muted">Butuh contoh file?</span>
										<button
											type="button"
											onClick={handleDownloadTemplate}
											className="text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer"
										>
											<Icon name="download" className="w-3.5 h-3.5" />
											<span>Unduh Template CSV (Format Seed)</span>
										</button>
									</div>
								</div>
							)}

							{/* Default Category Selector */}
							<div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-2/60 border border-edge">
								<div>
									<span className="text-xs font-bold text-ink block">
										Kategori Bawaan (Default):
									</span>
									<span className="text-[10.5px] text-muted">
										Digunakan jika baris CSV tidak mencantumkan kolom kategori
										di akhir
									</span>
								</div>
								<input
									type="text"
									value={defaultCategory}
									onChange={(e) => setDefaultCategory(e.target.value)}
									placeholder="inggris-easy"
									className="w-28 sm:w-36 px-2.5 py-1.5 rounded-control border border-edge bg-surface text-ink text-xs font-mono font-bold focus:outline-none focus:border-primary"
								/>
							</div>

							{/* Live Real-time Parsing Preview */}
							{parsedRows.length > 0 && (
								<div className="space-y-2 pt-1 animate-fade-in-up">
									<div className="flex items-center justify-between text-xs">
										<span className="font-mono font-bold text-muted uppercase text-[10.5px]">
											Hasil Deteksi ({parsedRows.length} baris):
										</span>
										<div className="flex items-center gap-1.5 text-[10px] font-mono font-bold">
											<span className="px-1.5 py-0.5 rounded-pill bg-success/15 text-success border border-success/25">
												+{stats.newCount} Baru
											</span>
											{stats.duplicateCount > 0 && (
												<span className="px-1.5 py-0.5 rounded-pill bg-surface-2 text-muted border border-edge">
													{stats.duplicateCount} Ada
												</span>
											)}
											{stats.invalidCount > 0 && (
												<span className="px-1.5 py-0.5 rounded-pill bg-danger/15 text-danger border border-danger/25">
													{stats.invalidCount} Error
												</span>
											)}
										</div>
									</div>

									<div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5 scrollbar-none">
										{parsedRows.map((r) => (
											<div
												key={r.id}
												className={`p-2.5 rounded-xl border text-xs space-y-1 ${
													r.status === "new"
														? "bg-surface border-edge"
														: r.status === "duplicate"
															? "bg-surface-2/40 border-edge/50 opacity-60"
															: "bg-danger/10 border-danger/20"
												}`}
											>
												<div className="flex items-center justify-between gap-2">
													<div className="min-w-0 flex items-center gap-2">
														<span
															className={`w-4 h-4 rounded flex items-center justify-center font-mono text-[9px] font-bold shrink-0 ${
																r.status === "new"
																	? "bg-success/20 text-success"
																	: r.status === "duplicate"
																		? "bg-muted/20 text-muted"
																		: "bg-danger/20 text-danger"
															}`}
														>
															{r.status === "new"
																? "✓"
																: r.status === "duplicate"
																	? "–"
																	: "!"}
														</span>
														<div className="truncate flex items-center gap-1.5">
															<span className="font-black text-ink">
																{r.front}
															</span>
															{r.pos && (
																<span className="px-1.5 py-0.2 rounded-pill bg-amber-500/20 text-amber-500 font-mono text-[9px] font-bold border border-amber-500/30 shrink-0">
																	{r.pos}
																</span>
															)}
															<span className="text-muted text-[11px] truncate">
																— {r.glossDisplay}
															</span>
														</div>
													</div>

													<div className="flex items-center gap-1.5 shrink-0">
														<span className="px-1.5 py-0.2 rounded-pill bg-surface-2 text-muted font-mono text-[9px] font-bold uppercase border border-edge">
															{r.category}
														</span>
														{r.reason && (
															<span className="text-[9.5px] font-mono text-muted hidden sm:inline">
																({r.reason})
															</span>
														)}
													</div>
												</div>

												{/* Preview Contoh Kalimat jika ada */}
												{r.exampleEn && (
													<div className="pl-6 text-[10.5px] text-muted space-x-1 truncate border-l-2 border-primary/40 ml-2 py-0.5">
														<span className="italic text-ink/85">
															"{r.exampleEn}"
														</span>
														{r.exampleId && (
															<span className="text-muted text-[10px]">
																({r.exampleId})
															</span>
														)}
													</div>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</>
					)}
				</div>

				{/* Footer Buttons */}
				{resultCount === null && (
					<div className="flex items-center justify-end gap-2 pt-2 border-t border-edge shrink-0">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2.5 rounded-control border border-edge text-ink text-xs font-bold hover:bg-surface-2 transition cursor-pointer"
						>
							Batal
						</button>

						<button
							type="button"
							onClick={() => void handleSaveBulk()}
							disabled={isSubmitting || stats.newCount === 0}
							className="px-5 py-2.5 rounded-control bg-primary text-white font-extrabold text-xs hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none transition shadow-sm shadow-primary/20 flex items-center gap-1.5 cursor-pointer"
						>
							{isSubmitting ? (
								<span>Menyimpan…</span>
							) : (
								<>
									<Icon name="plus" className="w-4 h-4" />
									<span>
										{stats.newCount === 0
											? "Masukkan Kata Terlebih Dahulu"
											: `Tambahkan +${stats.newCount} Kata Baru`}
									</span>
								</>
							)}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
