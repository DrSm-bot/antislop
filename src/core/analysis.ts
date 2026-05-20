export type CheckState = 'clear' | 'warning' | 'found'

export type MarkerCheck = {
  id: string
  label: string
  state: CheckState
  detail: string
}

export type AssetReport = {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  dimensions: string
  hash: string
  checkedAt: string
  previewUrl: string
  checks: MarkerCheck[]
}

export type AnalysisInput = {
  bytes: ArrayBuffer
  fileName: string
  fileType: string
  fileSize: number
  dimensions: string
  previewUrl: string
  checkedAt?: string
  id?: string
}

export const KNOWN_GENERATOR_TERMS = [
  'ai generated',
  'ai-generated',
  'chatgpt',
  'dall-e',
  'dalle',
  'gpt-image',
  'midjourney',
  'stable diffusion',
  'stability ai',
  'adobe firefly',
  'firefly',
  'imagen',
  'gemini',
  'leonardo',
  'comfyui',
  'automatic1111',
] as const

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256Hex(bytes: ArrayBuffer) {
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}

export function decodeTextSample(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes.slice(0, Math.min(bytes.byteLength, 2_000_000)))
  let sample = ''

  for (const byte of view) {
    sample += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' '
  }

  return sample.replace(/\s+/g, ' ').toLowerCase()
}

export function detectC2pa(sample: string): MarkerCheck {
  const found =
    sample.includes('c2pa') ||
    sample.includes('contentauthenticity') ||
    sample.includes('content credentials')

  return {
    id: 'c2pa',
    label: 'C2PA / Content Credentials',
    state: found ? 'warning' : 'clear',
    detail: found
      ? 'Possible C2PA manifest bytes found. Full signature validation is planned for the WASM verifier module.'
      : 'No C2PA marker bytes found in the local file scan.',
  }
}

export function detectGeneratorMetadata(sample: string): MarkerCheck {
  const term = KNOWN_GENERATOR_TERMS.find((entry) => sample.includes(entry))

  return {
    id: 'metadata',
    label: 'Generator metadata',
    state: term ? 'found' : 'clear',
    detail: term
      ? `Found metadata text matching "${term}". Review the technical metadata before sharing.`
      : 'No common AI generator names were found in readable metadata.',
  }
}

export function detectSynthIdSupport(): MarkerCheck {
  return {
    id: 'synthid',
    label: 'SynthID-style invisible watermarks',
    state: 'warning',
    detail:
      'Not locally verifiable yet. Vendor-specific detectors are not generally available for offline browser use.',
  }
}

export function detectStructure(fileType: string, sample: string): MarkerCheck {
  const hasMetadata =
    sample.includes('exif') ||
    sample.includes('xmp') ||
    sample.includes('iptc') ||
    sample.includes('photoshop') ||
    sample.includes('software')

  return {
    id: 'structure',
    label: 'File structure and metadata presence',
    state: hasMetadata ? 'clear' : 'warning',
    detail: hasMetadata
      ? `${fileType || 'Unknown format'} contains readable metadata or structured marker segments.`
      : 'No readable metadata markers found. This is common after export, compression, or screenshot workflows.',
  }
}

export function buildChecks(fileType: string, sample: string) {
  return [
    detectC2pa(sample),
    detectGeneratorMetadata(sample),
    detectSynthIdSupport(),
    detectStructure(fileType, sample),
  ]
}

export async function analyzeBytes(input: AnalysisInput): Promise<AssetReport> {
  const sample = decodeTextSample(input.bytes)

  return {
    id: input.id ?? crypto.randomUUID(),
    fileName: input.fileName,
    fileType: input.fileType || 'unknown',
    fileSize: input.fileSize,
    dimensions: input.dimensions,
    hash: await sha256Hex(input.bytes),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    previewUrl: input.previewUrl,
    checks: buildChecks(input.fileType, sample),
  }
}

export function reportStatus(report: AssetReport) {
  if (report.checks.some((check) => check.state === 'found')) return 'Known marker found'
  if (report.checks.some((check) => check.state === 'warning')) return 'No known marker detected'
  return 'Clean local scan'
}

export function buildCertificate(report: AssetReport) {
  return {
    tool: 'AntiSlop',
    version: '0.1.0',
    statement:
      'Known AI-generation provenance markers were checked locally. This report does not prove human authorship.',
    file: {
      name: report.fileName,
      sha256: report.hash,
      size: report.fileSize,
      type: report.fileType,
      dimensions: report.dimensions,
    },
    checkedAt: report.checkedAt,
    checks: report.checks,
  }
}
