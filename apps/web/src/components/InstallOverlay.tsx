/*
 * InstallOverlay — overlay PWA install (mobile only, lihat usePwaInstall).
 * Android: tombol prompt() native. iOS: instruksi manual 3 langkah.
 * Render null kalau tidak perlu (desktop / sudah terpasang / sudah dismiss).
 */

import { usePwaInstall } from "../hooks/usePwaInstall";
import { Icon } from "./Icon";

export function InstallOverlay() {
	const { show, accepted, canInstall, install, dismiss } = usePwaInstall();

	if (!show && !accepted) return null;

	return (
		<div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur flex items-center justify-center p-6 pb-[env(safe-area-inset-bottom)]">
			{accepted ? (
				<div className="max-w-sm w-full mx-auto rounded-card border border-edge bg-surface shadow-2xl p-6 text-center">
					<div className="flex justify-center mb-4">
						<Icon name="trophy" className="w-14 h-14 text-success" />
					</div>
					<p className="text-xl font-extrabold text-ink tracking-tight">
						Terpasang!
					</p>
					<p className="text-sm text-muted mt-2">
						Kata siap dibuka dari layar utama.
					</p>
				</div>
			) : (
				<div className="max-w-sm w-full mx-auto rounded-card border border-edge bg-surface shadow-2xl p-6">
					<div className="flex items-center gap-2.5 mb-4">
						<Icon name="sparkles" className="w-5 h-5 text-primary" />
						<span className="text-lg font-extrabold text-primary tracking-tight">
							Kata
						</span>
					</div>
					<h2 className="text-xl font-extrabold text-ink mb-2 tracking-tight">
						Pasang Kata di layar utama
					</h2>
					<p className="text-sm text-muted mb-6">
						Kosakata offline yang bekerja tanpa internet — buka langsung dari
						ikon di layar utama.
					</p>

					{canInstall === "android" ? (
						<>
							<button
								type="button"
								onClick={() => void install()}
								className="w-full py-3 px-6 bg-primary text-white font-bold rounded-control active:scale-95 transition"
							>
								Pasang Sekarang
							</button>
							<button
								type="button"
								onClick={dismiss}
								className="w-full mt-3 py-1 text-muted underline text-sm"
							>
								Nanti saja
							</button>
						</>
					) : (
						<>
							<ol className="space-y-3 mb-6">
								<li className="flex items-start gap-3">
									<span className="flex-none w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
										1
									</span>
									<span className="text-sm text-ink">
										Ketuk ikon{" "}
										<span className="font-mono text-[12px] font-semibold text-muted">
											Bagikan ⎋
										</span>{" "}
										di browser.
									</span>
								</li>
								<li className="flex items-start gap-3">
									<span className="flex-none w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
										2
									</span>
									<span className="text-sm text-ink">
										Pilih{" "}
										<span className="font-mono text-[12px] font-semibold text-muted">
											"Add to Home Screen"
										</span>
										.
									</span>
								</li>
								<li className="flex items-start gap-3">
									<span className="flex-none w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
										3
									</span>
									<span className="text-sm text-ink">
										Ketuk{" "}
										<span className="font-mono text-[12px] font-semibold text-muted">
											"Add"
										</span>
										.
									</span>
								</li>
							</ol>
							<button
								type="button"
								onClick={dismiss}
								className="w-full py-1 text-muted underline text-sm"
							>
								Nanti saja
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}
