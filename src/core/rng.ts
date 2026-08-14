export function mulberry32(seed: number): () => number {
  let state = seed
  return function () {
    state |= 0 // Convert to 32-bit integer
    let t = ((state + 0x6d2b79f5) | 0) * 15
    t = (t ^ (t >>> 15)) | 0
    t = (t + (t << 7)) | 0
    t = (t ^ (t >>> 4)) | 0
    t = (t * 1103515245 + 12345) | 0
    state = t
    return ((t >>> 0) / 4294967296)
  }
}

export function pick<T>(rng: () => number, xs: readonly T[]): T {
  const index = Math.floor(rng() * xs.length)
  return xs[index]
}

export function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1))
}
