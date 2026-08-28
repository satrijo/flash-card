/*
 * TTS via Web Speech API — tanpa layanan eksternal.
 *
 * Tiga jebakan yang ditangani di sini:
 *  1. Gesture requirement — Chrome/iOS memblokir speak() tanpa interaksi.
 *     unlockTts() memasang listener sekali di gesture pertama (tap apapun)
 *     dan mengucapkan utterance hening untuk "membuka" engine.
 *  2. Voice async — getVoices() sering kosong di awal (Android); kita cache
 *     dan refresh via onvoiceschanged.
 *  3. Quirk cancel→speak — cancel() internal async; speak ditunda satu tick.
 *
 * Depan (kata EN) → en-US; belakang (terjemahan ID) → id-ID bila tersedia.
 * Toggle on/off persist di Dexie meta ("ttsEnabled", default true).
 */

import { db } from "./db";

export const TTS_META_KEY = "ttsEnabled";

export async function isTtsEnabled(): Promise<boolean> {
	const row = await db.meta.get(TTS_META_KEY);
	return row ? row.value === true : true; // default ON
}

export async function setTtsEnabled(enabled: boolean): Promise<void> {
	await db.meta.put({ key: TTS_META_KEY, value: enabled });
}

export function ttsSupported(): boolean {
	return typeof window !== "undefined" && "speechSynthesis" in window;
}

// ---------------------------------------------------------------------------
// Voice cache — dimuat async, di-refresh lewat onvoiceschanged.
// ---------------------------------------------------------------------------

let voicesCache: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
	if (!ttsSupported()) return [];
	const v = window.speechSynthesis.getVoices();
	if (v.length > 0) voicesCache = v;
	return voicesCache;
}

if (ttsSupported()) {
	loadVoices();
	window.speechSynthesis.onvoiceschanged = () => loadVoices();
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
	const voices = loadVoices();
	if (voices.length === 0) return undefined; // biarkan engine pakai default + lang
	return (
		voices.find(
			(v) => v.lang.toLowerCase().replace("_", "-") === lang.toLowerCase(),
		) ??
		voices.find((v) =>
			v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()),
		) ??
		voices.find((v) => v.default)
	);
}

// ---------------------------------------------------------------------------
// Unlock — engine terbuka di gesture pertama (Chrome/iOS autoplay policy).
// ---------------------------------------------------------------------------

let unlockWired = false;

export function unlockTts(): void {
	if (unlockWired || !ttsSupported()) return;
	unlockWired = true;

	const prime = () => {
		try {
			const warm = new SpeechSynthesisUtterance(" ");
			warm.volume = 0;
			window.speechSynthesis.speak(warm);
		} catch {
			// engine tetap dicoba saat speak() berikutnya
		}
		loadVoices();
	};

	window.addEventListener("pointerdown", prime, { once: true });
	window.addEventListener("keydown", prime, { once: true });
}

// ---------------------------------------------------------------------------
// speak()
// ---------------------------------------------------------------------------

/** Ucapkan teks dengan bahasa tertentu. Resolve saat selesai/gagal. */
export function speak(text: string, lang: "en-US" | "id-ID"): Promise<void> {
	return new Promise((resolve) => {
		if (!ttsSupported() || !text.trim()) {
			resolve();
			return;
		}
		const synth = window.speechSynthesis;
		try {
			synth.cancel();
		} catch {
			// abaikan — lanjut coba speak
		}

		// Tunda satu tick: cancel() internal async; speak di tick sama bisa hilang.
		window.setTimeout(() => {
			try {
				const utterance = new SpeechSynthesisUtterance(text);
				utterance.lang = lang;
				utterance.rate = 0.95;
				const voice = pickVoice(lang);
				if (voice) utterance.voice = voice;

				let done = false;
				const finish = () => {
					if (!done) {
						done = true;
						resolve();
					}
				};
				utterance.onend = finish;
				utterance.onerror = finish;
				synth.speak(utterance);

				// Safety: jangan biarkan promise menggantung jika engine diam.
				window.setTimeout(finish, Math.max(4000, text.length * 150));
			} catch {
				resolve();
			}
		}, 60);
	});
}
