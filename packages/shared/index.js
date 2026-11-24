// packages/shared/index.ts
import { fsrs, Rating, State, generatorParameters, createEmptyCard, } from "ts-fsrs";
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
export { Rating, State, createEmptyCard };
// Normalisasi kategori — satu sumber kebenaran untuk web, API, dan MCP.
// Dulu tiap tempat menulis ulang pola yang sama, dan API/MCP lupa lowercase.
export function normalizeCategory(value) {
    const clean = (value ?? "").trim().toLowerCase();
    return clean === "" ? "general" : clean;
}
// Normalisasi handle pengguna ("Satriyo" -> "kata-satriyo") — dipakai API
// (claim/check handle, komunitas) dan web (cloudBackup). Dulu ada salinan
// identik di kedua tempat.
export function normalizeUserHandle(input) {
    let clean = String(input || "").trim().toLowerCase();
    if (!clean.startsWith("kata-")) {
        clean = `kata-${clean}`;
    }
    clean = clean.replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
    return clean.slice(0, 30);
}
// Handle yang tidak boleh dipakai pengguna (peran sistem / resmi).
export const RESERVED_HANDLES = new Set([
    "kata-admin",
    "kata-administrator",
    "kata-operator",
    "kata-op",
    "kata-mod",
    "kata-moderator",
    "kata-staff",
    "kata-system",
    "kata-support",
    "kata-official",
    "kata-katabot",
    "kata-bot",
    "kata-root",
    "kata-superuser",
    "kata-ai",
    "kata-tutor",
    "kata-help",
    "kata-developer",
    "kata-owner",
    "kata-founder",
    "kata-security",
]);
export function isReservedHandle(handle) {
    const norm = handle.toLowerCase().trim();
    if (RESERVED_HANDLES.has(norm))
        return true;
    const raw = norm.replace(/^kata-/, "");
    const reservedWords = [
        "admin",
        "administrator",
        "operator",
        "moderator",
        "staff",
        "system",
        "support",
        "official",
        "katabot",
        "superuser",
        "root",
        "security",
    ];
    return reservedWords.some((word) => raw === word || raw.startsWith(`${word}-`) || raw.endsWith(`-${word}`));
}
// Nama rating (string, dari input user/API) -> enum Rating ts-fsrs.
// Dulu API dan MCP stdio masing-masing punya salinan map yang sama.
export const FSRS_RATINGS = {
    again: Rating.Again,
    hard: Rating.Hard,
    good: Rating.Good,
    easy: Rating.Easy,
};
// Hitung state kartu berikutnya setelah satu review.
// Kartu asal tidak diubah — hasilnya objek baru.
export function buildFsrsUpdate(card, rating, now) {
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
