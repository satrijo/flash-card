/*
 * Kata — Kosakata Harian. Modern playful, dual theme (light/dark).
 * Shell: header brand + toggle tema, bottom tab bar (Beranda/Statistik/Pengaturan),
 * FOUC-safe inline script theme di head, SyncGate + InstallOverlay global.
 */

import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect } from "react";
import { Icon } from "../components/Icon";
import { InstallOverlay } from "../components/InstallOverlay";
import { SyncGate } from "../components/SyncGate";
import { useAutoSync } from "../hooks/useAutoSync";
import { useCloudSync } from "../hooks/useCloudSync";
import { useGlobalPresence } from "../hooks/useGlobalPresence";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { useTheme } from "../hooks/useTheme";
import { unlockTts } from "../lib/tts";

import appCss from "../styles.css?url";

const FOUC_SCRIPT =
	"(function(){try{var t=localStorage.getItem('kata-theme');var isDark=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',isDark)}catch(e){}})()";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{
				title: "Kata — Kosakata Harian",
			},
			{
				name: "theme-color",
				content: "#f6f6f3",
				media: "(prefers-color-scheme: light)",
			},
			{
				name: "theme-color",
				content: "#0f0f13",
				media: "(prefers-color-scheme: dark)",
			},
			{
				name: "description",
				content: "Kata demi kata, setiap hari — kosakata Inggris offline.",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "manifest",
				href: "/manifest.webmanifest",
			},
			{
				rel: "icon",
				type: "image/png",
				href: "/icons/icon-192.png",
			},
			{
				rel: "apple-touch-icon",
				href: "/icons/icon-192.png",
			},
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@600&display=swap",
			},
		],
		scripts: [
			{
				src: "https://www.googletagmanager.com/gtag/js?id=G-2LQ8B05LC0",
				async: true,
			},
			{
				children:
					"window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', 'G-2LQ8B05LC0');",
			},
			{
				children: FOUC_SCRIPT,
			},
			{
				children:
					"if ('serviceWorker' in navigator) { var r = function() { navigator.serviceWorker.register('/sw.js').then(function(reg) { reg.update().catch(function(){}) }).catch(function(){}) }; if (document.readyState === 'complete' || document.readyState === 'interactive') { r(); } else { window.addEventListener('DOMContentLoaded', r); window.addEventListener('load', r); } }",
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	useAutoSync();
	useCloudSync();
	useGlobalPresence();
	const pwa = usePwaInstall();
	// Buka speech engine di gesture pertama (kebijakan autoplay Chrome/iOS).
	unlockTts();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;
	const { resolvedTheme, toggleTheme } = useTheme();

	useEffect(() => {
		if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
			navigator.serviceWorker
				.register("/sw.js")
				.then((reg) => reg.update().catch(() => {}))
				.catch(() => {});
		}
	}, []);

	// Lacak perpindahan halaman SPA ke Google Analytics
	useEffect(() => {
		if (typeof window !== "undefined" && typeof window.gtag === "function") {
			window.gtag("config", "G-2LQ8B05LC0", {
				page_path: currentPath,
				page_title: document.title,
			});
		}
	}, [currentPath]);

	const isFixedViewport =
		currentPath.startsWith("/latihan") || currentPath.startsWith("/komunitas");

	return (
		<html
			lang="id"
			className={`${resolvedTheme === "dark" ? "dark" : ""} ${
				isFixedViewport ? "h-full overflow-hidden" : "overflow-x-hidden"
			}`.trim()}
			suppressHydrationWarning
		>
			<head>
				<HeadContent />
			</head>
			<body
				className={`bg-background text-ink ${
					isFixedViewport
						? "h-[100dvh] overflow-hidden flex flex-col"
						: "min-h-[100dvh] overflow-x-hidden"
				}`}
				suppressHydrationWarning
			>
				{/* Ambient glow */}
				<div className="effect-glow" aria-hidden="true" />

				{/* Header — brand + nav desktop + toggle tema + pengaturan */}
				<nav className="fixed top-0 inset-x-0 z-40 bg-background/85 backdrop-blur-lg border-b border-edge/80 pt-[env(safe-area-inset-top)] transition-colors">
					<div className="relative z-10 max-w-xl md:max-w-4xl lg:max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
						<div className="flex items-center gap-6">
							<Link
								to="/"
								className="flex items-center gap-2 font-extrabold text-lg tracking-tight group"
							>
								<div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-primary to-indigo-500 text-white flex items-center justify-center shadow-sm shadow-primary/30 group-hover:scale-105 transition-transform">
									<Icon name="sparkles" className="w-4 h-4" />
								</div>
								<span className="bg-gradient-to-r from-ink via-ink to-primary bg-clip-text text-transparent font-black">
									Kata
								</span>
							</Link>
							{/* Desktop Nav links */}
							<div className="hidden md:flex items-center gap-1">
								<Link
									to="/"
									className={`px-3.5 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/"
											? "bg-primary text-white shadow-sm shadow-primary/20"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Beranda
								</Link>
								<Link
									to="/kelola"
									className={`px-3.5 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/kelola"
											? "bg-primary text-white shadow-sm shadow-primary/20"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Kelola Deck
								</Link>
								<Link
									to="/komunitas"
									className={`px-3.5 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/komunitas"
											? "bg-primary text-white shadow-sm shadow-primary/20"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Komunitas
								</Link>
								<Link
									to="/statistik"
									className={`px-3.5 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/statistik"
											? "bg-primary text-white shadow-sm shadow-primary/20"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Statistik
								</Link>
								<Link
									to="/pengaturan"
									className={`px-3.5 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/pengaturan"
											? "bg-primary text-white shadow-sm shadow-primary/20"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Pengaturan
								</Link>
							</div>
						</div>
						<div className="flex items-center gap-1.5">
							{!pwa.isInstalled && (
								<button
									type="button"
									onClick={pwa.openModal}
									className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill bg-gradient-to-r from-primary to-indigo-600 hover:from-primary-hover hover:to-indigo-700 text-white font-bold text-xs shadow-sm shadow-primary/25 active:scale-95 transition-all"
								>
									<Icon name="download" className="w-3.5 h-3.5" />
									<span>Pasang App</span>
								</button>
							)}
							<button
								type="button"
								onClick={toggleTheme}
								aria-label={
									resolvedTheme === "dark"
										? "Pindah ke mode terang"
										: "Pindah ke mode gelap"
								}
								className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-surface border border-edge text-muted hover:text-ink hover:bg-surface-2 active:scale-95 transition shadow-sm"
							>
								<Icon
									name={resolvedTheme === "dark" ? "sun" : "moon"}
									className="w-4 h-4"
								/>
							</button>
							<Link
								to="/pengaturan"
								aria-label="Pengaturan"
								className={`md:hidden inline-flex items-center justify-center w-9 h-9 rounded-full border transition-colors shadow-sm ${
									currentPath === "/pengaturan"
										? "bg-primary text-white border-primary shadow-primary/20"
										: "bg-surface border-edge text-muted hover:bg-surface-2"
								}`}
							>
								<Icon name="settings" className="w-4 h-4" />
							</Link>
						</div>
					</div>
				</nav>

				<main
					className={`relative max-w-xl md:max-w-4xl lg:max-w-5xl mx-auto w-full px-2 sm:px-4 md:px-6 ${
						isFixedViewport
							? "flex-1 h-[calc(100dvh-3.5rem)] md:h-[calc(100dvh-3.5rem)] pt-16 sm:pt-17 pb-18 md:pb-3 overflow-hidden flex flex-col min-h-0"
							: "pt-20 sm:pt-22 pb-24 md:pb-12"
					}`}
				>
					{children}
				</main>

				{/* Bottom tab bar — thumb zone mobile (5 columns) */}
				<div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/85 backdrop-blur-lg border-t border-edge/80 pb-[env(safe-area-inset-bottom)] shadow-lg shadow-black/5">
					<div className="max-w-md mx-auto grid grid-cols-5 h-16">
						<TabLink
							to="/"
							active={currentPath === "/"}
							icon="home"
							label="Beranda"
						/>
						<TabLink
							to="/kelola"
							active={currentPath === "/kelola"}
							icon="layers"
							label="Kelola"
						/>
						<TabLink
							to="/komunitas"
							active={currentPath === "/komunitas"}
							icon="users"
							label="Komunitas"
						/>
						<TabLink
							to="/statistik"
							active={currentPath === "/statistik"}
							icon="chart"
							label="Statistik"
						/>
						<TabLink
							to="/pengaturan"
							active={currentPath === "/pengaturan"}
							icon="settings"
							label="Pengaturan"
						/>
					</div>
				</div>

				<SyncGate />
				<InstallOverlay />

				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}

function TabLink({
	to,
	active,
	icon,
	label,
}: {
	to: "/" | "/kelola" | "/komunitas" | "/statistik" | "/pengaturan";
	active: boolean;
	icon: "home" | "layers" | "users" | "chart" | "settings";
	label: string;
}) {
	return (
		<Link
			to={to}
			className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-all relative ${
				active ? "text-primary scale-105" : "text-muted hover:text-ink"
			}`}
		>
			<div
				className={`w-10 h-7 rounded-pill flex items-center justify-center transition-all ${
					active ? "bg-primary/10" : ""
				}`}
			>
				<Icon name={icon} className="w-5 h-5" />
			</div>
			<span>{label}</span>
		</Link>
	);
}
