import { mulberry32 } from './areas'

export type Random = {
  next(): number
  random(a?: number, b?: number): number
}

export function createRandom(seed: number): Random {
  const next = mulberry32(seed)
  return {
    next,
    random(a?: number, b?: number): number {
      const value = next()
      if (a === undefined) return value
      if (b === undefined) return value * a
      return a + value * (b - a)
    },
  }
}
