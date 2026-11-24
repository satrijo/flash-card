// packages/shared/index.ts
import {
  fsrs,
  Rating,
  State,
  type Card as FSRSCard,
  generatorParameters,
  createEmptyCard,
} from "ts-fsrs";

// Parameter FSRS standar Anki:
// - maximum_interval: 36500 (100 tahun)
// - request_retention: 0.9 (90% target retensi optimal)
// - enable_fuzz: true (Anki anti-spike: sebar interval masa depan secara alami)
const params = generatorParameters({
  maximum_interval: 36500,
  request_retention: 0.9,
  enable_fuzz: true,
});

// Inisialisasi instance algoritma
export const fsrsEngine = fsrs(params);

// Ekspor juga tipe bawaan agar bisa diakses frontend & backend
export { Rating, State, type FSRSCard, createEmptyCard };

// Normalisasi kategori — satu sumber kebenaran untuk web, API, dan MCP.
// Dulu tiap tempat menulis ulang pola yang sama, dan API/MCP lupa lowercase.
export function normalizeCategory(value: string | undefined): string {
	const clean = (value ?? "").trim().toLowerCase();
	return clean === "" ? "general" : clean;
}

// Nama rating (string, dari input user/API) -> enum Rating ts-fsrs.
// Dulu API dan MCP stdio masing-masing punya salinan map yang sama.
export const FSRS_RATINGS = {
	again: Rating.Again,
	hard: Rating.Hard,
	good: Rating.Good,
	easy: Rating.Easy,
} as const;

export type FsrsRatingName = keyof typeof FSRS_RATINGS;

// Rating yang bisa diberikan saat review — Manual bukan rating review
// (di ts-fsrs tidak ada hasil repeat untuk Manual).
export type FsrsReviewRating =
	| Rating.Again
	| Rating.Hard
	| Rating.Good
	| Rating.Easy;

// Hasil sebuah review FSRS: tepat 10 field yang dipersist ke kartu.
// Dulu web (EkspedisiCard), API (review_card), dan MCP stdio (review_card)
// masing-masing menulis ulang daftar field yang sama.
export interface FsrsUpdate {
	due: Date;
	state: State;
	stability: number;
	difficulty: number;
	elapsed_days: number;
	scheduled_days: number;
	learning_steps: number;
	reps: number;
	lapses: number;
	last_review: Date | undefined;
}

// Hitung state kartu berikutnya setelah satu review.
// Kartu asal tidak diubah — hasilnya objek baru.
export function buildFsrsUpdate(
	card: FSRSCard,
	rating: FsrsReviewRating,
	now: Date,
): FsrsUpdate {
	const next = fsrsEngine.repeat(card, now)[rating].card;
	return {
		due: next.due,
		state: next.state,
		stability: next.stability,
		difficulty: next.difficulty,
		elapsed_days: next.elapsed_days,
		scheduled_days: next.scheduled_days,
		learning_steps: next.learning_steps,
		reps: next.reps,
		lapses: next.lapses,
		last_review: next.last_review,
	};
}

