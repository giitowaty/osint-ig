// Rysuje ikonę aplikacji (znak marki: celownik w kwadracie) do PNG 1024×1024
// bez zależności: rasteryzacja z nadpróbkowaniem + własny koder PNG (zlib).
// Wynik: src-tauri/app-icon.png → `tauri icon` tworzy z niego wszystkie formaty.
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

const S = 1024
const SS = 3 // nadpróbkowanie na piksel (antyaliasing)
const BG = [28, 25, 23]
const FG = [250, 250, 249]

// Geometria w jednostkach 32×32 (jak favicon.svg), skalowana do S.
const k = S / 32
const C = 16 * k
const ringR = 8.5 * k
const ringW = 2.5 * k
const dotR = 2.6 * k
const tickW = 1.6 * k
const ticks = [
  [16, 3.5, 16, 7.5],
  [16, 24.5, 16, 28.5],
  [3.5, 16, 7.5, 16],
  [24.5, 16, 28.5, 16],
].map((t) => t.map((v) => v * k))

function inkAt(x, y) {
  const d = Math.hypot(x - C, y - C)
  if (Math.abs(d - ringR) <= ringW / 2) return true
  if (d <= dotR) return true
  for (const [x1, y1, x2, y2] of ticks) {
    if (x1 === x2 && Math.abs(x - x1) <= tickW / 2 && y >= y1 && y <= y2) return true
    if (y1 === y2 && Math.abs(y - y1) <= tickW / 2 && x >= x1 && x <= x2) return true
  }
  return false
}

const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  const row = y * (S * 4 + 1)
  raw[row] = 0
  for (let x = 0; x < S; x++) {
    let hit = 0
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) if (inkAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hit++
    const a = hit / (SS * SS)
    const o = row + 1 + x * 4
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a)
    raw[o + 3] = 255
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k2 = 0; k2 < 8; k2++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
])
const out = path.resolve(import.meta.dirname, "..", "src-tauri", "app-icon.png")
fs.writeFileSync(out, png)
console.log(`ikona: ${out} (${(png.length / 1024).toFixed(0)} kB)`)
