/*
 * usePwaInstall — prompt instalasi PWA, mobile only.
 * Android: tangkap beforeinstallprompt → prompt() native.
 * iOS: tidak ada event install → fallback instruksi manual 3 langkah.
 * Desktop: tidak ada code path (guard isMobile langsung return).
 */

import { useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const NAG_KEY = "pwa-install-dismissed";
const DONE_KEY = "pwa-install-done";
const NAG_WINDOW_MS = 3 * 864e5; // 3 hari
const IOS_FALLBACK_MS = 4000;

export type InstallTarget = "android" | "ios";

export interface PwaInstallState {
	isMobile: boolean;
	isInstalled: boolean;
	canInstall: InstallTarget | null;
	show: boolean;
	accepted: boolean;
	dismiss: () => void;
	install: () => Promise<void>;
}

function isIOS(): boolean {
	if (typeof navigator === "undefined") return false;
	if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true;
	// iPad modern pakai UA Macintosh + layar sentuh.
	return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

function readNagTimestamp(): number | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(NAG_KEY);
		if (!raw) return null;
		const ts = Number(raw);
		return Number.isFinite(ts) ? ts : null;
	} catch {
		return null;
	}
}

export function usePwaInstall(): PwaInstallState {
	const [isMobile, setIsMobile] = useState(false);
	const [isInstalled, setIsInstalled] = useState(false);
	const [canInstall, setCanInstall] = useState<InstallTarget | null>(null);
	const [dismissedAt, setDismissedAt] = useState<number | null>(null);
	const [accepted, setAccepted] = useState(false);
	const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const mobile =
			window.matchMedia("(pointer: coarse)").matches &&
			window.innerWidth < 1024;
		setIsMobile(mobile);

		const detectInstalled = () =>
			window.matchMedia("(display-mode: standalone)").matches ||
			("standalone" in navigator &&
				(navigator as unknown as { standalone?: boolean }).standalone === true);

		const installed = detectInstalled();
		setIsInstalled(installed);
		if (installed) {
			try {
				localStorage.setItem(DONE_KEY, String(Date.now()));
			} catch {}
		}

		setDismissedAt(readNagTimestamp());

		// Desktop / sudah terpasang: berhenti di sini.
		if (!mobile || installed) return;

		const onBeforeInstallPrompt = (event: Event) => {
			event.preventDefault();
			deferredPrompt.current = event as BeforeInstallPromptEvent;
			setCanInstall("android");
		};
		window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

		// iOS tidak memunculkan beforeinstallprompt — fallback instruksi manual.
		const fallbackTimer = window.setTimeout(() => {
			if (deferredPrompt.current === null && isIOS()) {
				setCanInstall("ios");
			}
		}, IOS_FALLBACK_MS);

		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") return;
			// User bisa meng-install dari tab lain — berhenti menawarkan.
			if (detectInstalled()) {
				setIsInstalled(true);
				setCanInstall(null);
				deferredPrompt.current = null;
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.clearTimeout(fallbackTimer);
		};
	}, []);

	const show =
		isMobile &&
		!isInstalled &&
		canInstall !== null &&
		(dismissedAt === null || Date.now() - dismissedAt >= NAG_WINDOW_MS);

	const dismiss = () => {
		setDismissedAt(Date.now());
		try {
			localStorage.setItem(NAG_KEY, String(Date.now()));
		} catch {}
	};

	const install = async () => {
		const event = deferredPrompt.current;
		if (!event) return;
		deferredPrompt.current = null;
		await event.prompt();
		const choice = await event.userChoice;
		if (choice.outcome === "accepted") {
			setIsInstalled(true);
			setCanInstall(null);
			setAccepted(true);
			try {
				localStorage.setItem(DONE_KEY, String(Date.now()));
			} catch {}
			// Auto-close perayaan kecil.
			window.setTimeout(() => setAccepted(false), 1800);
		} else {
			// Native prompt ditolak — event sekali pakai, jangan tawarkan lagi.
			setCanInstall(null);
		}
	};

	return {
		isMobile,
		isInstalled,
		canInstall,
		show,
		accepted,
		dismiss,
		install,
	};
}
