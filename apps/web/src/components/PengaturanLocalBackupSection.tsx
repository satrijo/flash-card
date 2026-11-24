// apps/web/src/components/PengaturanLocalBackupSection.tsx
// Ekspor & Impor File JSON di /pengaturan: cadangan manual berupa file
// JSON (unduh) dan pemulihan dari file (impor, menimpa data lokal).
import { useRef, useState } from "react";
import { downloadBackup, importBackup, isBackupFile } from "../lib/backup";
import { Icon } from "./Icon";

export function PengaturanLocalBackupSection({
	cardCount,
	backupError,
	onBackupError,
}: {
	cardCount: number | undefined;
	backupError: string | null;
	onBackupError: (msg: string | null) => void;
}) {
	const [exported, setExported] = useState(false);
	const [restored, setRestored] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleDownload = async () => {
		try {
			await downloadBackup();
			onBackupError(null);
			setExported(true);
			window.setTimeout(() => setExported(false), 2000);
		} catch {
			onBackupError("Gagal membuat cadangan");
		}
	};

	const handleFileSelected = async (file: File) => {
		try {
			const text = await file.text();
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				onBackupError("File cadangan tidak valid");
				return;
			}
			if (!isBackupFile(parsed)) {
				onBackupError("File cadangan tidak valid");
				return;
			}
			const confirmed = window.confirm(
				"Ganti semua data lokal dengan isi cadangan ini?",
			);
			if (!confirmed) return;
			await importBackup(parsed);
			onBackupError(null);
			setRestored(true);
			window.setTimeout(() => setRestored(false), 2000);
		} catch (err) {
			onBackupError(
				`Gagal memulihkan: ${err instanceof Error ? err.message : "terjadi kesalahan"}`,
			);
		}
	};

	return (
		<section className="rounded-card bg-surface border border-edge p-5 shadow-sm hover-lift animate-fade-in-up stagger-3">
			<div className="flex items-center gap-3.5 mb-3">
				<span className="w-10 h-10 rounded-2xl bg-success/10 text-success flex items-center justify-center shrink-0">
					<Icon name="refresh" className="w-5 h-5" />
				</span>
				<div>
					<p className="font-extrabold text-ink text-sm">
						Ekspor & Impor File JSON
					</p>
					<p className="text-xs text-muted mt-0.5">
						Cadangan manual berupa file JSON offline ke penyimpanan HP/laptop.
					</p>
				</div>
			</div>
			<div className="space-y-2">
				<button
					type="button"
					onClick={() => void handleDownload()}
					className="w-full px-4 py-2.5 bg-success text-white font-bold rounded-control active:scale-[0.98] transition-transform text-xs shadow-xs hover:brightness-105"
				>
					Unduh File Cadangan JSON
				</button>
				<button
					type="button"
					onClick={() => fileInputRef.current?.click()}
					className="w-full px-4 py-2.5 bg-surface border border-edge text-ink font-bold rounded-control active:scale-[0.98] transition-transform text-xs hover:bg-surface-2"
				>
					Impor Dari File JSON
				</button>
			</div>
			<p className="text-[11px] text-muted mt-2 font-mono">
				{cardCount === undefined
					? "Menghitung…"
					: `Cadangan berisi ${cardCount.toLocaleString("id-ID")} kata`}
			</p>
			{exported && (
				<p className="text-xs text-success font-semibold mt-2">
					✓ Cadangan terunduh
				</p>
			)}
			{restored && (
				<p className="text-xs text-success font-semibold mt-2">
					✓ Data dipulihkan
				</p>
			)}
			{backupError && (
				<p className="text-xs text-danger font-semibold mt-2">{backupError}</p>
			)}
			<input
				ref={fileInputRef}
				type="file"
				accept="application/json,.json"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) void handleFileSelected(file);
					e.target.value = "";
				}}
			/>
		</section>
	);
}
