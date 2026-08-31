/*
 * Rute /komunitas — Ruang Komunitas Pembelajar (Mobile-First Redesign).
 * Fitur:
 * 1. Real-Time Multi-User Chat dengan WebSocket Cloudflare Worker + REST polling fallback.
 * 2. Identitas unik anonim per perangkat + ganti nama kapan saja.
 * 3. Fitur lampirkan & bagikan kartu kosakata langsung ke obrolan.
 * 4. Tab AI English Tutor & Roleplay Chat (Roadmap).
 */

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { SharedCardMessageBubble } from "../components/SharedCardMessageBubble";
import { SharedDeckImportModal } from "../components/SharedDeckImportModal";
import {
	claimUserHandle,
	isReservedHandle,
	normalizeUserHandle,
} from "../lib/cloudBackup";
import {
	type ActiveLearner,
	fetchCommunityMessagesRest,
	getAvatarGradient,
	getCommunityUsername,
	getInitials,
	getOrCreateDeviceId,
	getWsUrl,
	loadLocalCommunityMessages,
	saveLocalCommunityMessage,
	sendCommunityHeartbeatRest,
	sendCommunityMessageRest,
} from "../lib/community";
import { type CommunityMessage, db, type LocalCard } from "../lib/db";

export const Route = createFileRoute("/komunitas")({
	component: KomunitasPage,
});

type TabType = "chat" | "ai_tutor";

