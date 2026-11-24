// apps/api/src/mcp-http.test.ts
// Characterization test — seam: handler HTTP tanpa D1, via app.request.
// Hanya rute yang tidak menyentuh D1 (GET /api/hello, GET /mcp, POST /mcp
// dengan method initialize/tools/list dan tools/call ping — handler ping
// tidak memakai db; drizzle(undefined) tidak throw, dibuktikan sebelum test
// ini ditulis). Rute D1 TIDAK dipaksakan tanpa D1 (keputusan T2, design §4):
// rute itu dijaga oleh parity tabel rute + typecheck + build.

import { describe, expect, it } from "vitest";
import app from "./index";

// Bentuk respons JSON-RPC dari POST /mcp (sukses atau error).
interface McpJsonRpcResponse {
	jsonrpc: string;
	id: number;
	result?: {
		protocolVersion?: string;
		serverInfo?: { name: string; version: string };
		tools?: { name: string }[];
		content?: { type: string; text: string }[];
	};
	error?: { code: number; message: string };
}

const TOOL_NAMES = [
	"ping",
	"list_cards",
	"get_card",
	"create_card",
	"update_card",
	"delete_card",
	"bulk_create_cards",
	"list_categories",
	"get_stats",
	"search_cards",
	"review_card",
	"import_cards",
	"export_cards",
];

async function postMcp(body: unknown) {
	// app.request tanpa env -> c.env undefined dan handler POST /mcp throw
	// saat membaca c.env.MCP_TOKEN. Env kosong cukup: token tidak diset,
	// jadi jalur auth dilewati — sama seperti worker tanpa MCP_TOKEN.
	const res = await app.request(
		"/mcp",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
		{},
	);
	return { status: res.status, json: (await res.json()) as McpJsonRpcResponse };
}

describe("GET /api/hello", () => {
	it("200 + pesan sapaan (kontrak hello)", async () => {
		const res = await app.request("/api/hello");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ message: "Hello from Cloudflare D1!" });
	});
});

describe("GET /mcp (discovery)", () => {
	it("200 + 13 tool, nama-nama persis", async () => {
		const res = await app.request("/mcp");
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			name: string;
			version: string;
			tools: { name: string }[];
		};
		expect(json.name).toBe("flashcard-mcp");
		expect(json.version).toBe("1.0.0");
		expect(json.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
	});
});

describe("POST /mcp (JSON-RPC)", () => {
	it("initialize -> protocolVersion 2024-11-05", async () => {
		const { status, json } = await postMcp({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {},
		});
		expect(status).toBe(200);
		expect(json.result?.protocolVersion).toBe("2024-11-05");
		expect(json.result?.serverInfo).toEqual({
			name: "flashcard-mcp",
			version: "1.0.0",
		});
	});

	it("tools/list -> 13 tool yang sama dengan GET /mcp", async () => {
		const { json } = await postMcp({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
		});
		expect(json.result?.tools?.map((t: { name: string }) => t.name)).toEqual(
			TOOL_NAMES,
		);
	});

	it("tools/call ping -> pong", async () => {
		const { json } = await postMcp({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "ping", arguments: {} },
		});
		expect(json.result?.content).toEqual([
			{ type: "text", text: '"pong"' },
		]);
	});

	it("tools/call tool tak dikenal -> -32601", async () => {
		const { json } = await postMcp({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "tidak_ada", arguments: {} },
		});
		expect(json.error?.code).toBe(-32601);
	});

	it("method tak dikenal -> -32601", async () => {
		const { json } = await postMcp({
			jsonrpc: "2.0",
			id: 5,
			method: "resources/list",
		});
		expect(json.error?.code).toBe(-32601);
	});

	it("body bukan JSON -> 400, -32700", async () => {
		const res = await app.request(
			"/mcp",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{bukan json",
			},
			{},
		);
		expect(res.status).toBe(400);
		const json = (await res.json()) as McpJsonRpcResponse;
		expect(json.error?.code).toBe(-32700);
	});
});
