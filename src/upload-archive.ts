// The upload archive is one binary file: the magic bytes, a little-endian
// uint32 header length, a UTF-8 JSON header, then the image blobs in header
// order. Nothing here needs a dependency, and the payloads stay byte-identical
// so an export/import round trip does not re-encode the images.
export type ArchiveEntry = {
  name: string
  width: number
  height: number
  type: string
  createdAt: number
  blob: Blob
}

type ArchiveHeaderImage = {
  name: string
  width: number
  height: number
  type: string
  createdAt: number
  size: number
}

type ArchiveHeader = {
  kind: string
  version: number
  exportedAt: string
  images: ArchiveHeaderImage[]
}

export const ARCHIVE_EXTENSION = '.g42images'

const MAGIC = 'G42IMG01'
const KIND = 'generative42-images'
const VERSION = 1
const MAGIC_BYTES = 8
const LENGTH_BYTES = 4
const PREFIX_BYTES = MAGIC_BYTES + LENGTH_BYTES
const MAX_HEADER_BYTES = 1 << 20

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

export function archiveFileName(date = new Date()): string {
  const day = `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}`
  const time = `${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}`
  return `generative42-images-${day}-${time}${ARCHIVE_EXTENSION}`
}

export function buildArchive(entries: ArchiveEntry[]): Blob {
  const header: ArchiveHeader = {
    kind: KIND,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    images: entries.map((entry) => ({
      name: entry.name,
      width: entry.width,
      height: entry.height,
      type: entry.type,
      createdAt: entry.createdAt,
      size: entry.blob.size,
    })),
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const prefix = new Uint8Array(PREFIX_BYTES)
  prefix.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(prefix.buffer).setUint32(MAGIC_BYTES, headerBytes.byteLength, true)
  return new Blob([prefix, headerBytes, ...entries.map((entry) => entry.blob)], { type: 'application/octet-stream' })
}

function archiveError(reason: string): Error {
  return new Error(`Not a usable image archive: ${reason}`)
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function headerImages(value: unknown): ArchiveHeaderImage[] {
  if (typeof value !== 'object' || value === null) throw archiveError('the header is not a generative42 image list')
  const header = value as Partial<ArchiveHeader>
  if (header.kind !== KIND) throw archiveError('the header kind is unknown')
  if (header.version !== VERSION) throw archiveError(`version ${String(header.version)} is not supported`)
  if (!Array.isArray(header.images)) throw archiveError('the header lists no images')
  return header.images.map((value, index) => {
    const image = value as Partial<ArchiveHeaderImage> | null
    if (typeof image !== 'object' || image === null) throw archiveError(`entry ${index + 1} is not an image record`)
    if (typeof image.name !== 'string' || image.name.trim() === '') throw archiveError(`entry ${index + 1} has no name`)
    if (!isWhole(image.width) || !isWhole(image.height)) throw archiveError(`entry ${index + 1} has no image size`)
    if (typeof image.type !== 'string') throw archiveError(`entry ${index + 1} has no image type`)
    if (typeof image.createdAt !== 'number' || !Number.isFinite(image.createdAt)) throw archiveError(`entry ${index + 1} has no timestamp`)
    if (!isWhole(image.size) || image.size === 0) throw archiveError(`entry ${index + 1} has no image data`)
    return {
      name: image.name,
      width: image.width,
      height: image.height,
      type: image.type,
      createdAt: image.createdAt,
      size: image.size,
    }
  })
}

export async function parseArchive(file: File | Blob): Promise<ArchiveEntry[]> {
  if (file.size < PREFIX_BYTES) throw archiveError('the file is too short')
  const prefix = new Uint8Array(await file.slice(0, PREFIX_BYTES).arrayBuffer())
  if (new TextDecoder().decode(prefix.subarray(0, MAGIC_BYTES)) !== MAGIC) throw archiveError('the magic bytes do not match')
  const headerLength = new DataView(prefix.buffer).getUint32(MAGIC_BYTES, true)
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) throw archiveError('the header length is invalid')
  if (PREFIX_BYTES + headerLength > file.size) throw archiveError('the header runs past the end of the file')
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(await file.slice(PREFIX_BYTES, PREFIX_BYTES + headerLength).arrayBuffer()))
  } catch {
    throw archiveError('the header is not valid JSON')
  }
  const images = headerImages(parsed)
  const total = images.reduce((sum, image) => sum + image.size, 0)
  if (PREFIX_BYTES + headerLength + total !== file.size) throw archiveError('the image data does not match the header')
  const entries: ArchiveEntry[] = []
  let offset = PREFIX_BYTES + headerLength
  for (const image of images) {
    const sliced = file.slice(offset, offset + image.size, image.type)
    entries.push({
      name: image.name,
      width: image.width,
      height: image.height,
      type: image.type,
      createdAt: image.createdAt,
      // A slice keeps the requested type only when it is a valid MIME type.
      blob: sliced.type === image.type ? sliced : new Blob([sliced], { type: image.type }),
    })
    offset += image.size
  }
  return entries
}
