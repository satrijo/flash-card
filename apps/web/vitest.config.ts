// apps/web/vitest.config.ts
// Konfigurasi test terpisah dari vite.config.ts: plugin Cloudflare di sana
// tidak kompatibel dengan environment SSR vitest, dan test hanya butuh
// logika murni (bukan dev server / worker). Test berjalan di node.
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
