/*
 * KhatamOverlay — Uji Naik Tahap: kuis 10 soal pilihan ganda untuk membuka
 * tahap terkunci. Lulus (≥ 8/10) → unlock permanen via unlockBand (sekali,
 * ref-guard). Assessment only — tidak menyimpan jawaban, tidak menyentuh FSRS.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	buildKhatamQuiz,
	getBandMeta,
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
	const [mounted, setMounted] = useState(false);
	const unlockedRef = useRef(false);
	const meta = getBandMeta(category);

	useEffect(() => {
		setMounted(true);
	}, []);

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
		if (selectedOpt !== null || !quiz) return;
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

	if (!mounted || typeof document === "undefined") {
		return null;
	}

	return createPortal(
		<div className="fixed inset-0 z-[200] bg-background/80 backdrop-blur-md flex items-center justify-center p-4 md:p-6 pb-[env(safe-area-inset-bottom)] animate-fade-in-up">
			{phase === "quiz" ? (
				<div className="max-w-md w-full mx-auto space-y-4">
					{/* Header */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span
								className={`font-mono text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-[6px] ${meta.colorClass}`}
							>
								{meta.title}
							</span>
							<span className="font-mono text-[11px] font-bold uppercase text-muted tracking-wider">
								Uji Naik Tahap
							</span>
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label="Tutup"
							className="w-8 h-8 flex items-center justify-center rounded-full bg-surface border border-edge text-muted hover:text-ink hover:bg-surface-2 active:scale-95 transition shadow-2xs"
						>
							<Icon name="x" className="w-4 h-4" />
						</button>
					</div>

					{quiz === null ? (
						<div className="rounded-card border border-edge bg-surface shadow-card p-6 space-y-4">
							<div className="skeleton h-8 w-3/4 mx-auto" />
							<div className="skeleton h-12 w-full" />
							<div className="skeleton h-12 w-full" />
							<div className="skeleton h-12 w-full" />
						</div>
					) : quiz.length === 0 ? (
						<div className="rounded-card border border-edge bg-surface shadow-card p-6 text-center">
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
							<div className="flex items-center justify-center gap-2 mb-4">
								{DOT_KEYS.map((k, i) => (
									<span
										key={k}
										className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
											i < answers.length
												? "bg-primary scale-110"
												: i === cursor
													? "ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary"
													: "bg-surface-2 border border-edge"
										}`}
									/>
								))}
							</div>

							{/* Kartu soal */}
							<div className="rounded-card border border-edge bg-surface shadow-card p-6 md:p-8 space-y-6">
								<div className="text-center space-y-1">
									<span className="text-xs font-mono font-bold uppercase tracking-wider text-muted">
										Soal {cursor + 1} dari {quiz.length}
									</span>
									<p className="text-3xl md:text-4xl font-black text-ink break-words tracking-tight">
										{current.front}
									</p>
								</div>
								<div className="space-y-2.5">
									{current.options.map((opt) => (
										<button
											key={opt}
											type="button"
											disabled={selectedOpt !== null}
											onClick={() => answer(opt)}
											className={`w-full text-left px-4 py-3.5 rounded-control border text-sm font-semibold transition-all active:scale-[0.98] ${
												selectedOpt === opt
													? "border-primary bg-primary/15 font-bold text-primary shadow-xs"
													: "border-edge bg-surface text-ink hover:bg-surface-2 hover:border-primary/40"
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
				<div className="max-w-sm w-full mx-auto rounded-card border border-edge bg-surface shadow-card p-6 text-center space-y-4">
					{passed ? (
						<>
							<div className="w-16 h-16 rounded-2xl bg-success/15 text-success flex items-center justify-center mx-auto shadow-md shadow-success/20">
								<Icon name="trophy" className="w-8 h-8" />
							</div>
							<div>
								<h2 className="text-2xl font-black text-ink tracking-tight">
									Selamat! Tahap Terbuka!
								</h2>
								<p className="text-sm text-muted mt-1 font-medium">
									Tahap <strong className="text-ink">{meta.title}</strong>{" "}
									berhasil dibuka permanen.
								</p>
								<p className="font-mono text-xs font-bold text-success mt-2 bg-success/10 py-1 px-3 rounded-pill inline-block">
									Skor: {score}/{quiz?.length || KHATAM_QUESTION_COUNT} Benar
								</p>
							</div>
							<button
								type="button"
								onClick={onClose}
								className="w-full py-3.5 px-6 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-95 transition shadow"
							>
								Lanjut Belajar
							</button>
						</>
					) : (
						<>
							<div className="w-16 h-16 rounded-2xl bg-danger/10 text-danger flex items-center justify-center mx-auto">
								<Icon name="lock" className="w-8 h-8" />
							</div>
							<div>
								<h2 className="text-xl font-black text-ink tracking-tight">
									Belum Lulus Kuis
								</h2>
								<p className="text-xs text-muted mt-1 font-medium">
									Kamu menjawab benar {score} dari{" "}
									{quiz?.length || KHATAM_QUESTION_COUNT} soal (butuh minimal{" "}
									{passScore}).
								</p>
							</div>
							<div className="flex gap-2.5 pt-2">
								<button
									type="button"
									onClick={retry}
									className="flex-1 py-3 bg-primary text-white font-bold rounded-control hover:bg-primary-hover active:scale-95 transition shadow-sm text-sm"
								>
									Coba Lagi
								</button>
								<button
									type="button"
									onClick={onClose}
									className="flex-1 py-3 border border-edge bg-surface text-ink font-bold rounded-control hover:bg-surface-2 active:scale-95 transition text-sm"
								>
									Tutup
								</button>
							</div>
						</>
					)}
				</div>
			)}
		</div>,
		document.body,
	);
}
