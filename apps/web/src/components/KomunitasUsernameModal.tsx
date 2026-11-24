// apps/web/src/components/KomunitasUsernameModal.tsx
// Modal ubah ID unik komunitas (kata-<nama>), termasuk prompt Admin
// Secret Key bila ID yang dimasukkan merupakan ID khusus.
import { isReservedHandle, normalizeUserHandle } from "@flashcard/shared";
import { Icon } from "./Icon";

export function KomunitasUsernameModal({
	newUsernameInput,
	onNewUsernameInput,
	adminKeyInput,
	onAdminKeyInput,
	usernameError,
	isSavingUsername,
	onSave,
	onClose,
}: {
	newUsernameInput: string;
	onNewUsernameInput: (value: string) => void;
	adminKeyInput: string;
	onAdminKeyInput: (value: string) => void;
	usernameError: string | null;
	isSavingUsername: boolean;
	onSave: () => void;
	onClose: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
			<div className="bg-surface rounded-2xl border border-edge p-5 max-w-sm w-full shadow-2xl space-y-4">
				<div className="flex items-center justify-between pb-2 border-b border-edge">
					<h3 className="text-sm font-black text-ink">Ubah Nama Panggilan</h3>
					<button
						type="button"
						onClick={() => onClose()}
						className="text-muted hover:text-ink"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>
				<div className="space-y-1.5">
					<label
						htmlFor="input-username"
						className="font-mono text-[11px] font-bold text-muted uppercase block"
					>
						Nama / ID Unik Komunitas (kata-...)
					</label>
					<input
						id="input-username"
						type="text"
						maxLength={30}
						value={newUsernameInput}
						onChange={(e) => onNewUsernameInput(e.target.value)}
						placeholder="kata-joane"
						className="w-full px-3.5 py-2.5 rounded-control border border-edge bg-surface-2 text-ink text-sm font-mono font-bold focus:outline-none focus:border-primary"
					/>
					<p className="text-[11px] text-muted font-mono">
						Otomatis berformat <code>kata-&lt;nama&gt;</code> dan harus unik
						secara global.
					</p>

					{/* Admin Key Prompt jika handle merupakan ID khusus */}
					{isReservedHandle(normalizeUserHandle(newUsernameInput)) && (
						<div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2 animate-fade-in-up">
							<div className="flex items-center gap-1.5 text-xs text-amber-500 font-bold">
								<Icon name="sparkles" className="w-4 h-4" />
								<span>ID Khusus Admin / Operator</span>
							</div>
							<p className="text-[11px] text-muted leading-relaxed">
								ID ini dilindungi. Masukkan <strong>Admin Secret Key</strong>{" "}
								untuk mengonfirmasi hak akses admin kamu:
							</p>
							<input
								type="password"
								value={adminKeyInput}
								onChange={(e) => onAdminKeyInput(e.target.value)}
								placeholder="Admin Secret Key…"
								className="w-full px-3 py-1.5 rounded-control font-mono text-xs font-bold bg-surface border border-edge text-ink focus:outline-none focus:border-amber-500"
							/>
						</div>
					)}
				</div>

				{usernameError && (
					<div className="p-2.5 rounded-xl bg-danger/10 border border-danger/20 text-xs text-danger font-medium">
						{usernameError}
					</div>
				)}

				<div className="flex items-center gap-2 pt-2">
					<button
						type="button"
						onClick={() => onClose()}
						className="flex-1 py-2.5 rounded-control border border-edge text-ink text-xs font-bold hover:bg-surface-2"
					>
						Batal
					</button>
					<button
						type="button"
						onClick={onSave}
						disabled={isSavingUsername || !newUsernameInput.trim()}
						className="flex-1 py-2.5 rounded-control bg-primary text-white text-xs font-bold hover:bg-primary-hover disabled:opacity-50 shadow-xs"
					>
						{isSavingUsername ? "Menyimpan…" : "Simpan ID"}
					</button>
				</div>
			</div>
		</div>
	);
}
