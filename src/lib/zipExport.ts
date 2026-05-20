import {
  buildReportPackageEntries,
  type AssetReport,
  type ReportPackageEntry,
} from '../core/analysis.ts'

const textEncoder = new TextEncoder()

export function createReportZipBlob(reports: AssetReport[]) {
  return new Blob([createZipArchive(buildReportPackageEntries(reports))], {
    type: 'application/zip',
  })
}

export function reportZipFileName(date = new Date()) {
  return `antislop-reports-${date.toISOString().slice(0, 10)}.zip`
}

export function createZipArchive(entries: ReportPackageEntry[]) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const fileName = textEncoder.encode(entry.path)
    const contents = textEncoder.encode(entry.contents)
    const crc = crc32(contents)
    const localHeader = zipHeader([
      0x04034b50,
      20,
      0x0800,
      0,
      0,
      0,
      crc,
      contents.byteLength,
      contents.byteLength,
      fileName.byteLength,
      0,
    ])

    localParts.push(localHeader, fileName, contents)

    const centralHeader = zipHeader([
      0x02014b50,
      20,
      20,
      0x0800,
      0,
      0,
      0,
      crc,
      contents.byteLength,
      contents.byteLength,
      fileName.byteLength,
      0,
      0,
      0,
      0,
      0,
      offset,
    ])
    centralParts.push(centralHeader, fileName)
    offset += localHeader.byteLength + fileName.byteLength + contents.byteLength
  }

  const centralOffset = offset
  const centralSize = byteLength(centralParts)
  const endRecord = zipHeader([
    0x06054b50,
    0,
    0,
    entries.length,
    entries.length,
    centralSize,
    centralOffset,
    0,
  ])

  return concatBytes([...localParts, ...centralParts, endRecord])
}

function zipHeader(values: number[]) {
  const size = values.length === 11 ? 30 : values.length === 17 ? 46 : 22
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  let offset = 0

  const write16 = (value: number) => {
    view.setUint16(offset, value, true)
    offset += 2
  }
  const write32 = (value: number) => {
    view.setUint32(offset, value >>> 0, true)
    offset += 4
  }

  if (size === 30) {
    write32(values[0])
    values.slice(1).forEach(write16Or32([2, 2, 2, 2, 2, 4, 4, 4, 2, 2], write16, write32))
  } else if (size === 46) {
    write32(values[0])
    values.slice(1).forEach(
      write16Or32([2, 2, 2, 2, 2, 2, 4, 4, 4, 2, 2, 2, 2, 2, 4, 4], write16, write32),
    )
  } else {
    write32(values[0])
    values.slice(1).forEach(write16Or32([2, 2, 2, 2, 4, 4, 2], write16, write32))
  }

  return bytes
}

function write16Or32(
  sizes: number[],
  write16: (value: number) => void,
  write32: (value: number) => void,
) {
  return (value: number, index: number) => {
    if (sizes[index] === 2) write16(value)
    else write32(value)
  }
}

function concatBytes(parts: Uint8Array[]) {
  const bytes = new Uint8Array(byteLength(parts))
  let offset = 0

  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }

  return bytes
}

function byteLength(parts: Uint8Array[]) {
  return parts.reduce((total, part) => total + part.byteLength, 0)
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}
