/*
 * usePwaInstall — hook PWA install untuk Android, iOS, dan Desktop (Chrome/Edge/Brave).
 * Menggunakan module-level singleton listener agar event beforeinstallprompt tidak pernah hilang.
 */

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DONE_KEY = "pwa-install-done";
const SESSION_DISMISSED_KEY = "pwa-session-dismissed";

export type InstallTarget = "native" | "ios" | "desktop-manual" | "manual";

export interface PwaInstallState {
	isMobile: boolean;
	isInstalled: boolean;
	canInstall: InstallTarget;
	isOpen: boolean;
	accepted: boolean;
	openModal: () => void;
	closeModal: () => void;
	install: () => Promise<void>;
}

// Module-level singleton agar event tidak terlewat jika komponen me-mount belakangan
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let isModalOpen = false;
const promptListeners = new Set<() => void>();

function notifyPromptListeners() {
	for (const fn of promptListeners) {
		fn();
	}
}

if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		globalDeferredPrompt = event as BeforeInstallPromptEvent;
		notifyPromptListeners();
	});

	window.addEventListener("appinstalled", () => {
		globalDeferredPrompt = null;
		isModalOpen = false;
		try {
			localStorage.setItem(DONE_KEY, String(Date.now()));
		} catch {}
		notifyPromptListeners();
	});
}

function isIOS(): boolean {
	if (typeof navigator === "undefined") return false;
	if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true;
	return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

function detectInstalled(): boolean {
	if (typeof window === "undefined") return false;
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		("standalone" in navigator &&
			(navigator as unknown as { standalone?: boolean }).standalone === true)
	);
}

function getTarget(): InstallTarget {
	if (globalDeferredPrompt !== null) return "native";
	if (isIOS()) return "ios";
	if (typeof window !== "undefined") {
		const isMobile =
			window.matchMedia("(pointer: coarse)").matches ||
			window.innerWidth < 1024;
		if (!isMobile) return "desktop-manual";
	}
	return "manual";
}

export function usePwaInstall(): PwaInstallState {
	const [isMobile, setIsMobile] = useState(false);
	const [isInstalled, setIsInstalled] = useState(false);
	const [isOpen, setIsOpen] = useState(isModalOpen);
	const [accepted, setAccepted] = useState(false);
	const [canInstall, setCanInstall] = useState<InstallTarget>(getTarget);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const mobile =
			window.matchMedia("(pointer: coarse)").matches ||
			window.innerWidth < 1024 ||
			isIOS();
		setIsMobile(mobile);

		const installed = detectInstalled();
		setIsInstalled(installed);
		if (installed) {
			try {
				localStorage.setItem(DONE_KEY, String(Date.now()));
			} catch {}
		}

		setCanInstall(getTarget());

		// Auto-open modal di mobile saat first load jika belum pernah di-dismiss di sesi ini
		const sessionDismissed = sessionStorage.getItem(SESSION_DISMISSED_KEY);
		if (mobile && !installed && !sessionDismissed && !isModalOpen) {
			isModalOpen = true;
			setIsOpen(true);
		}

		const handleStateChange = () => {
			const currentInstalled = detectInstalled();
			setIsInstalled(currentInstalled);
			setCanInstall(getTarget());
			setIsOpen(isModalOpen);
		};

		promptListeners.add(handleStateChange);

		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") return;
			if (detectInstalled()) {
				setIsInstalled(true);
				isModalOpen = false;
				globalDeferredPrompt = null;
				notifyPromptListeners();
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			promptListeners.delete(handleStateChange);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	const openModal = () => {
		isModalOpen = true;
		setIsOpen(true);
		notifyPromptListeners();
	};

	const closeModal = () => {
		isModalOpen = false;
		setIsOpen(false);
		try {
			sessionStorage.setItem(SESSION_DISMISSED_KEY, "true");
		} catch {}
		notifyPromptListeners();
	};

	const install = async () => {
		const event = globalDeferredPrompt;
		if (!event) {
			// Jika native prompt belum ready (misal di iOS atau manual), buka modal panduan
			openModal();
			return;
		}
		try {
			await event.prompt();
			const choice = await event.userChoice;
			if (choice.outcome === "accepted") {
				globalDeferredPrompt = null;
				setIsInstalled(true);
				setAccepted(true);
				try {
					localStorage.setItem(DONE_KEY, String(Date.now()));
				} catch {}
				window.setTimeout(() => {
					setAccepted(false);
					closeModal();
				}, 2000);
			} else {
				closeModal();
			}
		} catch {
			closeModal();
		}
	};

	return {
		isMobile,
		isInstalled,
		canInstall,
		isOpen,
		accepted,
		openModal,
		closeModal,
		install,
	};
}
