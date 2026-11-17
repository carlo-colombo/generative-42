import { createRandom } from './random'

// A deterministic source for the empty stage, so a first visit has something
// to render without shipping a binary sample in the repository.
export async function createSampleImage(): Promise<File | null> {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1200
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const random = createRandom(42)

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  gradient.addColorStop(0, '#0b1d2a')
  gradient.addColorStop(0.55, '#1f5f6b')
  gradient.addColorStop(1, '#f2b35c')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let i = 0; i < 18; i++) {
    ctx.beginPath()
    ctx.arc(random.random(canvas.width), random.random(canvas.height), random.random(40, 260), 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255, 255, 255, ${random.random(0.03, 0.12).toFixed(3)})`
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
  ctx.lineWidth = 2
  for (let i = 0; i < 26; i++) {
    const y = random.random(canvas.height)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y + random.random(-90, 90))
    ctx.stroke()
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new File([blob], 'Sample.png', { type: 'image/png' }) : null
}
