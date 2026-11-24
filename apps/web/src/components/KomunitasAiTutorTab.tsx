// apps/web/src/components/KomunitasAiTutorTab.tsx
// Tab AI English Tutor di /komunitas — masih roadmap (statis, tanpa state).
import { Icon } from "./Icon";

export function KomunitasAiTutorTab() {
	return (
		<div className="flex-1 overflow-y-auto space-y-3.5 pr-1 scrollbar-none animate-fade-in-up">
			{/* Hero Card */}
			<div className="rounded-2xl bg-gradient-to-tr from-indigo-900/30 via-purple-900/20 to-background border border-primary/30 p-5 text-center relative overflow-hidden">
				<div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-primary to-purple-500 text-white flex items-center justify-center mx-auto mb-3 shadow-md shadow-primary/30 animate-soft-pulse">
					<Icon name="bot" className="w-7 h-7" />
				</div>
				<div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-primary/20 text-primary font-mono text-[10.5px] font-bold uppercase mb-2">
					✨ Fitur AI Pintar
				</div>
				<h2 className="text-xl sm:text-2xl font-black text-ink tracking-tight mb-1.5">
					AI English Partner & Roleplay Chat
				</h2>
				<p className="text-xs text-muted max-w-md mx-auto leading-relaxed">
					Praktik percakapan bahasa Inggris interaktif dengan AI cerdas yang
					menyesuaikan dengan kartu kosakata Anda dan memperbaiki grammar
					real-time.
				</p>
			</div>

			{/* 4 Feature Cards */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
					<div className="text-xl mb-1">☕</div>
					<h3 className="text-xs sm:text-sm font-black text-ink">
						Simulasi Skenario Dunia Nyata
					</h3>
					<p className="text-xs text-muted leading-relaxed">
						Latihan pesan kopi di kafe, check-in bandara, wawancara kerja, dan
						diskusi santai.
					</p>
				</div>

				<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
					<div className="text-xl mb-1">🎯</div>
					<h3 className="text-xs sm:text-sm font-black text-ink">
						Koreksi Grammar & Saran Alami
					</h3>
					<p className="text-xs text-muted leading-relaxed">
						Evaluasi tata bahasa instan beserta rekomendasi kalimat penutur asli
						(*native*).
					</p>
				</div>

				<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
					<div className="text-xl mb-1">🧠</div>
					<h3 className="text-xs sm:text-sm font-black text-ink">
						Integrasi Flashcard SRS
					</h3>
					<p className="text-xs text-muted leading-relaxed">
						AI sengaja memancing kata yang sedang sering Anda lupakan ke dalam
						dialog latihan.
					</p>
				</div>

				<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
					<div className="text-xl mb-1">🔊</div>
					<h3 className="text-xs sm:text-sm font-black text-ink">
						Speaking & Voice Practice
					</h3>
					<p className="text-xs text-muted leading-relaxed">
						Dengarkan pelafalan akurat dan latih berbicara langsung lewat audio.
					</p>
				</div>
			</div>

			<div className="p-3.5 text-center rounded-xl bg-surface-2 border border-edge text-xs text-muted font-medium">
				🚀 Sedang dalam tahap pengembangan akhir. Fitur AI English Tutor akan
				segera hadir pada pembaruan berikutnya!
			</div>
		</div>
	);
}
