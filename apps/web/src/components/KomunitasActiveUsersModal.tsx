// apps/web/src/components/KomunitasActiveUsersModal.tsx
// Modal daftar pembelajar aktif: siapa sedang online, aktivitasnya
// (latihan/komunitas/lainnya), plus tombol unduh koleksi kartunya.

import {
	type ActiveLearner,
	getAvatarGradient,
	getInitials,
} from "../lib/community";
import { Icon } from "./Icon";

export function KomunitasActiveUsersModal({
	learners,
	currentUsername,
	displayOnlineCount,
	search,
	onSearch,
	onClose,
	onDownload,
}: {
	learners: ActiveLearner[];
	currentUsername: string;
	displayOnlineCount: number;
	search: string;
	onSearch: (value: string) => void;
	onClose: () => void;
	onDownload: (handle: string) => void;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
			<div className="bg-surface rounded-2xl border border-edge max-w-sm w-full p-4 sm:p-5 shadow-2xl space-y-3 max-h-[85vh] flex flex-col">
				<div className="flex items-center justify-between pb-2 border-b border-edge">
					<div className="flex items-center gap-2">
						<span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
						<h3 className="text-sm font-black text-ink">
							Pembelajar Aktif ({displayOnlineCount})
						</h3>
					</div>
					<button
						type="button"
						onClick={() => onClose()}
						className="text-muted hover:text-ink p-1 rounded-lg hover:bg-surface-2"
					>
						<Icon name="x" className="w-4 h-4" />
					</button>
				</div>

				{/* Breakdown Kategori Aktivitas */}
				<div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono font-bold">
					<span className="px-2 py-0.5 rounded-pill bg-amber-500/15 text-amber-500 border border-amber-500/20">
						📚{" "}
						{
							learners.filter((l) =>
								l.activity.toLowerCase().includes("latihan"),
							).length
						}{" "}
						Latihan
					</span>
					<span className="px-2 py-0.5 rounded-pill bg-primary/15 text-primary border border-primary/20">
						💬{" "}
						{
							learners.filter((l) =>
								l.activity.toLowerCase().includes("komunitas"),
							).length
						}{" "}
						Komunitas
					</span>
					<span className="px-2 py-0.5 rounded-pill bg-surface-2 text-muted border border-edge">
						🏠{" "}
						{
							learners.filter(
								(l) =>
									!l.activity.toLowerCase().includes("latihan") &&
									!l.activity.toLowerCase().includes("komunitas"),
							).length
						}{" "}
						Halaman Lain
					</span>
				</div>

				{/* Search Bar for 100+ active users */}
				{learners.length > 5 && (
					<div className="relative">
						<Icon
							name="search"
							className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2"
						/>
						<input
							type="text"
							value={search}
							onChange={(e) => onSearch(e.target.value)}
							placeholder="Cari nama atau aktivitas…"
							className="w-full pl-8.5 pr-3 py-1.5 rounded-control border border-edge bg-surface-2 text-xs text-ink font-medium focus:outline-none focus:border-primary"
						/>
					</div>
				)}

				<div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-none max-h-64">
					{learners.length === 0 ? (
						<div className="p-4 text-center text-xs text-muted">
							Memuat aktivitas pembelajar…
						</div>
					) : (
						learners
							.filter((l) => {
								if (!search.trim()) return true;
								const q = search.toLowerCase();
								return (
									l.username.toLowerCase().includes(q) ||
									l.activity.toLowerCase().includes(q)
								);
							})
							.map((learner) => {
								const isMe = learner.username === currentUsername;
								const isPracticing = learner.activity
									.toLowerCase()
									.includes("latihan");

								return (
									<div
										key={`${learner.username}-${learner.lastSeen}`}
										className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
											isMe
												? "bg-primary/10 border-primary/30"
												: "bg-surface-2/60 border-edge/80"
										}`}
									>
										<div className="flex items-center gap-2.5 min-w-0">
											<div
												className={`w-8 h-8 rounded-full bg-gradient-to-tr ${getAvatarGradient(
													learner.username,
												)} text-white flex items-center justify-center font-black text-xs shrink-0 shadow-xs`}
											>
												{getInitials(learner.username)}
											</div>
											<div className="min-w-0">
												<div className="flex items-center gap-1.5">
													<span className="font-bold text-xs text-ink truncate">
														{learner.username}
													</span>
													{isMe && (
														<span className="px-1.5 py-0.2 rounded-pill bg-primary text-white text-[9px] font-mono font-bold">
															Kamu
														</span>
													)}
												</div>
												<div className="flex items-center gap-1.5 mt-0.5">
													<span
														className={`w-1.5 h-1.5 rounded-full shrink-0 ${
															isPracticing
																? "bg-amber-500 animate-pulse"
																: "bg-emerald-500"
														}`}
													/>
													<span
														className={`text-[11px] font-medium truncate ${
															isPracticing
																? "text-amber-500 font-bold"
																: "text-muted"
														}`}
													>
														{learner.activity}
													</span>
												</div>
											</div>
										</div>

										{!isMe && (
											<button
												type="button"
												onClick={() => onDownload(learner.username)}
												className="px-2.5 py-1 rounded-pill bg-primary/10 hover:bg-primary/20 text-primary font-mono text-[10px] font-bold border border-primary/25 transition flex items-center gap-1 shrink-0 active:scale-95"
												title={`Unduh & gabungkan kartu dari @${learner.username}`}
											>
												<Icon name="download" className="w-3 h-3" />
												<span>Unduh</span>
											</button>
										)}
									</div>
								);
							})
					)}
				</div>

				<button
					type="button"
					onClick={() => onClose()}
					className="w-full py-2.5 rounded-control bg-primary text-white text-xs font-bold hover:bg-primary-hover shadow-xs mt-1"
				>
					Tutup
				</button>
			</div>
		</div>
	);
}
