/*
 * Icon — ikon SVG stroke konsisten (lucide-style, 24x24, currentColor).
 * Pengganti emoji: semua ikon UI lewat sini, tanpa dependency.
 */

import type { ReactNode, SVGProps } from "react";

const PATHS: Record<string, ReactNode> = {
	home: (
		<>
			<path d="M3 10.5 12 3l9 7.5" />
			<path d="M5 9.5V21h14V9.5" />
			<path d="M9.5 21v-6h5v6" />
		</>
	),
	chart: (
		<>
			<path d="M4 20V10" />
			<path d="M10 20V4" />
			<path d="M16 20v-6" />
			<path d="M22 20V8" />
		</>
	),
	settings: (
		<>
			<path d="M4 6h10" />
			<path d="M18 6h2" />
			<circle cx="16" cy="6" r="2" />
			<path d="M4 12h2" />
			<path d="M10 12h10" />
			<circle cx="8" cy="12" r="2" />
			<path d="M4 18h10" />
			<path d="M18 18h2" />
			<circle cx="16" cy="18" r="2" />
		</>
	),
	sun: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
		</>
	),
	moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8" />,
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="m21 21-4.35-4.35" />
		</>
	),
	x: <path d="M18 6 6 18M6 6l12 12" />,
	volume: (
		<>
			<path d="M11 5 6 9H3v6h3l5 4V5z" />
			<path d="M15.5 8.5a5 5 0 0 1 0 7" />
			<path d="M18.5 5.5a9 9 0 0 1 0 13" />
		</>
	),
	star: (
		<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
	),
	flame: (
		<path d="M12 2s4.5 4 4.5 8.5a4.5 4.5 0 0 1-9 0C7.5 9 8 7.5 9 6c-.5 1.5-1 2.2-1 3.5a4 4 0 0 0 8 0C16 4.5 12 2 12 2z" />
	),
	target: (
		<>
			<circle cx="12" cy="12" r="8" />
			<circle cx="12" cy="12" r="3.5" />
			<path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
		</>
	),
	trophy: (
		<>
			<path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4z" />
			<path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
		</>
	),
	lock: (
		<>
			<rect x="5" y="11" width="14" height="10" rx="2" />
			<path d="M8 11V7a4 4 0 0 1 8 0v4" />
		</>
	),
	"chevron-left": <path d="m15 18-6-6 6-6" />,
	"arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
	check: <path d="m4 12 5 5L20 6" />,
	sparkles: (
		<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.4L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.6z" />
	),
	layers: (
		<>
			<path d="m12 2 10 5-10 5L2 7z" />
			<path d="m2 12 10 5 10-5" />
			<path d="m2 17 10 5 10-5" />
		</>
	),
	book: (
		<>
			<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
			<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
		</>
	),
	download: (
		<>
			<path d="M12 3v12" />
			<path d="m7 10 5 5 5-5" />
			<path d="M4 21h16" />
		</>
	),
	refresh: (
		<>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" />
			<path d="M21 3v6h-6" />
		</>
	),
	help: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
			<path d="M12 17h.01" />
		</>
	),
	zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
	award: (
		<>
			<circle cx="12" cy="8" r="6" />
			<path d="m15.48 13.93 2.52 7.07-6-3-6 3 2.52-7.07" />
		</>
	),
	"check-circle": (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="m9 12 2 2 4-4" />
		</>
	),
	play: <polygon points="6 3 20 12 6 21 6 3" />,
	"arrow-up": (
		<>
			<path d="M12 19V5" />
			<path d="m5 12 7-7 7 7" />
		</>
	),
	filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({
	name,
	className,
	...rest
}: { name: IconName; className?: string } & SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
			{...rest}
		>
			{PATHS[name]}
		</svg>
	);
}
