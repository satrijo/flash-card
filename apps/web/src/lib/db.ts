// apps/web/app/lib/db.ts
import Dexie, { type EntityTable } from "dexie";
import type { FSRSCard } from "@flashcard/shared";

export interface LocalCard extends FSRSCard {
  id: string;
  front: string;
  back: string;
  category: string;
}

// Struktur data untuk aksi yang tertunda
export interface SyncAction {
  id?: number; // Auto-increment ID
  action: "REVIEW_CARD";
  payload: {
    id: string;
    nextState: FSRSCard;
    category?: string;
  };
}

const db = new Dexie("FlashcardDB") as Dexie & {
  cards: EntityTable<LocalCard, "id">;
  syncQueue: EntityTable<SyncAction, "id">; // Tabel baru
};

// Naikkan versi ke 2
db.version(2).stores({
  cards: "id, due",
  syncQueue: "++id", // ++ artinya auto-increment
});

// Naikkan versi ke 3: tambah index category untuk filtering
db.version(3).stores({
  cards: "id, due, category",
  syncQueue: "++id",
});

export { db };
