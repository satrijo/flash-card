// apps/web/src/lib/analytics.ts
// Integrasi Google Analytics 4 (GA4) untuk tracking pageview & custom event di SPA/PWA

export const GA_MEASUREMENT_ID = "G-2LQ8B05LC0";

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: (...args: unknown[]) => void;
	}
}

// Track page view saat navigasi antar rute TanStack Router
export function trackPageView(path: string, title?: string) {
	if (typeof window !== "undefined" && typeof window.gtag === "function") {
		window.gtag("config", GA_MEASUREMENT_ID, {
			page_path: path,
			page_title: title || document.title,
		});
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
