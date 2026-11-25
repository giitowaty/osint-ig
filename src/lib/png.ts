/* Wspólna obsługa eksportu PNG (graf siłowy, bąbelki): rozmiar obrazu i zapis płótna. */

export interface PngExport {
  blob: Blob
  width: number
  height: number
}

// Limity płótna bezpieczne dla Chrome/WebView2/Safari.
export const MAX_SIDE_PX = 8192
export const MAX_AREA_PX = 32_000_000

/**
 * Rozmiar i skala eksportu całego grafu. Mały graf jest powiększany (dłuższy bok
 * ≥ ok. 1600 px), duży zmniejszany tak, by zmieścić się w limitach płótna.
 */
export function exportLayout(bounds: { x0: number; y0: number; x1: number; y1: number }, preferDpr = 2) {
  const pad = 56
  const footer = 28
  const bw = Math.max(1, bounds.x1 - bounds.x0)
  const bh = Math.max(1, bounds.y1 - bounds.y0)
  let k = Math.min(2.5, Math.max(1, 1600 / Math.max(bw, bh)))
  let dpr = preferDpr
  const dims = () => ({ w: Math.ceil(bw * k + pad * 2), h: Math.ceil(bh * k + pad * 2 + footer) })
  const fitFactor = () => {
    const { w, h } = dims()
    return Math.min(1, MAX_SIDE_PX / (w * dpr), MAX_SIDE_PX / (h * dpr), Math.sqrt(MAX_AREA_PX / (w * h * dpr * dpr)))
  }
  // Najpierw obniżamy gęstość pikseli, dopiero potem zmniejszamy sam graf.
  let f = fitFactor()
  if (f < 1) {
    dpr = Math.max(1, dpr * f)
    f = fitFactor()
  }
  // Pętla, bo margines i stopka nie skalują się razem z grafem.
  for (let i = 0; f < 1 && i < 20; i++) {
    k *= f * 0.98
    f = fitFactor()
  }
  const { w, h } = dims()
  return { w, h, dpr, view: { k, x: pad - bounds.x0 * k, y: pad - bounds.y0 * k } }
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<PngExport | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? { blob, width: canvas.width, height: canvas.height } : null), "image/png")
  })
}