function mergeMessages(
	existing: CommunityMessage[],
	incoming: CommunityMessage | CommunityMessage[],
): CommunityMessage[] {
	const list = Array.isArray(incoming) ? incoming : [incoming];
	const map = new Map<string, CommunityMessage>();
	for (const m of existing) {
		map.set(m.id, m);
	}
	for (const m of list) {
		map.set(m.id, m);
	}
	return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function KomunitasPage() {
	const [activeTab, setActiveTab] = useState<TabType>("chat");
	const [username, setUsername] = useState(() => getCommunityUsername());
	const [deviceId] = useState(() => getOrCreateDeviceId());
	const [editingUsername, setEditingUsername] = useState(false);
	const [newUsernameInput, setNewUsernameInput] = useState("");

	// Chat state
	const [messages, setMessages] = useState<CommunityMessage[]>([]);
	const [inputText, setInputText] = useState("");
	const [wsConnected, setWsConnected] = useState(false);
	const [onlineCount, setOnlineCount] = useState(1);
	const [activeLearners, setActiveLearners] = useState<ActiveLearner[]>([]);
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

	const wsRef = useRef<WebSocket | null>(null);
	const messagesEndRef = useRef<HTMLDivElement | null>(null);

	// Load flashcards for sharing
	const allCards = useLiveQuery(() => db.cards.toArray(), []);

	// Muat pesan lokal saat pertama kali buka (Offline-First)
	useEffect(() => {
		void loadLocalCommunityMessages(50).then((localMsgs) => {
			if (localMsgs.length > 0) {
				setMessages((prev) => mergeMessages(prev, localMsgs));
			}
		});
	}, []);

	// Sinkronisasi Real-Time Multi-User (D1 Database + WebSocket + Heartbeat)
	useEffect(() => {
		if (activeTab !== "chat") return;

		let isUnmounted = false;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
		let pollingTimer: ReturnType<typeof setInterval> | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		// 1. Kirim heartbeat per 20 detik saat di halaman komunitas
		const beat = () => {
			if (document.visibilityState !== "visible") return;
			void sendCommunityHeartbeatRest(deviceId, username, "Di Komunitas").then(
				(res) => {
					if (!isUnmounted && res) {
						setOnlineCount(Math.max(1, res.onlineCount));
						if (res.activeLearners) {
							setActiveLearners(res.activeLearners);
						}
					}
				},
			);
		};
		beat();
		heartbeatTimer = setInterval(beat, 20000);

		// 2. Polling REST hemat kuota (hanya jika WebSocket putus & tab aktif)
		let lastMsgTimestamp = 0;
		const pollMessages = () => {
			if (document.visibilityState !== "visible") return;
			// Jika WebSocket sedang terhubung, WebSocket sudah broadcast secara live (tidak perlu spam D1)
			if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

			void fetchCommunityMessagesRest(lastMsgTimestamp).then((res) => {
				if (isUnmounted || !res) return;
				if (res.messages.length > 0) {
					setMessages((prev) => mergeMessages(prev, res.messages));
					for (const m of res.messages) {
						void saveLocalCommunityMessage(m);
						if (m.timestamp > lastMsgTimestamp) {
							lastMsgTimestamp = m.timestamp;
						}
					}
				}
				if (typeof res.onlineCount === "number") {
					setOnlineCount(Math.max(1, res.onlineCount));
				}
				if (res.activeLearners) {
					setActiveLearners(res.activeLearners);
				}
			});
		};
		pollMessages();
		pollingTimer = setInterval(pollMessages, 5000);

		// 3. Koneksi WebSocket untuk push instant tanpa query database
		function connectWebSocket() {
			const wsUrl = getWsUrl();
			if (!wsUrl) return;

			try {
				const ws = new WebSocket(wsUrl);
				wsRef.current = ws;

				ws.onopen = () => {
					if (isUnmounted) return;
					setWsConnected(true);
				};

				ws.onmessage = (event) => {
					if (isUnmounted) return;
					try {
						const data = JSON.parse(event.data as string);

						if (data.type === "history" && Array.isArray(data.messages)) {
							setMessages((prev) =>
								mergeMessages(prev, data.messages as CommunityMessage[]),
							);
							for (const m of data.messages as CommunityMessage[]) {
								void saveLocalCommunityMessage(m);
							}
							if (typeof data.onlineCount === "number") {
								setOnlineCount(Math.max(1, data.onlineCount));
							}
						} else if (data.type === "new_message" && data.message) {
							const newMsg = data.message as CommunityMessage;
							setMessages((prev) => mergeMessages(prev, newMsg));
							void saveLocalCommunityMessage(newMsg);
						} else if (
							data.type === "presence" &&
							typeof data.onlineCount === "number"
						) {
							setOnlineCount(Math.max(1, data.onlineCount));
						}
					} catch {
						// ignore parse error
					}
				};

				ws.onclose = () => {
					if (isUnmounted) return;
					setWsConnected(false);
					reconnectTimer = setTimeout(connectWebSocket, 3000);
				};

				ws.onerror = () => {
					if (isUnmounted) return;
					setWsConnected(false);
				};
			} catch {
				setWsConnected(false);
				reconnectTimer = setTimeout(connectWebSocket, 4000);
			}
		}

		connectWebSocket();

		return () => {
			isUnmounted = true;
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			if (pollingTimer) clearInterval(pollingTimer);
			if (reconnectTimer) clearTimeout(reconnectTimer);
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, [activeTab, deviceId, username]);

	// Auto scroll saat pesan baru masuk
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom on new messages
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	// Kirim pesan
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

		// 1. Optimistic update
		setMessages((prev) => mergeMessages(prev, payload));
		void saveLocalCommunityMessage(payload);
		setInputText("");
		setSelectedShareCard(null);

		// 2. Kirim ke D1 database via REST (100% tersimpan dan tersinkron ke semua device)
		void sendCommunityMessageRest(payload);

		// 3. Kirim via WebSocket juga jika terbuka
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
			try {
				wsRef.current.send(
					JSON.stringify({
						type: "chat",
						...payload,
					}),
				);
			} catch {
				// ignore
			}
		}
	};

	// Simpan perubahan username (klaim ID unik kata-<nama>)
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

	// Filter kartu untuk dibagikan
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
			{activeTab === "ai_tutor" && (
				<div className="flex-1 overflow-y-auto space-y-3.5 pr-1 scrollbar-none animate-fade-in-up">
					{/* Hero Card */}
					<div className="rounded-2xl bg-gradient-to-tr from-indigo-900/30 via-purple-900/20 to-background border border-primary/30 p-5 text-center relative overflow-hidden">
						<div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-primary to-purple-500 text-white flex items-center justify-center mx-auto mb-3 shadow-md shadow-primary/30 animate-soft-pulse">
							<Icon name="bot" className="w-7 h-7" />
						</div>
						<div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-pill bg-primary/20 text-primary font-mono text-[10.5px] font-bold uppercase mb-2">
							✨ Fitur AI Pintar
						</div>
						<h2 className="text-xl sm:text-2xl font-black text-ink tracking-tight mb-1.5">
							AI English Partner & Roleplay Chat
						</h2>
						<p className="text-xs text-muted max-w-md mx-auto leading-relaxed">
							Praktik percakapan bahasa Inggris interaktif dengan AI cerdas yang
							menyesuaikan dengan kartu kosakata Anda dan memperbaiki grammar
							real-time.
						</p>
					</div>

					{/* 4 Feature Cards */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
							<div className="text-xl mb-1">☕</div>
							<h3 className="text-xs sm:text-sm font-black text-ink">
								Simulasi Skenario Dunia Nyata
							</h3>
							<p className="text-xs text-muted leading-relaxed">
								Latihan pesan kopi di kafe, check-in bandara, wawancara kerja,
								dan diskusi santai.
							</p>
						</div>

						<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
							<div className="text-xl mb-1">🎯</div>
							<h3 className="text-xs sm:text-sm font-black text-ink">
								Koreksi Grammar & Saran Alami
							</h3>
							<p className="text-xs text-muted leading-relaxed">
								Evaluasi tata bahasa instan beserta rekomendasi kalimat penutur
								asli (*native*).
							</p>
						</div>

						<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
							<div className="text-xl mb-1">🧠</div>
							<h3 className="text-xs sm:text-sm font-black text-ink">
								Integrasi Flashcard SRS
							</h3>
							<p className="text-xs text-muted leading-relaxed">
								AI sengaja memancing kata yang sedang sering Anda lupakan ke
								dalam dialog latihan.
							</p>
						</div>

						<div className="p-4 rounded-xl bg-surface border border-edge space-y-1.5">
							<div className="text-xl mb-1">🔊</div>
							<h3 className="text-xs sm:text-sm font-black text-ink">
								Speaking & Voice Practice
							</h3>
							<p className="text-xs text-muted leading-relaxed">
								Dengarkan pelafalan akurat dan latih berbicara langsung lewat
								audio.
							</p>
						</div>
					</div>

					<div className="p-3.5 text-center rounded-xl bg-surface-2 border border-edge text-xs text-muted font-medium">
						🚀 Sedang dalam tahap pengembangan akhir. Fitur AI English Tutor
						akan segera hadir pada pembaruan berikutnya!
					</div>
				</div>
			)}

			{/* ===== MODAL: UBAH USERNAME ===== */}
			{editingUsername && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
					<div className="bg-surface rounded-2xl border border-edge p-5 max-w-sm w-full shadow-2xl space-y-4">
						<div className="flex items-center justify-between pb-2 border-b border-edge">
							<h3 className="text-sm font-black text-ink">
								Ubah Nama Panggilan
							</h3>
							<button
								type="button"
								onClick={() => setEditingUsername(false)}
								className="text-muted hover:text-ink"
							>
								<Icon name="x" className="w-4 h-4" />
							</button>
						</div>
						<div className="space-y-1.5">
							<label
								htmlFor="input-username"
								className="font-mono text-[11px] font-bold text-muted uppercase block"
							>
								Nama / ID Unik Komunitas (kata-...)
							</label>
							<input
								id="input-username"
								type="text"
								maxLength={30}
								value={newUsernameInput}
								onChange={(e) => setNewUsernameInput(e.target.value)}
								placeholder="kata-joane"
								className="w-full px-3.5 py-2.5 rounded-control border border-edge bg-surface-2 text-ink text-sm font-mono font-bold focus:outline-none focus:border-primary"
							/>
							<p className="text-[11px] text-muted font-mono">
								Otomatis berformat <code>kata-&lt;nama&gt;</code> dan harus unik
								secara global.
							</p>

							{/* Admin Key Prompt jika handle merupakan ID khusus */}
							{isReservedHandle(normalizeUserHandle(newUsernameInput)) && (
								<div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-2 animate-fade-in-up">
									<div className="flex items-center gap-1.5 text-xs text-amber-500 font-bold">
										<Icon name="sparkles" className="w-4 h-4" />
										<span>ID Khusus Admin / Operator</span>
									</div>
									<p className="text-[11px] text-muted leading-relaxed">
										ID ini dilindungi. Masukkan{" "}
										<strong>Admin Secret Key</strong> untuk mengonfirmasi hak
										akses admin kamu:
									</p>
									<input
										type="password"
										value={adminKeyInput}
										onChange={(e) => setAdminKeyInput(e.target.value)}
										placeholder="Admin Secret Key…"
										className="w-full px-3 py-1.5 rounded-control font-mono text-xs font-bold bg-surface border border-edge text-ink focus:outline-none focus:border-amber-500"
									/>
								</div>
							)}
						</div>

						{usernameError && (
							<div className="p-2.5 rounded-xl bg-danger/10 border border-danger/20 text-xs text-danger font-medium">
								{usernameError}
							</div>
						)}

						<div className="flex items-center gap-2 pt-2">
							<button
								type="button"
								onClick={() => setEditingUsername(false)}
								className="flex-1 py-2.5 rounded-control border border-edge text-ink text-xs font-bold hover:bg-surface-2"
							>
								Batal
							</button>
							<button
								type="button"
								onClick={handleSaveUsername}
								disabled={isSavingUsername || !newUsernameInput.trim()}
								className="flex-1 py-2.5 rounded-control bg-primary text-white text-xs font-bold hover:bg-primary-hover disabled:opacity-50 shadow-xs"
							>
								{isSavingUsername ? "Menyimpan…" : "Simpan ID"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ===== MODAL: BAGIKAN KARTU KOSAKATA ===== */}
			{isShareModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
					<div className="bg-surface rounded-2xl border border-edge max-w-md w-full p-4 sm:p-5 shadow-2xl space-y-3.5 max-h-[85vh] flex flex-col">
						<div className="flex items-center justify-between pb-2 border-b border-edge">
							<div className="flex items-center gap-2">
								<Icon name="share" className="w-4 h-4 text-primary" />
								<h3 className="text-sm font-black text-ink">
									Pilih Kartu untuk Dibagikan
								</h3>
							</div>
							<button
								type="button"
								onClick={() => setIsShareModalOpen(false)}
								className="text-muted hover:text-ink"
							>
								<Icon name="x" className="w-4 h-4" />
							</button>
						</div>

						{/* Search Bar in Picker */}
						<div className="relative">
							<Icon
								name="search"
								className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2"
							/>
							<input
								type="text"
								value={searchShareQuery}
								onChange={(e) => setSearchShareQuery(e.target.value)}
								placeholder="Cari kata di deck Anda…"
								className="w-full pl-9 pr-3 py-2 rounded-control border border-edge bg-surface-2 text-xs text-ink font-medium focus:outline-none focus:border-primary"
							/>
						</div>

						<div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-none">
							{filteredShareCards?.length === 0 ? (
								<p className="text-xs text-muted text-center py-6">
									Tidak ada kartu yang cocok.
								</p>
							) : (
								filteredShareCards?.map((card) => (
									<button
										key={card.id}
										type="button"
										onClick={() => {
											setSelectedShareCard(card);
											setIsShareModalOpen(false);
										}}
										className="w-full p-2.5 rounded-xl bg-surface-2 hover:bg-primary/10 border border-edge hover:border-primary/40 text-left transition flex items-center justify-between gap-3 group"
									>
										<div className="min-w-0">
											<div className="font-bold text-xs sm:text-sm text-ink group-hover:text-primary transition">
												{card.front}
											</div>
											<div className="text-[11px] text-muted truncate">
												{card.back}
											</div>
										</div>
										<Icon
											name="plus"
											className="w-4 h-4 text-muted group-hover:text-primary shrink-0"
										/>
									</button>
								))
							)}
						</div>
					</div>
				</div>
			)}

			{/* ===== MODAL: DAFTAR PEMBELAJAR AKTIF & AKTIVITASNYA ===== */}
			{isActiveUsersModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in-up">
					<div className="bg-surface rounded-2xl border border-edge max-w-sm w-full p-4 sm:p-5 shadow-2xl space-y-3 max-h-[85vh] flex flex-col">
						<div className="flex items-center justify-between pb-2 border-b border-edge">
							<div className="flex items-center gap-2">
								<span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
								<h3 className="text-sm font-black text-ink">
									Pembelajar Aktif ({displayOnlineCount})
								</h3>
							</div>
							<button
								type="button"
								onClick={() => setIsActiveUsersModalOpen(false)}
								className="text-muted hover:text-ink p-1 rounded-lg hover:bg-surface-2"
							>
								<Icon name="x" className="w-4 h-4" />
							</button>
						</div>

						{/* Breakdown Kategori Aktivitas */}
						<div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono font-bold">
							<span className="px-2 py-0.5 rounded-pill bg-amber-500/15 text-amber-500 border border-amber-500/20">
								📚{" "}
								{
									activeLearners.filter((l) =>
										l.activity.toLowerCase().includes("latihan"),
									).length
								}{" "}
								Latihan
							</span>
							<span className="px-2 py-0.5 rounded-pill bg-primary/15 text-primary border border-primary/20">
								💬{" "}
								{
									activeLearners.filter((l) =>
										l.activity.toLowerCase().includes("komunitas"),
									).length
								}{" "}
								Komunitas
							</span>
							<span className="px-2 py-0.5 rounded-pill bg-surface-2 text-muted border border-edge">
								🏠{" "}
								{
									activeLearners.filter(
										(l) =>
											!l.activity.toLowerCase().includes("latihan") &&
											!l.activity.toLowerCase().includes("komunitas"),
									).length
								}{" "}
								Halaman Lain
							</span>
						</div>

						{/* Search Bar for 100+ active users */}
						{activeLearners.length > 5 && (
							<div className="relative">
								<Icon
									name="search"
									className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2"
								/>
								<input
									type="text"
									value={activeUsersSearch}
									onChange={(e) => setActiveUsersSearch(e.target.value)}
									placeholder="Cari nama atau aktivitas…"
									className="w-full pl-8.5 pr-3 py-1.5 rounded-control border border-edge bg-surface-2 text-xs text-ink font-medium focus:outline-none focus:border-primary"
								/>
							</div>
						)}

						<div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-none max-h-64">
							{activeLearners.length === 0 ? (
								<div className="p-4 text-center text-xs text-muted">
									Memuat aktivitas pembelajar…
								</div>
							) : (
								activeLearners
									.filter((l) => {
										if (!activeUsersSearch.trim()) return true;
										const q = activeUsersSearch.toLowerCase();
										return (
											l.username.toLowerCase().includes(q) ||
											l.activity.toLowerCase().includes(q)
										);
									})
									.map((learner) => {
										const isMe = learner.username === username;
										const isPracticing = learner.activity
											.toLowerCase()
											.includes("latihan");

										return (
											<div
												key={`${learner.username}-${learner.lastSeen}`}
												className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
													isMe
														? "bg-primary/10 border-primary/30"
														: "bg-surface-2/60 border-edge/80"
												}`}
											>
												<div className="flex items-center gap-2.5 min-w-0">
													<div
														className={`w-8 h-8 rounded-full bg-gradient-to-tr ${getAvatarGradient(
															learner.username,
														)} text-white flex items-center justify-center font-black text-xs shrink-0 shadow-xs`}
													>
														{getInitials(learner.username)}
													</div>
													<div className="min-w-0">
														<div className="flex items-center gap-1.5">
															<span className="font-bold text-xs text-ink truncate">
																{learner.username}
															</span>
															{isMe && (
																<span className="px-1.5 py-0.2 rounded-pill bg-primary text-white text-[9px] font-mono font-bold">
																	Kamu
																</span>
															)}
														</div>
														<div className="flex items-center gap-1.5 mt-0.5">
															<span
																className={`w-1.5 h-1.5 rounded-full shrink-0 ${
																	isPracticing
																		? "bg-amber-500 animate-pulse"
																		: "bg-emerald-500"
																}`}
															/>
															<span
																className={`text-[11px] font-medium truncate ${
																	isPracticing
																		? "text-amber-500 font-bold"
																		: "text-muted"
																}`}
															>
																{learner.activity}
															</span>
														</div>
													</div>
												</div>

												{!isMe && (
													<button
														type="button"
														onClick={() => {
															setIsActiveUsersModalOpen(false);
															setSelectedShareTargetHandle(learner.username);
															setIsImportModalOpen(true);
														}}
														className="px-2.5 py-1 rounded-pill bg-primary/10 hover:bg-primary/20 text-primary font-mono text-[10px] font-bold border border-primary/25 transition flex items-center gap-1 shrink-0 active:scale-95"
														title={`Unduh & gabungkan kartu dari @${learner.username}`}
													>
														<Icon name="download" className="w-3 h-3" />
														<span>Unduh</span>
													</button>
												)}
											</div>
										);
									})
							)}
						</div>

						<button
							type="button"
							onClick={() => setIsActiveUsersModalOpen(false)}
							className="w-full py-2.5 rounded-control bg-primary text-white text-xs font-bold hover:bg-primary-hover shadow-xs mt-1"
						>
							Tutup
						</button>
					</div>
				</div>
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
