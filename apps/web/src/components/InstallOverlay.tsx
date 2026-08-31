import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { Icon } from "./Icon";

export function InstallOverlay() {
	const { isOpen, accepted, canInstall, install, closeModal } = usePwaInstall();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!isOpen && !accepted) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				closeModal();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, accepted, closeModal]);

	if (!mounted || typeof document === "undefined" || (!isOpen && !accepted)) {
		return null;
	}

	return createPortal(
		<div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6 pb-[env(safe-area-inset-bottom)] animate-fade-in-up">
			{/* Backdrop button — klik di luar modal untuk menutup */}
			<button
				type="button"
				aria-label="Tutup popup pasang"
				onClick={closeModal}
				className="fixed inset-0 bg-black/60 backdrop-blur-md cursor-default z-0"
			/>

			{accepted ? (
				<div className="relative z-10 max-w-sm w-full mx-auto rounded-2xl border border-edge bg-surface shadow-2xl p-6 text-center">
					<div className="flex justify-center mb-4">
						<Icon name="trophy" className="w-14 h-14 text-success" />
					</div>
					<p className="text-xl font-extrabold text-ink tracking-tight">
						Terpasang!
					</p>
					<p className="text-sm text-muted mt-2">
						Kata siap dibuka langsung dari layar utama.
					</p>
				</div>
			) : (
				<div className="relative z-10 max-w-md w-full mx-auto rounded-2xl border border-edge bg-surface shadow-2xl p-6">
					<div className="flex items-center justify-between gap-2.5 mb-4">
						<div className="flex items-center gap-2">
							<div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
								<Icon name="sparkles" className="w-4 h-4" />
							</div>
							<span className="text-lg font-extrabold text-ink tracking-tight">
								Pasang Aplikasi Kata
							</span>
						</div>
						<button
							type="button"
							onClick={closeModal}
							aria-label="Tutup"
							className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-2 border border-edge text-muted hover:text-ink active:scale-95 transition shadow-2xs"
						>
							<Icon name="x" className="w-4 h-4" />
						</button>
					</div>

					<p className="text-sm text-muted mb-5 leading-relaxed">
						Nikmati latihan kosakata bahasa Inggris secara offline tanpa perlu
						koneksi internet — buka cepat dari layar laptop / HP.
					</p>

					{canInstall === "native" ? (
						<>
							<button
								type="button"
								onClick={() => void install()}
								className="w-full py-3.5 px-6 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary-hover hover:to-indigo-700 text-white font-extrabold rounded-control active:scale-[0.98] transition text-sm shadow-md shadow-primary/20 flex items-center justify-center gap-2"
							>
								<Icon name="download" className="w-4 h-4" />
								<span>Pasang Sekarang</span>
							</button>
							<button
								type="button"
								onClick={closeModal}
								className="w-full mt-3 py-1.5 text-muted hover:text-ink transition-colors text-sm font-medium"
							>
								Nanti saja
							</button>
						</>
					) : canInstall === "desktop-manual" ? (
						<>
							<div className="rounded-control bg-surface-2/70 border border-edge p-4 mb-5 space-y-3">
								<p className="text-xs font-bold text-ink flex items-center gap-1.5">
									<Icon name="sparkles" className="w-3.5 h-3.5 text-primary" />
									<span>Cara Pasang di Browser Desktop:</span>
								</p>
								<ol className="space-y-2.5 text-xs text-muted">
									<li className="flex items-start gap-2">
										<span className="flex-none w-5 h-5 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-[10px]">
											1
										</span>
										<span>
											Lihat ke ujung kanan{" "}
											<strong className="text-ink">
												Address Bar (kolom URL)
											</strong>{" "}
											browser Anda di atas.
										</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="flex-none w-5 h-5 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-[10px]">
											2
										</span>
										<span>
											Klik ikon{" "}
											<strong className="text-ink">
												Pasang / Unduh (⬇ atau ⊕)
											</strong>
											, lalu klik{" "}
											<strong className="text-ink">Install / Pasang</strong>.
										</span>
									</li>
									<li className="flex items-start gap-2">
										<span className="flex-none w-5 h-5 rounded-full bg-surface text-muted font-bold flex items-center justify-center text-[10px]">
											💡
										</span>
										<span>
											Atau buka menu browser{" "}
											<strong className="text-ink">
												(⋮ / ⋯) &gt; Pasang Kata (Install Kata)
											</strong>
											.
										</span>
									</li>
								</ol>
							</div>
							<button
								type="button"
								onClick={closeModal}
								className="w-full py-3 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-[0.98] transition text-sm shadow-sm"
							>
								Mengerti, Tutup
							</button>
						</>
					) : canInstall === "ios" ? (
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
										di Safari.
									</span>
								</li>
								<li className="flex items-start gap-3">
									<span className="flex-none w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
										2
									</span>
									<span className="text-sm text-ink">
										Gulir ke bawah dan pilih{" "}
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
										</span>{" "}
										di pojok kanan atas.
									</span>
								</li>
							</ol>
							<button
								type="button"
								onClick={closeModal}
								className="w-full py-2 text-muted hover:text-ink transition-colors text-sm font-medium"
							>
								Tutup
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={closeModal}
							className="w-full py-3 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-95 transition text-sm"
						>
							Tutup
						</button>
					)}
				</div>
			)}
		</div>,
		document.body,
	);
}
