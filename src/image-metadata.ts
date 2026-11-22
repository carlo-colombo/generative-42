const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const EXIF_PREFIX = new Uint8Array([69, 120, 105, 102, 0, 0])
const encoder = new TextEncoder()

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

async function readBlob(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

async function extractJpegExif(blob: Blob): Promise<Uint8Array | null> {
  const signature = await readBlob(blob, 0, 2)
  if (signature[0] !== 0xff || signature[1] !== 0xd8) return null
  let offset = 2
  while (offset + 4 <= blob.size) {
    const prefix = await readBlob(blob, offset, offset + 2)
    if (prefix[0] !== 0xff) return null
    let marker = prefix[1]
    offset += 2
    while (marker === 0xff && offset < blob.size) {
      marker = (await readBlob(blob, offset, offset + 1))[0]
      offset++
    }
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const lengthBytes = await readBlob(blob, offset, offset + 2)
    if (lengthBytes.length < 2) return null
    const length = (lengthBytes[0] << 8) | lengthBytes[1]
    if (length < 2 || offset + length > blob.size) return null
    const start = offset + 2
    const end = offset + length
    if (marker === 0xe1 && length >= EXIF_PREFIX.length + 2) {
      const exifPrefix = await readBlob(blob, start, start + EXIF_PREFIX.length)
      if (startsWith(exifPrefix, EXIF_PREFIX)) return readBlob(blob, start + EXIF_PREFIX.length, end)
    }
    offset = end
  }
  return null
}

async function extractPngExif(blob: Blob): Promise<Uint8Array | null> {
  if (!startsWith(await readBlob(blob, 0, PNG_SIGNATURE.length), PNG_SIGNATURE)) return null
  let offset = PNG_SIGNATURE.length
  while (offset + 12 <= blob.size) {
    const header = await readBlob(blob, offset, offset + 8)
    if (header.length < 8) return null
    const length = new DataView(header.buffer, header.byteOffset, 4).getUint32(0, false)
    const type = String.fromCharCode(...header.subarray(4, 8))
    const dataStart = offset + 8
    const end = dataStart + length
    if (end + 4 > blob.size) return null
    if (type === 'eXIf') return readBlob(blob, dataStart, end)
    if (type === 'IDAT' || type === 'IEND') break
    offset = end + 4
  }
  return null
}

async function extractWebpExif(blob: Blob): Promise<Uint8Array | null> {
  const header = await readBlob(blob, 0, 12)
  if (header.length < 12 || String.fromCharCode(...header.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...header.subarray(8, 12)) !== 'WEBP') return null
  let offset = 12
  while (offset + 8 <= blob.size) {
    const chunkHeader = await readBlob(blob, offset, offset + 8)
    if (chunkHeader.length < 8) return null
    const type = String.fromCharCode(...chunkHeader.subarray(0, 4))
    const length = new DataView(chunkHeader.buffer, chunkHeader.byteOffset + 4, 4).getUint32(0, true)
    const start = offset + 8
    const end = start + length
    if (end > blob.size) return null
    if (type === 'EXIF') {
      const payload = await readBlob(blob, start, end)
      return startsWith(payload, EXIF_PREFIX) ? payload.slice(EXIF_PREFIX.length) : payload
    }
    offset = end + (length & 1)
  }
  return null
}

export async function extractExif(blob: Blob): Promise<Uint8Array | null> {
  return await extractJpegExif(blob) ?? await extractPngExif(blob) ?? await extractWebpExif(blob)
}

function patchExifDimensions(exif: Uint8Array, width: number, height: number): Uint8Array {
  const patched = exif.slice()
  if (patched.length < 8) return patched
  const littleEndian = patched[0] === 0x49 && patched[1] === 0x49
  if (!littleEndian && !(patched[0] === 0x4d && patched[1] === 0x4d)) return patched
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength)
  const u16 = (offset: number) => offset + 2 <= patched.length ? view.getUint16(offset, littleEndian) : -1
  const u32 = (offset: number) => offset + 4 <= patched.length ? view.getUint32(offset, littleEndian) : -1
  if (u16(2) !== 42) return patched

  const writeTag = (ifdOffset: number, wantedTag: number, value: number): void => {
    const count = u16(ifdOffset)
    if (count < 0 || ifdOffset + 2 + count * 12 > patched.length) return
    for (let index = 0; index < count; index++) {
      const entry = ifdOffset + 2 + index * 12
      if (u16(entry) !== wantedTag) continue
      const type = u16(entry + 2)
      const valueCount = u32(entry + 4)
      if (valueCount < 1 || (type !== 3 && type !== 4) || (type === 3 && value > 0xffff)) return
      const inline = valueCount * (type === 3 ? 2 : 4) <= 4
      const valueOffset = inline ? entry + 8 : entry + 8 + u32(entry + 8)
      if (valueOffset < 0 || valueOffset + (type === 3 ? 2 : 4) > patched.length) return
      if (type === 3) view.setUint16(valueOffset, value, littleEndian)
      else view.setUint32(valueOffset, value, littleEndian)
      return
    }
  }

  const firstIfd = u32(4)
  if (firstIfd < 0 || firstIfd + 2 > patched.length) return patched
  writeTag(firstIfd, 0x0112, 1)
  writeTag(firstIfd, 0x0100, width)
  writeTag(firstIfd, 0x0101, height)
  const count = u16(firstIfd)
  let exifIfd = -1
  if (firstIfd + 2 + count * 12 <= patched.length) {
    for (let index = 0; index < count; index++) {
      const entry = firstIfd + 2 + index * 12
      if (u16(entry) === 0x8769) exifIfd = u32(entry + 8)
    }
  }
  if (exifIfd >= 0 && exifIfd + 2 <= patched.length) {
    writeTag(exifIfd, 0xa002, width)
    writeTag(exifIfd, 0xa003, height)
  }
  return patched
}

let crcTable: Uint32Array | null = null

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let value = 0; value < 256; value++) {
      let crc = value
      for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
      crcTable[value] = crc >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function exifChunk(exif: Uint8Array, width: number, height: number): Uint8Array {
  const payload = patchExifDimensions(exif, width, height)
  const type = encoder.encode('eXIf')
  const crcInput = new Uint8Array(type.length + payload.length)
  crcInput.set(type)
  crcInput.set(payload, type.length)
  const chunk = new Uint8Array(12 + payload.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, payload.length, false)
  chunk.set(type, 4)
  chunk.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(crcInput), false)
  return chunk
}

export async function addExifToPng(png: Blob, exif: Uint8Array | null, width: number, height: number): Promise<Blob> {
  if (!exif?.length) return png
  const bytes = new Uint8Array(await png.arrayBuffer())
  if (!startsWith(bytes, PNG_SIGNATURE)) return png
  let offset = PNG_SIGNATURE.length
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
    const end = offset + 12 + length
    if (end > bytes.length) return png
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'eXIf') return png
    if (type === 'IDAT') {
      const chunk = exifChunk(exif, width, height)
      const output = new Uint8Array(bytes.length + chunk.length)
      output.set(bytes.subarray(0, offset))
      output.set(chunk, offset)
      output.set(bytes.subarray(offset), offset + chunk.length)
      return new Blob([output.buffer], { type: 'image/png' })
    }
    offset = end
  }
  return png
}
