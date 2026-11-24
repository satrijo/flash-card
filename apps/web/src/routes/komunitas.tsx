/*
 * Rute /komunitas — Ruang Komunitas Pembelajar (Mobile-First Redesign).
 * Fitur:
 * 1. Real-Time Multi-User Chat dengan WebSocket Cloudflare Worker + REST polling fallback.
 * 2. Identitas unik anonim per perangkat + ganti nama kapan saja.
 * 3. Fitur lampirkan & bagikan kartu kosakata langsung ke obrolan.
 * 4. Tab AI English Tutor & Roleplay Chat (Roadmap).
 */

import { normalizeUserHandle } from "@flashcard/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { KomunitasActiveUsersModal } from "../components/KomunitasActiveUsersModal";
import { KomunitasAiTutorTab } from "../components/KomunitasAiTutorTab";
import { KomunitasShareModal } from "../components/KomunitasShareModal";
import { KomunitasUsernameModal } from "../components/KomunitasUsernameModal";
import { SharedCardMessageBubble } from "../components/SharedCardMessageBubble";
import { SharedDeckImportModal } from "../components/SharedDeckImportModal";
import { type CommunityTab, useCommunityChat } from "../hooks/useCommunityChat";
import { claimUserHandle } from "../lib/cloud/handle";
import {
	getAvatarGradient,
	getCommunityUsername,
	getInitials,
	getOrCreateDeviceId,
} from "../lib/community";
import { type CommunityMessage, db, type LocalCard } from "../lib/db";

export const Route = createFileRoute("/komunitas")({
	component: KomunitasPage,
});

