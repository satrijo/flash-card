// packages/shared/index.ts
import { fsrs, Rating, generatorParameters, createEmptyCard, } from "ts-fsrs";
// Kamu bisa mengatur parameter custom di sini (misal maximum interval)
const params = generatorParameters({ maximum_interval: 36500 });
// Inisialisasi instance algoritma
export const fsrsEngine = fsrs(params);
// Ekspor juga tipe bawaan agar bisa diakses frontend & backend
export { Rating, createEmptyCard };
