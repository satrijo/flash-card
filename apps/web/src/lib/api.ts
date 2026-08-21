// apps/web/app/lib/api.ts
import { hc } from "hono/client";
import type { AppType } from "@flashcard/api"; // Mengambil type secara langsung dari backend

// Masukkan URL lokal dari wrangler (default Hono Workers: 8787)
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

// hc akan secara otomatis mengetahui semua rute dan tipe balikan (response) dari backend
export const api = hc<AppType>(API_URL);
