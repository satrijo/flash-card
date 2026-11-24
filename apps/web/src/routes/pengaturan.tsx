/*
 * Rute /pengaturan — satu-satunya tempat kontrol non-gameplay:
 * toggle suara (TTS), target harian global, info deck + unduh ulang,
 * ID Akun Unik, Cadangan Cloud (R2+D1), dan cadangan lokal JSON.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Icon } from "../components/Icon";
import { PengaturanCloudSection } from "../components/PengaturanCloudSection";
import { PengaturanDeckSection } from "../components/PengaturanDeckSection";
import { PengaturanLocalBackupSection } from "../components/PengaturanLocalBackupSection";
import { PengaturanPreferensi } from "../components/PengaturanPreferensi";
import { SharedDeckImportModal } from "../components/SharedDeckImportModal";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { db } from "../lib/db";

export const Route = createFileRoute("/pengaturan")({
	component: PengaturanPage,
});

function PengaturanPage() {
	const gameStats = useLiveQuery(() => db.gameStats.get("user"));
	const lastSyncAt = useLiveQuery(async () => {
		const row = await db.meta.get("lastSyncAt");
		return row?.value as string | undefined;
	});
	const cardCount = useLiveQuery(() => db.cards.count());
	const [backupError, setBackupError] = useState<string | null>(null);
	const [isImportModalOpen, setIsImportModalOpen] = useState(false);
	const online = useOnlineStatus();

	return (
		<div className="py-6 space-y-4">
			<section className="animate-fade-in-up">
				<Link
					to="/"
					className="font-mono text-[12px] font-bold text-muted hover:text-ink transition-colors uppercase tracking-wide inline-flex items-center gap-1 mb-2"
				>
					<Icon name="chevron-left" className="w-4 h-4" />
					Beranda
				</Link>
				<h1 className="text-2xl font-black text-ink tracking-tight">
					Pengaturan
				</h1>
			</section>
			<PengaturanCloudSection
				online={online}
				onCloudError={setBackupError}
				onOpenImportModal={() => setIsImportModalOpen(true)}
			/>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				<PengaturanPreferensi gameStats={gameStats} />
				<div className="space-y-4">
					<PengaturanDeckSection
						cardCount={cardCount}
						lastSyncAt={lastSyncAt}
						online={online}
					/>
					<PengaturanLocalBackupSection
						cardCount={cardCount}
						backupError={backupError}
						onBackupError={setBackupError}
					/>
				</div>
			</div>

			{/* Modal Unduh Koleksi Kartu dari Teman / ID Lain */}
			<SharedDeckImportModal
				isOpen={isImportModalOpen}
				onClose={() => setIsImportModalOpen(false)}
			/>
		</div>
	);
}
