// Gera os icones da PWA sem depender de ferramenta de imagem instalada na
// maquina: desenha os pixels na mao e escreve o PNG com o zlib do Node.
// Rode com `npm run icons` depois de mexer no desenho.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../m/public/icons/', import.meta.url))

const BG = [0x0b, 0x0e, 0x14]
const ACCENT = [0x4a, 0x9e, 0xff]

/** PNG RGB de 8 bits, sem filtro por linha. */
function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0 // filtro "none"
    rgb.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3)
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(data.length + 12)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    data.copy(out, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * O simbolo e a propria topologia: um no pai ligado a dois filhos. E o que o
 * app mostra, e a 48px na gaveta de apps ainda se le. Evitamos deliberadamente
 * mastro-com-ponto (vira um "!") e bolinha vermelha (vira alerta — status aqui
 * e do Zabbix).
 *
 * `safe` e a fracao do lado ocupada pelo desenho: 0.62 no icone comum, menos no
 * maskable, onde o launcher recorta ate a zona segura de 80%.
 */
function drawIcon(size, safe) {
  const px = Buffer.alloc(size * size * 3)
  const center = size / 2
  const scale = (size * safe) / 18 // desenho pensado num viewBox de 18
  const stroke = 1.5

  // Antialias por supersampling 3x3: sem isso a diagonal fica serrilhada.
  const samples = [-1 / 3, 0, 1 / 3]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (const sy of samples) {
        for (const sx of samples) {
          if (inGlyph((x + 0.5 + sx - center) / scale, (y + 0.5 + sy - center) / scale, stroke)) hits++
        }
      }
      const alpha = hits / 9
      const i = (y * size + x) * 3
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] + (ACCENT[c] - BG[c]) * alpha)
    }
  }
  return encodePNG(size, size, px)
}

const ROOT = [0, -5.6]
const LEAVES = [
  [-5.6, 4.8],
  [5.6, 4.8],
]
const NODE_R = 2.3

/** Distancia de um ponto ao segmento ab — o traco e a faixa em volta dela. */
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Coordenadas em unidades de viewBox, origem no centro do icone. */
function inGlyph(x, y, w) {
  for (const leaf of LEAVES) {
    // O traco para antes do no para os circulos nao virarem uma massa so.
    if (distToSegment(x, y, ROOT, leaf) <= w / 2) return true
  }
  for (const [nx, ny] of [ROOT, ...LEAVES]) {
    const d = Math.hypot(x - nx, y - ny)
    if (d <= NODE_R) return true
  }
  return false
}

mkdirSync(OUT, { recursive: true })
const files = [
  ['icon-192.png', 192, 0.62],
  ['icon-512.png', 512, 0.62],
  // Maskable: o desenho encolhe porque o launcher recorta as bordas.
  ['maskable-512.png', 512, 0.48],
  // iOS nao aplica mascara e recorta o proprio cantinho arredondado.
  ['apple-touch-icon.png', 180, 0.6],
]
for (const [name, size, safe] of files) {
  writeFileSync(OUT + name, drawIcon(size, safe))
  console.log('gerado', name, size + 'px')
}
