// apps/web/src/hooks/useTheme.ts — Reactive theme hook with multi-tab & system media query sync

import { useCallback, useEffect, useState } from "react";
import {
	applyTheme,
	getInitialTheme,
	getResolvedTheme,
	setStoredTheme,
	type Theme,
} from "../lib/theme";

export function useTheme(): {
	theme: Theme;
	resolvedTheme: "light" | "dark";
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
} {
	const [theme, setThemeState] = useState<Theme>(() => {
		if (typeof window !== "undefined") {
			return getInitialTheme();
		}
		return "system";
	});

	const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
		if (typeof window !== "undefined") {
			return getResolvedTheme(getInitialTheme());
		}
		return "light";
	});

	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		setStoredTheme(newTheme);
		applyTheme(newTheme);
		setResolvedTheme(getResolvedTheme(newTheme));
	}, []);

	const toggleTheme = useCallback(() => {
		const next: Theme = resolvedTheme === "dark" ? "light" : "dark";
		setTheme(next);
	}, [resolvedTheme, setTheme]);

	useEffect(() => {
		const initial = getInitialTheme();
		setThemeState(initial);
		applyTheme(initial);
		setResolvedTheme(getResolvedTheme(initial));

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleMediaChange = () => {
			const currentStored = getInitialTheme();
			if (currentStored === "system") {
				applyTheme("system");
				setResolvedTheme(getResolvedTheme("system"));
			}
		};

		const handleStorageChange = (e: StorageEvent) => {
			if (e.key === "kata-theme") {
				const nextTheme = (e.newValue as Theme) || "system";
				setThemeState(nextTheme);
				applyTheme(nextTheme);
				setResolvedTheme(getResolvedTheme(nextTheme));
			}
		};

		const handleCustomChange = (e: Event) => {
			const customEvent = e as CustomEvent<Theme>;
			if (customEvent.detail) {
				setThemeState(customEvent.detail);
				setResolvedTheme(getResolvedTheme(customEvent.detail));
			}
		};

		mediaQuery.addEventListener("change", handleMediaChange);
		window.addEventListener("storage", handleStorageChange);
		window.addEventListener("kata-theme-changed", handleCustomChange);

		return () => {
			mediaQuery.removeEventListener("change", handleMediaChange);
			window.removeEventListener("storage", handleStorageChange);
			window.removeEventListener("kata-theme-changed", handleCustomChange);
		};
	}, []);

	return {
		theme,
		resolvedTheme,
		setTheme,
		toggleTheme,
	};
}
