// apps/web/src/hooks/useOnlineStatus.ts
// Status koneksi perangkat (online/offline). SSR-safe: mulai online,
// lalu baca navigator.onLine dan dengarkan perubahan.
import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
	const [online, setOnline] = useState(true);

	useEffect(() => {
		setOnline(navigator.onLine);
		const up = () => setOnline(true);
		const down = () => setOnline(false);
		window.addEventListener("online", up);
		window.addEventListener("offline", down);
		return () => {
			window.removeEventListener("online", up);
			window.removeEventListener("offline", down);
		};
	}, []);

	return online;
}
