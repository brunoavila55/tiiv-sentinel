/**
 * Leitor de EXIF minimo: so GPS e data da captura. Nao vale trazer uma
 * biblioteca de EXIF inteira para dois campos, e todo o resto do metadado e
 * descartado de proposito na recompressao.
 */

export interface ExifData {
  gps: { lat: number; lon: number } | null
  capturedAt: string | null
}

const EMPTY: ExifData = { gps: null, capturedAt: null }

// O EXIF fica no comeco do arquivo; 256KB cobre com folga qualquer celular.
const HEAD_BYTES = 256 * 1024

const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATE_ORIGINAL = 0x9003
const TAG_GPS_LAT_REF = 0x0001
const TAG_GPS_LAT = 0x0002
const TAG_GPS_LON_REF = 0x0003
const TAG_GPS_LON = 0x0004

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

export async function readExif(file: Blob): Promise<ExifData> {
  try {
    const buffer = await file.slice(0, HEAD_BYTES).arrayBuffer()
    return parseJPEG(new DataView(buffer))
  } catch {
    return EMPTY
  }
}

function parseJPEG(view: DataView): ExifData {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return EMPTY
  let offset = 2
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return EMPTY
    const marker = view.getUint8(offset + 1)
    // SOI, TEM e os RSTn nao tem payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    // Comecou a imagem: dai para frente nao ha mais metadado.
    if (marker === 0xda || marker === 0xd9) return EMPTY
    const size = view.getUint16(offset + 2)
    if (marker === 0xe1 && offset + 10 <= view.byteLength && isExifHeader(view, offset + 4)) {
      return parseTIFF(view, offset + 10)
    }
    offset += 2 + size
  }
  return EMPTY
}

function isExifHeader(view: DataView, at: number): boolean {
  // "Exif\0\0"
  return (
    view.getUint32(at) === 0x45786966 && view.getUint8(at + 4) === 0 && view.getUint8(at + 5) === 0
  )
}

interface Entry {
  type: number
  count: number
  /** Offset absoluto do valor no DataView. */
  at: number
}

function parseTIFF(view: DataView, tiff: number): ExifData {
  if (tiff + 8 > view.byteLength) return EMPTY
  const order = view.getUint16(tiff)
  if (order !== 0x4949 && order !== 0x4d4d) return EMPTY
  const le = order === 0x4949
  if (view.getUint16(tiff + 2, le) !== 0x002a) return EMPTY

  const ifd0 = readDir(view, tiff, tiff + view.getUint32(tiff + 4, le), le)

  let gps: ExifData['gps'] = null
  const gpsPointer = ifd0.get(TAG_GPS_IFD)
  if (gpsPointer) {
    const dir = readDir(view, tiff, tiff + readLong(view, gpsPointer, le), le)
    gps = readGPS(view, dir, le)
  }

  let capturedAt: string | null = null
  const exifPointer = ifd0.get(TAG_EXIF_IFD)
  if (exifPointer) {
    const dir = readDir(view, tiff, tiff + readLong(view, exifPointer, le), le)
    capturedAt = readDateTime(view, dir.get(TAG_DATE_ORIGINAL))
  }

  return { gps, capturedAt }
}

function readDir(view: DataView, tiff: number, dirAt: number, le: boolean): Map<number, Entry> {
  const out = new Map<number, Entry>()
  if (dirAt + 2 > view.byteLength) return out
  const count = view.getUint16(dirAt, le)
  for (let i = 0; i < count; i++) {
    const entry = dirAt + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    const tag = view.getUint16(entry, le)
    const type = view.getUint16(entry + 2, le)
    const items = view.getUint32(entry + 4, le)
    const bytes = (TYPE_SIZES[type] ?? 0) * items
    // Valor de ate 4 bytes cabe na propria entrada; acima disso ha um ponteiro.
    const at = bytes <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, le)
    if (at < 0 || at + Math.min(bytes, 4) > view.byteLength) continue
    out.set(tag, { type, count: items, at })
  }
  return out
}

function readLong(view: DataView, entry: Entry, le: boolean): number {
  return view.getUint32(entry.at, le)
}

function readRational(view: DataView, at: number, le: boolean): number {
  const den = view.getUint32(at + 4, le)
  return den === 0 ? 0 : view.getUint32(at, le) / den
}

function readAscii(view: DataView, entry: Entry): string {
  let out = ''
  for (let i = 0; i < entry.count; i++) {
    if (entry.at + i >= view.byteLength) break
    const code = view.getUint8(entry.at + i)
    if (code === 0) break
    out += String.fromCharCode(code)
  }
  return out
}

function readGPS(view: DataView, dir: Map<number, Entry>, le: boolean): ExifData['gps'] {
  const lat = readCoordinate(view, dir.get(TAG_GPS_LAT), dir.get(TAG_GPS_LAT_REF), 'S', le)
  const lon = readCoordinate(view, dir.get(TAG_GPS_LON), dir.get(TAG_GPS_LON_REF), 'W', le)
  if (lat === null || lon === null) return null
  // 0,0 no meio do Atlantico e quase sempre GPS vazio, nao um poste.
  if (lat === 0 && lon === 0) return null
  return { lat, lon }
}

function readCoordinate(
  view: DataView,
  value: Entry | undefined,
  ref: Entry | undefined,
  negative: string,
  le: boolean,
): number | null {
  if (!value || value.type !== 5 || value.count < 3) return null
  if (value.at + 24 > view.byteLength) return null
  const degrees = readRational(view, value.at, le)
  const minutes = readRational(view, value.at + 8, le)
  const seconds = readRational(view, value.at + 16, le)
  const decimal = degrees + minutes / 60 + seconds / 3600
  if (!Number.isFinite(decimal)) return null
  const hemisphere = ref ? readAscii(view, ref).trim().toUpperCase() : ''
  return hemisphere === negative ? -decimal : decimal
}

/** EXIF grava "2026:08:28 14:03:21"; a API quer ISO. */
function readDateTime(view: DataView, entry: Entry | undefined): string | null {
  if (!entry || entry.type !== 2) return null
  const raw = readAscii(view, entry).trim()
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
