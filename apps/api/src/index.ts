// apps/api/src/index.ts
// Composition root: Hono + CORS + per-domain route modules + /mcp.
// Tidak ada logika bisnis di sini — semua handler tinggal di modulnya.
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { cors } from "hono/cors";
import { getD1, type Bindings } from "./lib/env";
import { deckRoutes } from "./routes/deck";
import { communityRoutes } from "./routes/community";
import { backupRoutes } from "./routes/backup";
import { MCP_TOOLS, TOOLS_DESCRIPTOR, type D1Db } from "./mcp/tools";

const app = new Hono<{ Bindings: Bindings }>()
  .use("/*", cors())
  .route("/", deckRoutes)
  .route("/", communityRoutes)
  .route("/", backupRoutes);

// ===========================================================================
// MCP HTTP ROUTES — GET (discovery) + POST (JSON-RPC)
// ===========================================================================

const mcpRoutes = app
  .get("/mcp", async (c) => {
    return c.json({
      name: "flashcard-mcp",
      version: "1.0.0",
      transport: "http",
      tools: TOOLS_DESCRIPTOR,
    });
  })
  .post("/mcp", async (c) => {
    // Optional Bearer token auth
    const mcpToken = c.env.MCP_TOKEN;
    if (mcpToken) {
      const auth = c.req.header("authorization");
      if (auth !== `Bearer ${mcpToken}`) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32001, message: "Unauthorized" },
          },
          401,
        );
      }
    }

    let body: {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        400,
      );
    }

    const { id, method, params } = body;

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "flashcard-mcp", version: "1.0.0" },
        },
      });
    }

    if (method === "tools/list") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS_DESCRIPTOR },
      });
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      if (typeof toolName !== "string") {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing tool name" },
        });
      }

      const tool = MCP_TOOLS[toolName];
      if (!tool) {
        return c.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
      }

      try {
        const args = tool.schema.parse(params?.arguments ?? {});
        const db = drizzle(getD1(c));
        const result = await (tool.handler as (
          a: typeof args,
          d: D1Db,
        ) => Promise<unknown>)(args, db);
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (error) {
        const err = error as Error & { cause?: unknown; message?: string };
        const cause = err.cause as { message?: string; toString?: () => string } | undefined;
        const causeMsg = cause?.message ?? (cause ? String(cause) : "no cause");
        const message =
          err instanceof Error
            ? `${err.message}\ncauseMsg: ${causeMsg}\ncauseStr: ${String(err.cause)}\nstack: ${err.stack?.slice(0, 800)}`
            : JSON.stringify(error, null, 2);
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: message }],
            isError: true,
          },
        });
      }
    }

    return c.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });

export type AppType = typeof mcpRoutes;
export default app;
