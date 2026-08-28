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
import { Icon } from "../components/Icon";
import { InstallOverlay } from "../components/InstallOverlay";
import { SyncGate } from "../components/SyncGate";
import { useAutoSync } from "../hooks/useAutoSync";
import { useTheme } from "../hooks/useTheme";
import { unlockTts } from "../lib/tts";

import appCss from "../styles.css?url";

const FOUC_SCRIPT =
	"(function(){try{var t=localStorage.getItem('kata-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}})()";

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
				children: FOUC_SCRIPT,
			},
			{
				children:
					"if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').then((reg) => { reg.update().catch(() => {}) }).catch(() => {}) }) }",
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	useAutoSync();
	// Buka speech engine di gesture pertama (kebijakan autoplay Chrome/iOS).
	unlockTts();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;
	const { theme, toggleTheme } = useTheme();

	return (
		<html lang="id">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-ink min-h-[100dvh]">
				{/* Ambient glow */}
				<div className="effect-glow" aria-hidden="true" />

				{/* Header — brand + nav desktop + toggle tema + pengaturan */}
				<nav className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-edge pt-[env(safe-area-inset-top)]">
					<div className="relative z-10 max-w-md md:max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
						<div className="flex items-center gap-6">
							<Link
								to="/"
								className="flex items-center gap-2 font-extrabold text-lg text-primary tracking-tight"
							>
								<Icon name="sparkles" className="w-5 h-5" />
								Kata
							</Link>
							{/* Desktop Nav links */}
							<div className="hidden md:flex items-center gap-1">
								<Link
									to="/"
									className={`px-3 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/"
											? "bg-primary/10 text-primary"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Beranda
								</Link>
								<Link
									to="/statistik"
									className={`px-3 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/statistik"
											? "bg-primary/10 text-primary"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Statistik
								</Link>
								<Link
									to="/pengaturan"
									className={`px-3 py-1.5 rounded-pill text-xs font-bold transition ${
										currentPath === "/pengaturan"
											? "bg-primary/10 text-primary"
											: "text-muted hover:text-ink hover:bg-surface-2"
									}`}
								>
									Pengaturan
								</Link>
							</div>
						</div>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={toggleTheme}
								aria-label={
									theme === "dark"
										? "Pindah ke mode terang"
										: "Pindah ke mode gelap"
								}
								className="inline-flex items-center justify-center w-10 h-10 rounded-full text-muted hover:bg-surface-2 active:scale-95 transition"
							>
								<Icon
									name={theme === "dark" ? "sun" : "moon"}
									className="w-5 h-5"
								/>
							</button>
							<Link
								to="/pengaturan"
								aria-label="Pengaturan"
								className={`md:hidden inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
									currentPath === "/pengaturan"
										? "bg-primary/15 text-primary"
										: "text-muted hover:bg-surface-2"
								}`}
							>
								<Icon name="settings" className="w-5 h-5" />
							</Link>
						</div>
					</div>
				</nav>

				<main className="relative z-10 max-w-md md:max-w-3xl mx-auto px-4 pb-24 md:pb-12 pt-[env(safe-area-inset-bottom)]">
					{children}
				</main>

				{/* Bottom tab bar — thumb zone mobile */}
				<div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/90 backdrop-blur-md border-t border-edge pb-[env(safe-area-inset-bottom)]">
					<div className="max-w-md mx-auto grid grid-cols-3 h-16">
						<TabLink
							to="/"
							active={currentPath === "/"}
							icon="home"
							label="Beranda"
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
	to: "/" | "/statistik" | "/pengaturan";
	active: boolean;
	icon: "home" | "chart" | "settings";
	label: string;
}) {
	return (
		<Link
			to={to}
			className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
				active ? "text-primary" : "text-muted"
			}`}
		>
			<Icon name={icon} className="w-5 h-5" />
			{label}
		</Link>
	);
}
