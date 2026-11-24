// apps/web/src/lib/analytics.ts
// Integrasi Google Analytics 4 (GA4) untuk custom event di SPA/PWA.
// Pageview dilacak langsung di routes/__root.tsx (bukan dari sini).

export const GA_MEASUREMENT_ID = "G-2LQ8B05LC0";

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
	}
}

// Track custom event (misal: selesai latihan, tambah kartu, pasang PWA)
export function trackEvent(
	eventName: string,
	eventParams?: Record<string, unknown>,
) {
	if (typeof window !== "undefined" && typeof window.gtag === "function") {
		window.gtag("event", eventName, eventParams);
	}
}
