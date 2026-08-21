# @flashcard/mcp

MCP stdio server untuk Flashcard SRS — 13 tools: `ping` + 8 core (`list_cards`, `get_card`, `create_card`, `update_card`, `delete_card`, `bulk_create_cards`, `list_categories`, `get_stats`) + 4 advanced (`search_cards`, `review_card`, `import_cards`, `export_cards`).

## Scripts

| Script  | Command                | Keterangan                                  |
| ------- | ---------------------- | ------------------------------------------- |
| `dev`   | `tsx src/index.ts`     | Jalankan langsung dari source (tsx, no build) |
| `build` | `tsc` (via pnpm db/shared build dulu) | Compile ke `dist/`                           |
| `start` | `node dist/index.js`   | Jalankan hasil build                         |

## DB_PATH resolution (createDb di `src/index.ts`)

Urutan prioritas:

1. **`DB_PATH` env** — override eksplisit, contoh: `DB_PATH=/tmp/test.db`
2. **Auto-discovery wrangler D1** — glob `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` (file dengan mtime terbaru). Dibuat oleh:
   ```bash
   pnpm --filter @flashcard/api exec wrangler d1 migrations apply flashcard_db --local
   ```
   Jika `.wrangler/state` belum ada, jalankan perintah di atas dulu agar DB tools memakai data lokal yang benar.
3. **`packages/db/flashcard.db`** — fallback file lokal jika ada.
4. **`:memory:`** — fallback terakhir (untuk test / tanpa DB lokal). `tools/list` tetap sukses; DB tools berjalan di DB kosong.

## Env lain

- **`API_URL`** — reserved untuk future HTTP transport (server saat ini stdio-only; `MCP_USE_HTTP` belum diimplementasikan). Aman di-set, tidak dibaca kode sekarang.

## Contoh penggunaan

```bash
# Dev (tsx) dengan DB eksplisit
DB_PATH=/tmp/test.db pnpm --filter @flashcard/mcp run dev

# Dev dengan API_URL (reserved)
API_URL=http://localhost:8787 pnpm --filter @flashcard/mcp run dev

# Build + jalankan hasil build
pnpm --filter @flashcard/mcp run build && node packages/mcp/dist/index.js
```

## Smoke test stdio

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | node packages/mcp/dist/index.js
```

Harus mengembalikan `serverInfo: { name: "flashcard-mcp", version: "1.0.0" }` dan 13 tools.

## Integrasi client

- **opencode**: project config `opencode.jsonc` (root repo) — entry `mcp.flashcard` dengan `command: ["pnpm", "--filter", "@flashcard/mcp", "run", "dev"]`. DB_PATH sengaja tidak di-set agar auto-discovery berjalan.
- **Claude Desktop**: salin `claude_desktop_config.example.json` ke `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) atau `~/.config/Claude/claude_desktop_config.json` (Linux), sesuaikan path absolut `dist/index.js`.

## Catatan environment

`better-sqlite3` 9.6.0 punya ABI mismatch di environment Node 24 ini — tool DB-backed gagal di sini, tapi `tools/list` sukses (tidak akses DB). Ini isu environment yang sudah diketahui, bukan bug konfigurasi.