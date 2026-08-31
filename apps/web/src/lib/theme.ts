// apps/web/src/lib/theme.ts — tema light/dark/system, persist di localStorage (sync, anti-FOUC).

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "kata-theme";

export function getStoredTheme(): Theme | null {
	if (typeof window === "undefined") return null;
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === "dark" || v === "light" || v === "system" ? v : null;
	} catch {
		return null;
	}
}

export function getSystemTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function getResolvedTheme(theme?: Theme): "light" | "dark" {
	const t = theme ?? getStoredTheme() ?? "system";
	if (t === "dark") return "dark";
	if (t === "light") return "light";
	return getSystemTheme();
}

export function getInitialTheme(): Theme {
	return getStoredTheme() ?? "system";
}

export function applyTheme(theme: Theme): void {
	if (typeof document === "undefined") return;
	const resolved = getResolvedTheme(theme);
	const isDark = resolved === "dark";
	document.documentElement.classList.toggle("dark", isDark);

	// Update meta theme-color jika ada
	const metaThemeColor = document.querySelector('meta[name="theme-color"]');
	if (metaThemeColor) {
		metaThemeColor.setAttribute("content", isDark ? "#090a0f" : "#f8fafc");
	}
}

export function setStoredTheme(theme: Theme): void {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, theme);
		// Dispatch custom event untuk sinkronisasi antar komponen di tab yang sama
		window.dispatchEvent(
			new CustomEvent("kata-theme-changed", { detail: theme }),
		);
	} catch {
		// Storage tidak tersedia (private mode)
	}
}
