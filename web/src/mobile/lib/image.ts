import { readExif } from './exif'

/**
 * Compressao no cliente. Foto de celular tem 8-12MB; em 4G de poste esse upload
 * falha. Depois daqui fica em torno de 400KB.
 *
 * A recompressao apaga todo o EXIF de graca — a coordenada, unico metadado que
 * interessa, e lida antes e viaja em campo separado no confirm.
 */

export const MAX_SIDE = 1920
export const JPEG_QUALITY = 0.8

export interface CompressedPhoto {
  blob: Blob
  filename: string
  width: number
  height: number
  gps: { lat: number; lon: number } | null
  capturedAt: string | null
}

export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const exif = await readExif(file)
  const bitmap = await decode(file)

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas indisponivel neste navegador')
  ctx.drawImage(bitmap, 0, 0, width, height)
  if ('close' in bitmap) bitmap.close()

  let blob = await toBlob(canvas)
  // Foto ja pequena as vezes cresce ao ser recomprimida. Nesse caso o original
  // vale mais: o backend limpa o EXIF de qualquer jeito no pos-processamento.
  if (scale === 1 && blob.size >= file.size && file.type === 'image/jpeg') {
    blob = file
  }

  return {
    blob,
    filename: jpegName(file.name),
    width,
    height,
    gps: exif.gps,
    capturedAt: exif.capturedAt ?? (file.lastModified ? new Date(file.lastModified).toISOString() : null),
  }
}

/**
 * createImageBitmap resolve a orientacao do EXIF sozinho — sem isso a foto
 * tirada em pe sobe deitada. O caminho por <img> e para o Safari antigo, que
 * ignora a opcao mas ja aplica a orientacao na decodificacao.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // cai para o <img>
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('nao foi possivel ler a imagem'))
      img.src = url
    })
    return img
  } finally {
    // A revogacao imediata quebraria o <img> ainda em uso; adiamos um tick.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('falha comprimindo a foto'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

function jpegName(original: string): string {
  const base = original.replace(/\.[^.]+$/, '') || 'foto'
  return `${base}.jpg`
}

/**
 * GPS do aparelho, usado quando a foto vem sem coordenada no EXIF (comum em
 * Android com a permissao de localizacao negada para a camera). Timeout curto:
 * a foto nao pode ficar esperando o sinal do satelite.
 */
export function currentPosition(timeout = 4000): Promise<{ lat: number; lon: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60_000 },
    )
  })
}
