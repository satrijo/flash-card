// apps/web/src/hooks/useCommunityChat.ts
// Obrolan komunitas real-time: pesan + WebSocket + heartbeat 20 detik +
// polling REST 5 detik (fallback saat WebSocket putus). Pemilik state
// messages, status koneksi, jumlah online, dan pembelajar aktif.
import { useEffect, useRef, useState } from "react";
import {
	type ActiveLearner,
	fetchCommunityMessagesRest,
	getWsUrl,
	loadLocalCommunityMessages,
	saveLocalCommunityMessage,
	sendCommunityHeartbeatRest,
	sendCommunityMessageRest,
} from "../lib/community";
import type { CommunityMessage } from "../lib/db";

export type CommunityTab = "chat" | "ai_tutor";

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

export function useCommunityChat({
	activeTab,
	deviceId,
	username,
}: {
	activeTab: CommunityTab;
	deviceId: string;
	username: string;
}) {
	const [messages, setMessages] = useState<CommunityMessage[]>([]);
	const [wsConnected, setWsConnected] = useState(false);
	const [onlineCount, setOnlineCount] = useState(1);
	const [activeLearners, setActiveLearners] = useState<ActiveLearner[]>([]);
	const wsRef = useRef<WebSocket | null>(null);

	// Muat pesan lokal saat pertama kali buka (Offline-First)
	useEffect(() => {
		void loadLocalCommunityMessages(50).then((localMsgs) => {
			if (localMsgs.length > 0) {
				setMessages((prev) => mergeMessages(prev, localMsgs));
			}
		});
	}, []);

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

	// Kirim pesan: optimistic + simpan lokal + REST + WebSocket
	const sendMessage = (payload: CommunityMessage) => {
		// 1. Optimistic update
		setMessages((prev) => mergeMessages(prev, payload));
		void saveLocalCommunityMessage(payload);

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

	return { messages, wsConnected, onlineCount, activeLearners, sendMessage };
}
