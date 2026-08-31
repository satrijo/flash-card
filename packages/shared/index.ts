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

