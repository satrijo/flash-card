// lib/theme.ts — tema light/dark, persist di localStorage (sync, anti-FOUC).
export type Theme = "light" | "dark";

const STORAGE_KEY = "kata-theme";

export function getStoredTheme(): Theme | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === "dark" || v === "light" ? v : null;
	} catch {
		return null;
	}
}

export function getSystemTheme(): Theme {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function getInitialTheme(): Theme {
	return getStoredTheme() ?? getSystemTheme();
}

export function applyTheme(theme: Theme): void {
	document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setStoredTheme(theme: Theme): void {
	try {
		localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Storage tidak tersedia (private mode) — tema tetap berlaku sesi ini.
	}
}
