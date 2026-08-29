import p5 from 'p5'
import type { CropFormat, Generation } from './types'

export type CropRect = { x: number; y: number; width: number; height: number }

const aspects: Record<CropFormat, number | null> = {
  original: null,
  square: 1,
  portrait: 4 / 5,
  landscape: 4 / 3,
  wide: 16 / 9,
}

export function getCropRect(width: number, height: number, generation: Pick<Generation, 'cropFormat' | 'cropX' | 'cropY' | 'cropSize'>): CropRect {
  const aspect = aspects[generation.cropFormat] ?? null
  if (aspect === null) return { x: 0, y: 0, width, height }

  const maxWidth = aspect >= width / height ? width : height * aspect
  const maxHeight = maxWidth / aspect
  const cropWidth = maxWidth * Math.max(1, Math.min(100, generation.cropSize)) / 100
  const cropHeight = maxHeight * Math.max(1, Math.min(100, generation.cropSize)) / 100
  const centerX = (Math.max(0, Math.min(100, generation.cropX)) / 100) * width
  const centerY = (Math.max(0, Math.min(100, generation.cropY)) / 100) * height

  return {
    x: Math.max(0, Math.min(width - cropWidth, centerX - cropWidth / 2)),
    y: Math.max(0, Math.min(height - cropHeight, centerY - cropHeight / 2)),
    width: cropWidth,
    height: cropHeight,
  }
}

export function cropImage(img: p5.Image, generation: Generation) {
  const rect = getCropRect(img.width, img.height, generation)
  return img.get(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height))
}
