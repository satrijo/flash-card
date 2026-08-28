/*
 * KhatamOverlay — Uji Naik Tahap: kuis 10 soal pilihan ganda untuk membuka
 * tahap terkunci. Lulus (≥ 8/10) → unlock permanen via unlockBand (sekali,
 * ref-guard). Assessment only — tidak menyimpan jawaban, tidak menyentuh FSRS.
 */

import { useEffect, useRef, useState } from "react";
import {
	buildKhatamQuiz,
	KHATAM_PASS_SCORE,
	KHATAM_QUESTION_COUNT,
	type KhatamQuestion,
	unlockBand,
} from "../lib/bands";
import { Icon } from "./Icon";

type Phase = "quiz" | "result" | "pass" | "fail";

const DOT_KEYS = Array.from(
	{ length: KHATAM_QUESTION_COUNT },
	(_, i) => `khatam-dot-${i}`,
);

export function KhatamOverlay({
	category,
	onClose,
}: {
	category: string;
	onClose: () => void;
}) {
	const [quiz, setQuiz] = useState<KhatamQuestion[] | null>(null);
	const [cursor, setCursor] = useState(0);
	const [answers, setAnswers] = useState<string[]>([]);
	const [selectedOpt, setSelectedOpt] = useState<string | null>(null);
	const [phase, setPhase] = useState<Phase>("quiz");
	const [seedNonce, setSeedNonce] = useState(0);
	const unlockedRef = useRef(false);

	// Shortcut keyboard: Escape untuk menutup
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	// Bangun kuis (seeded harian) — rebuild saat "Coba lagi" (seedNonce+1).
	useEffect(() => {
		let cancelled = false;
		setQuiz(null);
		void buildKhatamQuiz(category, seedNonce).then((q) => {
			if (cancelled) return;
			setQuiz(q);
			setCursor(0);
			setAnswers([]);
			setSelectedOpt(null);
			setPhase("quiz");
		});
		return () => {
			cancelled = true;
		};
	}, [category, seedNonce]);

	// Setelah semua soal terjawab → hitung skor → pass/fail.
	useEffect(() => {
		if (phase !== "result" || !quiz) return;
		const score = answers.filter((a, i) => a === quiz[i]?.correct).length;
		const passScore = Math.min(
			KHATAM_PASS_SCORE,
			Math.max(1, Math.ceil(quiz.length * 0.8)),
		);
		setPhase(score >= passScore ? "pass" : "fail");
	}, [phase, answers, quiz]);

	// Unlock permanen sekali saat lulus (ref-guard vs double-call).
	useEffect(() => {
		if (phase === "pass" && !unlockedRef.current) {
			unlockedRef.current = true;
			void unlockBand(category);
		}
	}, [phase, category]);

	const answer = (option: string) => {
		if (selectedOpt !== null) return;
		setSelectedOpt(option);
		window.setTimeout(() => {
			const next = [...answers, option];
			setAnswers(next);
			setSelectedOpt(null);
			if (next.length >= quiz.length) {
				setPhase("result");
			} else {
				setCursor((c) => c + 1);
			}
		}, 180);
	};

	const retry = () => {
		setSeedNonce((n) => n + 1);
	};

	const score = quiz
		? answers.filter((a, i) => a === quiz[i]?.correct).length
		: 0;
	const passScore = quiz
		? Math.min(KHATAM_PASS_SCORE, Math.max(1, Math.ceil(quiz.length * 0.8)))
		: KHATAM_PASS_SCORE;
	const passed = Boolean(quiz && quiz.length > 0 && score >= passScore);
	const current = quiz ? quiz[cursor] : undefined;

	return (
		<div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur flex items-center justify-center p-6 pb-[env(safe-area-inset-bottom)]">
			{phase === "quiz" ? (
				<div className="max-w-md w-full mx-auto">
					{/* Header */}
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<span className="font-mono text-[11px] font-bold uppercase px-2 py-1 rounded-[8px] bg-primary/10 text-primary">
								{category}
							</span>
							<span className="font-mono text-[11px] font-bold uppercase text-muted">
								Uji Naik Tahap
							</span>
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label="Tutup"
							className="w-9 h-9 flex items-center justify-center rounded-full bg-surface border border-edge text-muted hover:bg-surface-2 active:scale-95 transition"
						>
							<Icon name="x" className="w-4 h-4" />
						</button>
					</div>

					{quiz === null ? (
						<div className="rounded-card border border-edge bg-surface shadow-2xl p-6">
							<div className="skeleton h-8 w-3/4 mx-auto mb-6" />
							<div className="skeleton h-12 w-full mb-3" />
							<div className="skeleton h-12 w-full mb-3" />
							<div className="skeleton h-12 w-full" />
						</div>
					) : quiz.length === 0 ? (
						<div className="rounded-card border border-edge bg-surface shadow-2xl p-6 text-center">
							<p className="text-base font-bold text-ink mb-2">
								Belum ada kata pada tahap ini
							</p>
							<p className="text-xs text-muted mb-4">
								Muat kosakata terlebih dahulu dari Beranda atau Pengaturan.
							</p>
							<button
								type="button"
								onClick={onClose}
								className="w-full py-2.5 bg-primary text-white font-bold rounded-control"
							>
								Kembali
							</button>
						</div>
					) : current ? (
						<>
							<div className="flex items-center justify-center gap-2 mb-6">
								{DOT_KEYS.map((k, i) => (
									<span
										key={k}
										className={`w-2.5 h-2.5 rounded-full transition-colors ${
											i < answers.length
												? "bg-primary"
												: i === cursor
													? "ring-2 ring-primary bg-surface"
													: "bg-edge"
										}`}
									/>
								))}
							</div>

							{/* Kartu soal */}
							<div className="rounded-card border border-edge bg-surface shadow-2xl p-6">
								<p className="text-2xl md:text-3xl font-extrabold text-ink text-center break-words mb-6">
									{current.front}
								</p>
								<div className="space-y-3">
									{current.options.map((opt) => (
										<button
											key={opt}
											type="button"
											disabled={selectedOpt !== null}
											onClick={() => answer(opt)}
											className={`w-full text-left px-4 py-3 rounded-control border bg-surface text-sm text-ink hover:bg-surface-2 active:scale-[0.98] transition ${
												selectedOpt === opt
													? "border-primary bg-primary/15 font-semibold text-primary"
													: "border-edge"
											}`}
										>
											{opt}
										</button>
									))}
								</div>
							</div>
						</>
					) : null}
				</div>
			) : (
				<div className="max-w-sm w-full mx-auto rounded-card border border-edge bg-surface shadow-2xl p-6 text-center">
					{passed ? (
						<>
							<div className="flex justify-center mb-4">
								<Icon name="trophy" className="w-14 h-14 text-success" />
							</div>
							<h2 className="text-xl font-extrabold text-ink tracking-tight">
								Khatam! {category} terbuka
							</h2>
							<p className="font-mono text-[12px] font-bold text-muted mt-3">
								{score}/{quiz.length || KHATAM_QUESTION_COUNT}
							</p>
							<p className="text-sm text-muted mt-2">Tahap terbuka permanen</p>
							<button
								type="button"
								onClick={onClose}
								className="mt-6 w-full py-3 px-6 bg-primary text-white font-bold rounded-control active:scale-95 transition"
							>
								Lanjut ke Beranda
							</button>
						</>
					) : (
						<>
							<div className="flex justify-center mb-4">
								<Icon name="lock" className="w-14 h-14 text-muted" />
							</div>
							<h2 className="text-xl font-extrabold text-ink tracking-tight">
								Belum lulus ({score}/{quiz.length || KHATAM_QUESTION_COUNT})
							</h2>
							<p className="text-sm text-muted mt-2">
								Butuh minimal {passScore} benar. Review tahap sebelumnya atau
								coba lagi.
							</p>
							<div className="flex gap-3 mt-6">
								<button
									type="button"
									onClick={retry}
									className="flex-1 py-3 bg-primary text-white font-bold rounded-control active:scale-95 transition"
								>
									Coba lagi
								</button>
								<button
									type="button"
									onClick={onClose}
									className="flex-1 py-3 border border-edge bg-surface text-muted font-bold rounded-control active:scale-95 transition"
								>
									Tutup
								</button>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	);
}
