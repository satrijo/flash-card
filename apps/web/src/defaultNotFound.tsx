/*
 * 404 page — Halaman Tidak Ditemukan.
 * Sesuai desain sistem Kata dual-theme (light/dark).
 */

import { Link } from "@tanstack/react-router";
import { Icon } from "./components/Icon";

export default function DefaultNotFound() {
	return (
		<div className="py-24 text-center animate-fade-in-up">
			<div className="w-16 h-16 mx-auto mb-6 rounded-full bg-surface-2 text-muted flex items-center justify-center">
				<Icon name="help" className="w-8 h-8" />
			</div>
			<h1 className="text-2xl font-extrabold text-ink mb-2 tracking-tight">
				Halaman tidak ditemukan
			</h1>
			<p className="text-sm text-muted mb-8 max-w-xs mx-auto">
				Halaman yang kamu tuju tidak ada atau telah dipindahkan.
			</p>
			<Link
				to="/"
				className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-bold rounded-control active:scale-[0.98] transition-transform"
			>
				Kembali ke Beranda
			</Link>
		</div>
	);
}
