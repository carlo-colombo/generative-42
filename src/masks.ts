import { hashString, shapePolygon } from './areas'
import type { AreaShape, LayerEdge } from './types'
import { measureWasm, type WasmKernels } from './wasm'

export function maskWeightWasm(
  wasm: WasmKernels,
  shape: AreaShape,
  edge: LayerEdge,
  width: number,
  height: number,
  seed: number,
  id: string,
): Float32Array {
  const ring = shapePolygon(shape, width, height)
  const coordinates = new Float64Array(ring.length * 2)
  for (let i = 0; i < ring.length; i++) {
    coordinates[i * 2] = ring[i].x
    coordinates[i * 2 + 1] = ring[i].y
  }
  const params = new Float64Array(5)
  const kind = shape.kind === 'rect' ? 1 : shape.kind === 'ellipse' ? 2 : 0
  if (shape.kind === 'rect') params.set([shape.x, shape.y, shape.w, shape.h, shape.rotation])
  else if (shape.kind === 'ellipse') params.set([shape.cx, shape.cy, shape.rx, shape.ry, shape.rotation])

  const count = width * height
  wasm.pfree()
  const outputPtr = wasm.palloc(count * Float32Array.BYTES_PER_ELEMENT) >>> 0
  const ringPtr = wasm.palloc(coordinates.byteLength) >>> 0
  const paramsPtr = wasm.palloc(params.byteLength) >>> 0
  new Float64Array(wasm.memory.buffer, ringPtr, coordinates.length).set(coordinates)
  new Float64Array(wasm.memory.buffer, paramsPtr, params.length).set(params)
  measureWasm('maskWeight', () => wasm.maskWeight(
    outputPtr,
    ringPtr,
    ring.length,
    width,
    height,
    kind,
    paramsPtr,
    edge.feather,
    edge.jitter,
    edge.mode === 'ragged' ? 1 : 0,
    (seed ^ hashString(id)) >>> 0,
  ))
  return new Float32Array(wasm.memory.buffer, outputPtr, count).slice()
}
