export type WasmKernels = {
  memory: WebAssembly.Memory
  palloc: (bytes: number) => number
  pfree: () => void
  curtainGrid: (
    src: number,
    out: number,
    width: number,
    height: number,
    gridSize: number,
    margin: number,
    curtainCount: number,
    curtainWidth: number,
    randomness: number,
    edgeJitter: number,
    axis: number,
    effect: number,
    seed: number,
  ) => void
  maskWeight: (
    output: number,
    ring: number,
    ringCount: number,
    width: number,
    height: number,
    kind: number,
    params: number,
    feather: number,
    jitter: number,
    ragged: number,
    seed: number,
  ) => void
  compositeLayer: (
    result: number,
    buffer: number,
    mask: number,
    pixelCount: number,
    hasMask: number,
    ragged: number,
    opacity: number,
  ) => void
  detailNoise: (
    source: number,
    target: number,
    width: number,
    height: number,
    colorMode: number,
    seed: number,
  ) => void
  pixelSort: (
    source: number,
    target: number,
    mask: number,
    width: number,
    height: number,
    hasMask: number,
    direction: number,
    reverse: number,
    randomness: number,
    spanWidth: number,
    contained: number,
    jitter: number,
    amountEnabled: number,
    amount: number,
    seed: number,
  ) => void
  poissonSites: (
    width: number,
    height: number,
    target: number,
    seed: number,
    siteXs: number,
    siteYs: number,
    minDistance: number,
    count: number,
  ) => void
  voronoiCells: (
    pixels: number,
    out: number,
    width: number,
    height: number,
    siteXs: number,
    siteYs: number,
    count: number,
    minDistance: number,
  ) => void
  sampleQuads: (
    pixels: number,
    width: number,
    height: number,
    quads: number,
    count: number,
    out: number,
  ) => void
  pixelFilter: (pixels: number, pixelCount: number, filter: number, level: number) => void
}

export async function loadWasmKernels(): Promise<WasmKernels> {
  const response = await fetch('/wasm/kernels.wasm')
  if (!response.ok) throw new Error(`Could not load WASM kernels: ${response.status}`)
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {})
  return instance.exports as unknown as WasmKernels
}

const profiling = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('wasmProfile') === '1'
let sequence = 0
let measureCount = 0

export function measureWasm<T>(name: string, call: () => T): T {
  if (!profiling) return call()
  if (measureCount >= 1000) {
    performance.clearMeasures()
    performance.clearMarks()
    measureCount = 0
  }
  const id = sequence++
  const start = `wasm:${name}:${id}:start`
  const end = `wasm:${name}:${id}:end`
  performance.mark(start)
  try {
    return call()
  } finally {
    performance.mark(end)
    performance.measure(`WASM ${name}`, start, end)
    performance.clearMarks(start)
    performance.clearMarks(end)
    measureCount++
  }
}
