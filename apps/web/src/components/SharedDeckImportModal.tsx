// apps/web/src/components/SharedDeckImportModal.tsx
// Modal interaktif untuk preview & impor non-destruktif koleksi kartu dari pengguna lain (R2 / D1)
// Dilengkapi pemilih multi-kategori agar pengguna hanya mengimpor kategori yang diinginkan (Anti-Bloated)

import { normalizeUserHandle } from "@flashcard/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { trackEvent } from "../lib/analytics";
import {
	mergeCardsFromCloudUser,
	previewCloudDeck,
	type SharedCategorySummary,
} from "../lib/cloudBackup";
import { getAvatarGradient, getInitials } from "../lib/community";
import { Icon } from "./Icon";

interface SharedDeckImportModalProps {
	isOpen: boolean;
	initialHandle?: string;
	onClose: () => void;
	onSuccess?: (addedCount: number) => void;
}

export function SharedDeckImportModal({
	isOpen,
	initialHandle = "",
	onClose,
	onSuccess,
}: SharedDeckImportModalProps) {
	const [targetHandle, setTargetHandle] = useState(initialHandle);
	const [inspecting, setInspecting] = useState(false);
	const [deckInfo, setDeckInfo] = useState<{
		handle: string;
		totalCards: number;
		totalNewCards: number;
		totalExistingCards: number;
		categories: SharedCategorySummary[];
		sampleCards: { front: string; back: string; category: string }[];
		backupAt?: number;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
	const [importing, setImporting] = useState(false);
	const [importResult, setImportResult] = useState<{
		addedCount: number;
		skippedCount: number;
		newCategories: string[];
	} | null>(null);

	const handleInspect = useCallback(async (handleToInspect: string) => {
		const norm = normalizeUserHandle(handleToInspect);
		if (!norm || norm === "kata-") {
			setError("Masukkan ID pengguna yang valid (contoh: kata-joane)");
			return;
		}

		setInspecting(true);
		setError(null);
		setDeckInfo(null);
		setImportResult(null);

		const res = await previewCloudDeck(norm);
		setInspecting(false);

		if (!res.success) {
			setError(
				res.error ||
					`Koleksi untuk ID "${norm}" tidak ditemukan atau belum pernah dicadangkan ke cloud.`,
			);
			return;
		}

		setDeckInfo({
			handle: res.handle,
			totalCards: res.totalCards,
			totalNewCards: res.totalNewCards,
			totalExistingCards: res.totalExistingCards,
			categories: res.categories,
			sampleCards: res.sampleCards,
			backupAt: res.backupAt,
		});

		// Otomatis pilih semua kategori yang memiliki kata baru (> 0)
		const withNewWords = res.categories
			.filter((c) => c.newCards > 0)
			.map((c) => c.name);
		setSelectedCategories(
			withNewWords.length > 0
				? withNewWords
				: res.categories.map((c) => c.name),
		);
	}, []);

	// Sinkronkan initialHandle saat modal dibuka
	useEffect(() => {
		if (isOpen) {
			setTargetHandle(initialHandle);
			setDeckInfo(null);
			setError(null);
			setImportResult(null);
			setSelectedCategories([]);

			if (initialHandle.trim()) {
				void handleInspect(initialHandle.trim());
			}
		}
	}, [isOpen, initialHandle, handleInspect]);

	// Toggle kategori tertentu
	const toggleCategory = (catName: string) => {
		setSelectedCategories((prev) =>
			prev.includes(catName)
				? prev.filter((c) => c !== catName)
				: [...prev, catName],
		);
	};

	// Pilih semua atau kosongkan
	const toggleSelectAllCategories = () => {
		if (!deckInfo) return;
		if (selectedCategories.length === deckInfo.categories.length) {
			setSelectedCategories([]);
		} else {
			setSelectedCategories(deckInfo.categories.map((c) => c.name));
		}
	};

	// Hitung total kata baru dari kategori-kategori yang sedang dicentang
	const selectedSummary = useMemo(() => {
		if (!deckInfo) return { totalNew: 0, totalCards: 0 };
		const set = new Set(selectedCategories);
		let totalNew = 0;
		let totalCards = 0;
		for (const c of deckInfo.categories) {
			if (set.has(c.name)) {
				totalNew += c.newCards;
				totalCards += c.totalCards;
			}
		}
		return { totalNew, totalCards };
	}, [deckInfo, selectedCategories]);

	if (!isOpen) return null;

	const handleDoImport = async () => {
		if (!deckInfo || selectedCategories.length === 0) return;

		setImporting(true);
		setError(null);

		const res = await mergeCardsFromCloudUser(
			deckInfo.handle,
			selectedCategories,
		);
		setImporting(false);

		if (!res.success) {
			setError(res.error || "Gagal mengimpor koleksi kartu.");
			return;
		}

		setImportResult({
			addedCount: res.addedCount,
			skippedCount: res.skippedCount,
			newCategories: res.newCategories,
		});

		trackEvent("shared_deck_imported", {
			source_handle: deckInfo.handle,
			added_count: res.addedCount,
			skipped_count: res.skippedCount,
			selected_categories: selectedCategories,
		});

		if (onSuccess) {
			onSuccess(res.addedCount);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
			<div className="bg-surface rounded-2xl border border-edge max-w-lg w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
				{/* Modal Header */}
				<div className="flex items-center justify-between pb-2 border-b border-edge shrink-0">
					<div className="flex items-center gap-2.5">
						<span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
							<Icon name="download" className="w-4 h-4" />
						</span>
						<div>
							<h3 className="text-sm sm:text-base font-black text-ink">
								Unduh Koleksi Berdasarkan Kategori
							</h3>
							<p className="text-[11px] text-muted">
								Pilih kategori spesifik yang ingin digabungkan ke deck Anda
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-muted hover:text-ink p-1 rounded-lg hover:bg-surface-2 transition"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>

				{/* Modal Body Scroll Area */}
				<div className="flex-1 overflow-y-auto space-y-3.5 pr-1 min-h-0">
					{/* Result Screen (Success) */}
					{importResult ? (
						<div className="p-4 sm:p-5 rounded-2xl bg-primary/10 border border-primary/20 space-y-3 text-center animate-fade-in-up">
							<div className="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center mx-auto shadow-md shadow-primary/20 animate-soft-pulse">
								<Icon name="check" className="w-6 h-6" />
							</div>
							<div>
								<h4 className="text-base font-black text-ink">
									Kategori Berhasil Digabungkan!
								</h4>
								<p className="text-xs text-muted mt-1 leading-relaxed">
									Berhasil menambahkan{" "}
									<strong className="text-primary font-bold">
										+{importResult.addedCount} kata baru
									</strong>{" "}
									ke dalam deck latihan Anda.
								</p>
							</div>

							<div className="bg-surface p-3 rounded-xl border border-edge text-left space-y-1.5 text-xs font-mono">
								<div className="flex justify-between">
									<span className="text-muted">Kata Baru Ditambahkan:</span>
									<span className="font-bold text-success">
										+{importResult.addedCount} kata
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted">Kata Sudah Ada (Dilewati):</span>
									<span className="font-bold text-muted">
										{importResult.skippedCount} kata
									</span>
								</div>
								{importResult.newCategories.length > 0 && (
									<div className="pt-1 border-t border-edge flex items-center justify-between gap-2 flex-wrap">
										<span className="text-muted">Kategori Baru:</span>
										<span className="font-bold text-primary truncate">
											{importResult.newCategories.join(", ")}
										</span>
									</div>
								)}
							</div>

							<button
								type="button"
								onClick={onClose}
								className="w-full py-2.5 rounded-control bg-primary text-white font-extrabold text-xs hover:bg-primary-hover transition shadow-xs"
							>
								Selesai & Lihat Kosakata
							</button>
						</div>
					) : (
						<>
							{/* Form Input ID Teman */}
							<div className="space-y-1.5">
								<label
									htmlFor="input-target-handle"
									className="text-xs font-bold text-ink flex items-center justify-between"
								>
									<span>ID Akun Pemilik Koleksi</span>
									<span className="font-mono text-[10px] text-muted">
										Format: kata-nama
									</span>
								</label>
								<div className="flex gap-2">
									<div className="relative flex-1">
										<span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted">
											@
										</span>
										<input
											id="input-target-handle"
											type="text"
											value={targetHandle}
											onChange={(e) => setTargetHandle(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													e.preventDefault();
													void handleInspect(targetHandle);
												}
											}}
											placeholder="kata-joane atau kata-curioushero-571"
											className="w-full pl-7 pr-3 py-2 rounded-control border border-edge bg-surface-2 text-ink font-mono text-xs focus:outline-none focus:border-primary transition"
										/>
									</div>
									<button
										type="button"
										onClick={() => void handleInspect(targetHandle)}
										disabled={inspecting || !targetHandle.trim()}
										className="px-4 py-2 rounded-control bg-surface-2 hover:bg-edge border border-edge text-ink font-bold text-xs disabled:opacity-40 transition flex items-center gap-1.5 shrink-0"
									>
										{inspecting ? (
											<span>Memeriksa…</span>
										) : (
											<>
												<Icon name="search" className="w-3.5 h-3.5" />
												<span>Cek Koleksi</span>
											</>
										)}
									</button>
								</div>
							</div>

							{/* Error message */}
							{error && (
								<div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-xs text-danger font-medium leading-relaxed animate-fade-in-up">
									⚠️ {error}
								</div>
							)}

							{/* Deck Preview & Interactive Category Selector */}
							{deckInfo && (
								<div className="space-y-3.5 p-3.5 sm:p-4 rounded-2xl bg-surface-2/70 border border-edge animate-fade-in-up">
									{/* User Identity Info */}
									<div className="flex items-center justify-between gap-3 pb-2 border-b border-edge">
										<div className="flex items-center gap-2.5 min-w-0">
											<div
												className={`w-9 h-9 rounded-full bg-gradient-to-tr ${getAvatarGradient(
													deckInfo.handle,
												)} text-white flex items-center justify-center font-black text-xs shrink-0 shadow-xs`}
											>
												{getInitials(deckInfo.handle)}
											</div>
											<div className="min-w-0">
												<div className="font-bold text-xs sm:text-sm text-ink truncate">
													{deckInfo.handle}
												</div>
												<div className="text-[10px] text-muted font-mono">
													{deckInfo.totalCards} total kartu di cloud
												</div>
											</div>
										</div>

										<span className="px-2 py-0.5 rounded-pill bg-primary/15 text-primary border border-primary/25 font-mono text-[10px] font-bold shrink-0">
											{deckInfo.backupAt
												? `Dicadangkan ${new Date(deckInfo.backupAt).toLocaleDateString("id-ID")}`
												: "Aktif"}
										</span>
									</div>

									{/* Interactive Category Selector Header */}
									<div className="space-y-2">
										<div className="flex items-center justify-between">
											<span className="text-xs font-black text-ink">
												Pilih Kategori yang Ingin Diambil:
											</span>
											<button
												type="button"
												onClick={toggleSelectAllCategories}
												className="text-[11px] text-primary font-bold hover:underline"
											>
												{selectedCategories.length ===
												deckInfo.categories.length
													? "Batal Pilih Semua"
													: "Pilih Semua"}
											</button>
										</div>

										{/* Categories Grid (Checkbox Cards) */}
										<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
											{deckInfo.categories.map((cat) => {
												const isSelected = selectedCategories.includes(
													cat.name,
												);

												return (
													<button
														key={cat.name}
														type="button"
														onClick={() => toggleCategory(cat.name)}
														className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between gap-2 cursor-pointer select-none ${
															isSelected
																? "bg-primary/15 border-primary shadow-xs"
																: "bg-surface border-edge hover:border-primary/40"
														}`}
													>
														<div className="flex items-center gap-2 min-w-0">
															<span
																className={`w-4 h-4 rounded flex items-center justify-center text-[10px] border transition ${
																	isSelected
																		? "bg-primary border-primary text-white font-bold"
																		: "border-edge bg-surface-2"
																}`}
															>
																{isSelected ? "✓" : ""}
															</span>
															<div className="min-w-0">
																<div className="font-mono text-xs font-bold text-ink uppercase truncate">
																	{cat.name}
																</div>
																<div className="text-[10px] text-muted font-mono">
																	{cat.totalCards} kata
																</div>
															</div>
														</div>

														<div className="shrink-0 text-right">
															{cat.newCards > 0 ? (
																<span className="px-1.5 py-0.5 rounded-pill bg-emerald-500/15 text-emerald-500 font-mono text-[9.5px] font-bold border border-emerald-500/25">
																	+{cat.newCards} baru
																</span>
															) : (
																<span className="text-muted font-mono text-[9px]">
																	Sudah ada
																</span>
															)}
														</div>
													</button>
												);
											})}
										</div>
									</div>

									{/* Dynamic Selection Summary */}
									<div className="p-2.5 rounded-xl bg-surface border border-edge text-xs flex items-center justify-between gap-2">
										<span className="text-muted font-medium">
											Dipilih:{" "}
											<strong className="text-ink">
												{selectedCategories.length} kategori
											</strong>
										</span>
										<span className="font-bold text-primary font-mono text-xs">
											+{selectedSummary.totalNew} kata baru
										</span>
									</div>

									{/* Sample Preview Cards */}
									<div className="space-y-1.5 pt-1">
										<div className="text-[10.5px] font-mono font-bold text-muted uppercase">
											Contoh Kosakata Koleksi Ini:
										</div>
										<div className="space-y-1 max-h-32 overflow-y-auto pr-0.5 scrollbar-none">
											{deckInfo.sampleCards.map((sc) => (
												<div
													key={`${sc.front}-${sc.category}`}
													className="flex items-center justify-between gap-2 p-2 rounded-xl bg-surface border border-edge text-xs"
												>
													<div className="min-w-0">
														<span className="font-black text-ink">
															{sc.front}
														</span>
														<span className="text-muted text-[11px] ml-1.5 truncate">
															— {sc.back.slice(0, 45)}
														</span>
													</div>
													<span className="px-1.5 py-0.2 rounded-pill bg-surface-2 text-muted font-mono text-[9px] font-bold uppercase shrink-0 border border-edge">
														{sc.category}
													</span>
												</div>
											))}
										</div>
									</div>

									{/* Non-Destructive Safety Notice */}
									<div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-[11px] text-muted leading-relaxed flex items-start gap-2">
										<span className="text-primary font-bold">🛡️ Aman:</span>
										<span>
											Kartu Anda yang sudah ada{" "}
											<strong>tidak akan terhapus atau tertimpa</strong>. Sistem
											hanya menambahkan kata dari kategori terpilih yang belum
											Anda miliki.
										</span>
									</div>
								</div>
							)}
						</>
					)}
				</div>

				{/* Modal Footer Buttons */}
				{!importResult && (
					<div className="flex items-center justify-end gap-2 pt-2 border-t border-edge shrink-0">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2.5 rounded-control border border-edge text-ink text-xs font-bold hover:bg-surface-2 transition"
						>
							Batal
						</button>

						{deckInfo && (
							<button
								type="button"
								onClick={() => void handleDoImport()}
								disabled={
									importing ||
									selectedCategories.length === 0 ||
									selectedSummary.totalNew === 0
								}
								className="px-5 py-2.5 rounded-control bg-primary text-white font-extrabold text-xs hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none transition shadow-sm shadow-primary/20 flex items-center gap-1.5"
							>
								{importing ? (
									<span>Mengimpor…</span>
								) : (
									<>
										<Icon name="download" className="w-4 h-4" />
										<span>
											{selectedCategories.length === 0
												? "Pilih Kategori Dulu"
												: selectedSummary.totalNew === 0
													? "Semua Kata Sudah Dimiliki"
													: `Gabungkan +${selectedSummary.totalNew} Kata (${selectedCategories.length} Kategori)`}
										</span>
									</>
								)}
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
