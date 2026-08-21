// apps/web/app/hooks/useSyncWorker.ts
import { useEffect } from "react";
import { db } from "../lib/db";
import { api } from "../lib/api";

export function useSyncWorker() {
  useEffect(() => {
    const processQueue = async () => {
      // Jangan jalankan jika sedang offline
      if (!navigator.onLine) return;

      const queue = await db.syncQueue.toArray();
      if (queue.length === 0) return; // Tidak ada yang perlu disinkronkan

      try {
        // Kirim data secara massal (batch) ke backend
        const res = await api.api.sync.$post({
          json: { actions: queue },
        });

        if (res.ok) {
          // Jika sukses diterima server, hapus data dari antrean lokal berdasarkan ID
          const processedIds = queue.map((q) => q.id as number);
          await db.syncQueue.bulkDelete(processedIds);
          console.log(`Berhasil sinkronisasi ${queue.length} aksi`);
        }
      } catch (error) {
        console.error("Sinkronisasi gagal, akan dicoba lagi nanti:", error);
      }
    };

    // Cek antrean setiap 10 detik
    const interval = setInterval(processQueue, 10000);

    // Langsung cek saat koneksi baru tersambung
    window.addEventListener("online", processQueue);

    return () => {
      clearInterval(interval);
      window.removeEventListener("online", processQueue);
    };
  }, []);
}
