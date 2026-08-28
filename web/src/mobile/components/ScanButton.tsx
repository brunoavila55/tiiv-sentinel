import { useEffect, useRef, useState } from 'react'

/**
 * Leitura da etiqueta do equipamento. Se o ISP ja etiqueta o ativo, este vira o
 * caminho mais rapido de todos — nada de digitar nome com luva.
 *
 * Usa a BarcodeDetector do proprio navegador. Sem ela (iOS, Firefox) o botao
 * simplesmente nao aparece: trazer um decodificador em JS custaria mais bundle
 * que o app inteiro.
 */

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  // getUserMedia so existe em contexto seguro; sem HTTPS nao ha camera.
  if (!ctor || !navigator.mediaDevices?.getUserMedia) return null
  return ctor
}

export function ScanButton({ onResult }: { onResult: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!detectorCtor()) return null

  return (
    <>
      <button type="button" className="btn-scan" onClick={() => setOpen(true)} aria-label="Ler etiqueta">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
          <path d="M4 12h16" />
        </svg>
      </button>
      {open && (
        <Scanner
          onClose={() => setOpen(false)}
          onResult={(value) => {
            setOpen(false)
            onResult(value)
          }}
        />
      )}
    </>
  )
}

function Scanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const Detector = detectorCtor()
    if (!Detector) return
    let stream: MediaStream | null = null
    let frame = 0
    let alive = true
    const detector = new Detector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] })

    const loop = async () => {
      if (!alive || !video.current) return
      try {
        const found = await detector.detect(video.current)
        if (found.length > 0 && found[0].rawValue) {
          onResult(found[0].rawValue.trim())
          return
        }
      } catch {
        // quadro sem codigo legivel; segue
      }
      frame = requestAnimationFrame(() => void loop())
    }

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (!alive || !video.current) return
        video.current.srcObject = stream
        await video.current.play()
        void loop()
      } catch {
        setError('nao foi possivel abrir a camera')
      }
    }
    void start()

    return () => {
      alive = false
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onResult])

  return (
    <div className="viewer" role="dialog" aria-modal="true">
      <header className="viewer-bar">
        <button type="button" className="viewer-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
        <span className="viewer-title">Aponte para a etiqueta</span>
      </header>
      <div className="scanner">
        {error ? (
          <p className="viewer-empty">{error}</p>
        ) : (
          <video ref={video} className="scanner-video" muted playsInline />
        )}
      </div>
    </div>
  )
}
