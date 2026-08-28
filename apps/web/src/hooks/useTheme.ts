import { useEffect, useState } from "react";
import {
	applyTheme,
	getInitialTheme,
	setStoredTheme,
	type Theme,
} from "../lib/theme";

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
	const [theme, setTheme] = useState<Theme>("light");

	useEffect(() => {
		setTheme(getInitialTheme());
	}, []);

	useEffect(() => {
		applyTheme(theme);
		setStoredTheme(theme);
	}, [theme]);

	return {
		theme,
		toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
	};
}
