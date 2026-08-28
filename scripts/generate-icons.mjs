#!/usr/bin/env node
/*
 * Generator ikon PWA — PNG murni Node (zlib bawaan), tanpa dependensi.
 * Desain: lingkaran krem, cincin oranye, jarum kompas hijau/bata, titik koin.
 * Output: public/icons/icon-192.png, icon-512.png, maskable-512.png
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "web",
  "public",
  "icons",
);
mkdirSync(outDir, { recursive: true });

// ---------- helpers PNG (RGBA, 8-bit) ----------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// pixels: Uint8Array RGBA rows; raw = filter byte 0 per baris
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy
      ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
      : raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// ---------- gambar kompas ----------

function drawCompass(size, { maskable = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const bg = hex("#FDF6EC");
  const ring = hex("#FF8A3D");
  const ringSoft = hex("#F7C948");
  const needleA = hex("#3FA34D"); // utara
  const needleB = hex("#E4572E"); // selatan
  const center = hex("#2D2A26");

  const cx = size / 2;
  const cy = size / 2;

  // Maskable: konten dalam safe zone 80%, bg penuh sampai tepi
  const outerR = maskable ? size * 0.5 : size * 0.48;
  const ringR = maskable ? size * 0.36 : size * 0.40;
  const ringW = size * 0.055;
  const needleR = maskable ? size * 0.26 : size * 0.30;
  const needleW = size * 0.055;
  const dotR = size * 0.035;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      let color = null;

      // Background bulat (atau full-bleed untuk maskable)
      if (maskable || dist <= outerR) {
        color = bg;

        // Cincin ganda: luar oranye, arc kuning di kanan-bawah
        if (Math.abs(dist - ringR) <= ringW / 2) {
          color = ring;
          const angle = Math.atan2(dy, dx); // -PI..PI
          if (angle > -0.4 && angle < 1.4) color = ringSoft;
        }

        // Jarum kompas: belah ketupat vertikal
        if (dist <= needleR) {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          const halfWAtY = ((needleR - ay) / needleR) * needleW;
          if (ax <= halfWAtY && ay <= needleR) {
            color = dy < 0 ? needleA : needleB;
            // garis tengah tipis warna gelap
            if (ax <= needleW * 0.12) color = center;
          }
          // Titik pusat
          if (dist <= dotR * 1.6) color = center;
        }
      }

      const idx = (y * size + x) * 4;
      if (color) {
        px[idx] = color[0];
        px[idx + 1] = color[1];
        px[idx + 2] = color[2];
        px[idx + 3] = 255;
      } else {
        px[idx] = 0;
        px[idx + 1] = 0;
        px[idx + 2] = 0;
        px[idx + 3] = 0; // transparan di luar lingkaran (icon "any")
      }
    }
  }
  return Buffer.from(px.buffer);
}

for (const [name, size, opts] of [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["maskable-512.png", 512, { maskable: true }],
]) {
  const png = encodePng(size, size, drawCompass(size, opts));
  writeFileSync(join(outDir, name), png);
  console.log(`OK ${name} (${png.length} bytes)`);
}