function KomunitasPage() {
	const [activeTab, setActiveTab] = useState<CommunityTab>("chat");
	const [username, setUsername] = useState(() => getCommunityUsername());
	const [deviceId] = useState(() => getOrCreateDeviceId());
	const [editingUsername, setEditingUsername] = useState(false);
	const [newUsernameInput, setNewUsernameInput] = useState("");

	// Chat state
	const [inputText, setInputText] = useState("");
	const [isActiveUsersModalOpen, setIsActiveUsersModalOpen] = useState(false);
	const [isShareModalOpen, setIsShareModalOpen] = useState(false);
	const [selectedShareCard, setSelectedShareCard] = useState<LocalCard | null>(
		null,
	);
	const [searchShareQuery, setSearchShareQuery] = useState("");
	const [activeUsersSearch, setActiveUsersSearch] = useState("");
	const [isImportModalOpen, setIsImportModalOpen] = useState(false);
	const [selectedShareTargetHandle, setSelectedShareTargetHandle] =
		useState("");

	// Obrolan real-time (pesan, WebSocket, heartbeat, polling)
	const { messages, wsConnected, onlineCount, activeLearners, sendMessage } =
		useCommunityChat({ activeTab, deviceId, username });

	const messagesEndRef = useRef<HTMLDivElement | null>(null);

	const allCards = useLiveQuery(() => db.cards.toArray(), []);

	// Sinkronkan username saat berubah dari tempat lain (mis. /pengaturan)
	useEffect(() => {
		const onUsernameChanged = (e: Event) => {
			const customEvent = e as CustomEvent<string>;
			if (customEvent.detail) {
				setUsername(customEvent.detail);
			}
		};
		window.addEventListener("kata-username-changed", onUsernameChanged);
		return () =>
			window.removeEventListener("kata-username-changed", onUsernameChanged);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom on new messages
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleSendMessage = async (e?: React.FormEvent) => {
		e?.preventDefault();
		const cleanText = inputText.trim();
		if (!cleanText && !selectedShareCard) return;

		const payload: CommunityMessage = {
			id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			username,
			deviceId,
			content: cleanText || `Membagikan kata: "${selectedShareCard?.front}"`,
			flashcardRef: selectedShareCard
				? {
						front: selectedShareCard.front,
						back: selectedShareCard.back,
						category: selectedShareCard.category,
					}
				: undefined,
			timestamp: Date.now(),
		};

		sendMessage(payload);
		setInputText("");
		setSelectedShareCard(null);
	};

	const [adminKeyInput, setAdminKeyInput] = useState("");
	const [usernameError, setUsernameError] = useState<string | null>(null);
	const [isSavingUsername, setIsSavingUsername] = useState(false);

	const handleSaveUsername = async () => {
		if (!newUsernameInput.trim()) {
			setEditingUsername(false);
			return;
		}
		const norm = normalizeUserHandle(newUsernameInput);
		setIsSavingUsername(true);
		setUsernameError(null);
		const res = await claimUserHandle(norm, adminKeyInput);
		setIsSavingUsername(false);

		if (res.success) {
			setUsername(res.handle);
			setEditingUsername(false);
			setAdminKeyInput("");
		} else {
			setUsernameError(res.error || "Gagal mengklaim ID unik");
		}
	};

	const filteredShareCards = allCards
		?.filter((c) => {
			if (!searchShareQuery.trim()) return true;
			const q = searchShareQuery.toLowerCase();
			return (
				c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)
			);
		})
		.slice(0, 30);

	const displayOnlineCount =
		activeLearners.length > 0
			? activeLearners.length
			: Math.max(1, onlineCount);

	return (
		<div className="flex-1 flex flex-col h-full w-full min-w-0 max-w-3xl mx-auto overflow-hidden min-h-0 select-none">
			{/* ===== Top Mobile Bar: Profile, Presence, & Tab Switcher ===== */}
			<div className="shrink-0 space-y-2.5 pt-1.5 pb-2">
				{/* Identity Header */}
				<div className="flex items-center justify-between gap-3 px-1.5">
					<div className="flex items-center gap-2.5 min-w-0">
						<div
							className={`w-9 h-9 rounded-full bg-gradient-to-tr ${getAvatarGradient(
								username,
							)} text-white flex items-center justify-center font-black text-xs shadow-xs shrink-0`}
						>
							{getInitials(username)}
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-1.5 flex-wrap">
								<span className="text-xs sm:text-sm font-black text-ink truncate">
									{username}
								</span>
								{username.includes("admin") && (
									<span className="px-1.5 py-0.2 rounded-pill bg-amber-500/15 text-amber-500 font-mono text-[9px] font-bold border border-amber-500/30">
										👑 Admin
									</span>
								)}
								{username.includes("operator") && (
									<span className="px-1.5 py-0.2 rounded-pill bg-primary/15 text-primary font-mono text-[9px] font-bold border border-primary/30">
										⚡ Operator
									</span>
								)}
								<button
									type="button"
									onClick={() => {
										setNewUsernameInput(username);
										setAdminKeyInput("");
										setUsernameError(null);
										setEditingUsername(true);
									}}
									className="text-[11px] font-bold text-primary hover:underline ml-0.5"
								>
									Ubah
								</button>
							</div>
							<button
								type="button"
								onClick={() => setIsActiveUsersModalOpen(true)}
								className="flex items-center gap-1.5 text-[10.5px] hover:text-primary transition group text-left cursor-pointer"
								title="Klik untuk melihat siapa saja yang sedang aktif dan latihannya"
							>
								<span
									className={`w-2 h-2 rounded-full ${
										wsConnected ? "bg-emerald-500 animate-pulse" : "bg-primary"
									}`}
								/>
								<span className="text-muted font-medium group-hover:text-primary transition">
									{wsConnected ? "Live Connected" : "Online"} •{" "}
									<strong className="text-ink group-hover:text-primary">
										{displayOnlineCount} aktif
									</strong>
								</span>
								<span className="text-[9.5px] text-primary underline ml-0.5">
									(lihat)
								</span>
							</button>
						</div>
					</div>

					{/* Room Badge */}
					<div className="px-2.5 py-1 rounded-pill bg-surface-2 border border-edge text-[10.5px] font-mono font-bold text-muted uppercase shrink-0">
						#Global-Lounge
					</div>
				</div>

				{/* Segmented Tab Switcher */}
				<div className="grid grid-cols-2 p-1 rounded-pill bg-surface border border-edge shadow-xs gap-1">
					<button
						type="button"
						onClick={() => setActiveTab("chat")}
						className={`py-1.5 px-3 rounded-pill text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
							activeTab === "chat"
								? "bg-primary text-white shadow-xs"
								: "text-muted hover:text-ink"
						}`}
					>
						<Icon name="message-circle" className="w-3.5 h-3.5" />
						<span>Obrolan Komunitas</span>
					</button>

					<button
						type="button"
						onClick={() => setActiveTab("ai_tutor")}
						className={`py-1.5 px-3 rounded-pill text-xs font-extrabold flex items-center justify-center gap-1.5 transition ${
							activeTab === "ai_tutor"
								? "bg-primary text-white shadow-xs"
								: "text-muted hover:text-ink"
						}`}
					>
						<Icon name="bot" className="w-3.5 h-3.5" />
						<span>AI English Tutor</span>
						<span className="px-1.5 py-0.2 rounded-pill bg-amber-500/20 text-amber-500 text-[8.5px] font-mono font-bold uppercase">
							Soon
						</span>
					</button>
				</div>
			</div>

			{/* ===== TAB CONTENT 1: MOBILE-FIRST CHAT STREAM ===== */}
			{activeTab === "chat" && (
				<div className="flex-1 flex flex-col min-h-0 rounded-2xl bg-surface border border-edge shadow-xs overflow-hidden">
					{/* Message Stream Scroll Area — THE ONLY SCROLLABLE AREA */}
					<div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3.5 scrollbar-none min-h-0 overscroll-contain">
						{messages.length === 0 ? (
							<div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-muted">
								<div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-1">
									<Icon name="message-circle" className="w-6 h-6" />
								</div>
								<h4 className="text-sm font-bold text-ink">Belum Ada Pesan</h4>
								<p className="text-xs max-w-xs">
									Jadilah yang pertama menyapa komunitas atau bagikan kosakata
									hari ini!
								</p>
							</div>
						) : (
							messages.map((msg) => {
								const isMe = msg.deviceId === deviceId;
								const timeStr = new Date(msg.timestamp).toLocaleTimeString(
									"id-ID",
									{
										hour: "2-digit",
										minute: "2-digit",
									},
								);

								return (
									<div
										key={msg.id}
										className={`flex items-end gap-2 ${
											isMe ? "flex-row-reverse" : "flex-row"
										}`}
									>
										{/* Avatar */}
										{!isMe && (
											<div
												className={`w-7 h-7 rounded-full bg-gradient-to-tr ${getAvatarGradient(
													msg.username,
												)} text-white flex items-center justify-center font-black text-[10px] shrink-0 shadow-xs mb-0.5`}
											>
												{getInitials(msg.username)}
											</div>
										)}

										{/* Message Bubble Container */}
										<div
											className={`max-w-[85%] sm:max-w-[75%] space-y-1 ${
												isMe ? "items-end text-right" : "items-start text-left"
											}`}
										>
											{!isMe && (
												<div className="flex items-center gap-1.5 px-1">
													<span className="text-[10px] font-bold text-muted">
														{msg.username}
													</span>
													{msg.username.includes("admin") && (
														<span className="px-1.5 py-0.2 rounded-pill bg-amber-500/15 text-amber-500 font-mono text-[8px] font-bold border border-amber-500/30">
															👑 Admin
														</span>
													)}
													{msg.username.includes("operator") && (
														<span className="px-1.5 py-0.2 rounded-pill bg-primary/15 text-primary font-mono text-[8px] font-bold border border-primary/30">
															⚡ Operator
														</span>
													)}
												</div>
											)}

											<div
												className={`p-3 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-xs ${
													isMe
														? "bg-primary text-white rounded-br-xs"
														: "bg-surface-2 text-ink border border-edge/70 rounded-bl-xs"
												}`}
											>
												<p className="whitespace-pre-wrap break-words">
													{msg.content}
												</p>

												{/* Shared Flashcard Interactive Attachment */}
												{msg.flashcardRef && (
													<SharedCardMessageBubble
														cardRef={msg.flashcardRef}
														authorUsername={msg.username}
														isMe={isMe}
														onOpenAuthorDeck={(authorHandle) => {
															setSelectedShareTargetHandle(authorHandle);
															setIsImportModalOpen(true);
														}}
													/>
												)}

												<div
													className={`text-[9.5px] mt-1.5 text-right font-mono ${
														isMe ? "text-white/70" : "text-muted"
													}`}
												>
													{timeStr}
												</div>
											</div>
										</div>
									</div>
								);
							})
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Selected Card to Share Preview Banner */}
					{selectedShareCard && (
						<div className="px-3.5 py-2 bg-surface-2 border-t border-primary/30 flex items-center justify-between text-xs animate-fade-in-up gap-2">
							<div className="flex items-center gap-2.5 min-w-0">
								<span className="w-6 h-6 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
									<Icon name="share" className="w-3.5 h-3.5" />
								</span>
								<div className="min-w-0">
									<div className="flex items-center gap-1.5 flex-wrap">
										<span className="font-black text-ink truncate">
											{selectedShareCard.front}
										</span>
										<span className="px-1.5 py-0.2 rounded-pill bg-primary/15 text-primary font-mono text-[9px] font-bold uppercase border border-primary/25">
											{selectedShareCard.category || "general"}
										</span>
									</div>
									<p className="text-[11px] text-muted truncate">
										{selectedShareCard.back}
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={() => setSelectedShareCard(null)}
								className="p-1.5 text-muted hover:text-danger rounded-lg hover:bg-surface transition shrink-0"
								title="Batal lampirkan kartu"
							>
								<Icon name="x" className="w-3.5 h-3.5" />
							</button>
						</div>
					)}

					{/* Mobile-First Input Bar */}
					<form
						onSubmit={(e) => void handleSendMessage(e)}
						className="p-2 sm:p-3 border-t border-edge bg-surface flex items-center gap-2"
					>
						<button
							type="button"
							onClick={() => setIsShareModalOpen(true)}
							title="Bagikan flashcard dari koleksi Anda"
							className="p-2.5 rounded-full bg-surface-2 text-muted hover:text-primary hover:bg-primary/10 border border-edge transition shrink-0 active:scale-95"
						>
							<Icon name="share" className="w-4 h-4" />
						</button>

						<input
							type="text"
							value={inputText}
							onChange={(e) => setInputText(e.target.value)}
							placeholder={
								selectedShareCard
									? "Tambahkan catatan kata…"
									: "Tulis pesan obrolan…"
							}
							className="flex-1 px-3.5 py-2.5 rounded-pill border border-edge bg-surface-2 text-ink text-xs sm:text-sm font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition min-w-0"
						/>

						<button
							type="submit"
							disabled={!inputText.trim() && !selectedShareCard}
							aria-label="Kirim pesan"
							className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none transition shrink-0 shadow-sm shadow-primary/25 active:scale-95"
						>
							<Icon name="send" className="w-4 h-4" />
						</button>
					</form>
				</div>
			)}

			{/* ===== TAB CONTENT 2: AI ENGLISH TUTOR (ROADMAP) ===== */}
			{activeTab === "ai_tutor" && <KomunitasAiTutorTab />}

			{/* ===== MODAL: UBAH USERNAME ===== */}
			{editingUsername && (
				<KomunitasUsernameModal
					newUsernameInput={newUsernameInput}
					onNewUsernameInput={setNewUsernameInput}
					adminKeyInput={adminKeyInput}
					onAdminKeyInput={setAdminKeyInput}
					usernameError={usernameError}
					isSavingUsername={isSavingUsername}
					onSave={() => void handleSaveUsername()}
					onClose={() => setEditingUsername(false)}
				/>
			)}

			{/* ===== MODAL: BAGIKAN KARTU KOSAKATA ===== */}
			{isShareModalOpen && (
				<KomunitasShareModal
					searchQuery={searchShareQuery}
					onSearchQuery={setSearchShareQuery}
					cards={filteredShareCards}
					onSelect={(card) => {
						setSelectedShareCard(card);
						setIsShareModalOpen(false);
					}}
					onClose={() => setIsShareModalOpen(false)}
				/>
			)}

			{/* ===== MODAL: DAFTAR PEMBELAJAR AKTIF & AKTIVITASNYA ===== */}
			{isActiveUsersModalOpen && (
				<KomunitasActiveUsersModal
					learners={activeLearners}
					currentUsername={username}
					displayOnlineCount={displayOnlineCount}
					search={activeUsersSearch}
					onSearch={setActiveUsersSearch}
					onClose={() => setIsActiveUsersModalOpen(false)}
					onDownload={(handle) => {
						setIsActiveUsersModalOpen(false);
						setSelectedShareTargetHandle(handle);
						setIsImportModalOpen(true);
					}}
				/>
			)}

			{/* Modal Unduh Koleksi Kartu dari Pengguna Lain */}
			<SharedDeckImportModal
				isOpen={isImportModalOpen}
				initialHandle={selectedShareTargetHandle}
				onClose={() => setIsImportModalOpen(false)}
			/>
		</div>
	);
}
