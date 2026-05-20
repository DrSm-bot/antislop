import exifr from 'exifr'

export type CheckState = 'clear' | 'warning' | 'found'

type ExifrOptions = NonNullable<Parameters<typeof exifr.parse>[1]>

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
  metadata: MetadataReport
}

export type MetadataSource = 'exif' | 'xmp' | 'iptc' | 'raw'

export type MetadataCategory =
  | 'software'
  | 'creator'
  | 'copyright'
  | 'timestamp'
  | 'generator'
  | 'prompt'
  | 'editTrace'

export type MetadataFinding = {
  source: MetadataSource
  category: MetadataCategory
  field: string
  value: string
  matchedGeneratorTerm?: string
}

export type MetadataReport = {
  state: CheckState
  presence: 'missing' | 'present'
  detail: string
  findings: MetadataFinding[]
  parser: {
    name: 'exifr'
    parsed: boolean
    error?: string
  }
}

export type CertificatePreview =
  | {
      type: 'browser-object-url'
      uri: string
      note: string
    }
  | {
      type: 'none'
      note: string
    }

export type CertificateCheck = {
  id: string
  label: string
  state: CheckState
  detail: string
}

export type AntiSlopCertificateV1 = {
  schema: 'antislop.certificate'
  schemaVersion: 1
  tool: {
    name: 'AntiSlop'
    version: string
  }
  result: {
    status: ReturnType<typeof reportStatus>
    wording: string
  }
  file: {
    name: string
    type: string
    sizeBytes: number
    dimensions: string
    sha256: string
  }
  preview: CertificatePreview
  checkedAt: string
  checks: CertificateCheck[]
  metadata?: MetadataReport
  limitations: string[]
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

const METADATA_FIELD_RULES: Array<{
  category: MetadataCategory
  names: string[]
}> = [
  { category: 'software', names: ['software', 'creatortool', 'originatingprogram', 'programversion'] },
  { category: 'creator', names: ['artist', 'creator', 'byline', 'writer', 'credit', 'source'] },
  { category: 'copyright', names: ['copyright', 'copyrightnotice', 'rights', 'usageterms'] },
  {
    category: 'timestamp',
    names: [
      'datetime',
      'datetimeoriginal',
      'createdate',
      'modifydate',
      'datecreated',
      'digitalcreationdate',
      'timecreated',
      'digitalcreationtime',
      'metadatadate',
    ],
  },
  {
    category: 'generator',
    names: ['generator', 'ai', 'model', 'engine', 'creatortool', 'software', 'originatingprogram'],
  },
  {
    category: 'prompt',
    names: ['prompt', 'negativeprompt', 'parameters', 'workflow', 'usercomment', 'description'],
  },
  {
    category: 'editTrace',
    names: ['history', 'documenthistory', 'actionadvised', 'editstatus', 'derivedfrom', 'ingredients'],
  },
]

export const TOOL_VERSION = '0.1.0'

export const CERTIFICATE_SCHEMA = 'antislop.certificate'

export const CERTIFICATE_SCHEMA_VERSION = 1

export const CERTIFICATE_LIMITATIONS = [
  'This report records local technical checks only and does not prove human authorship.',
  'C2PA markers are detected as readable marker bytes; cryptographic signature validation is not included in this MVP.',
  'Invisible watermark systems such as SynthID are not locally verifiable in this browser-only scan.',
  'Metadata can be stripped, edited, or absent after export, compression, screenshots, or social-media processing.',
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

function normalizeFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function sourceFromPath(path: string[]): MetadataSource {
  const root = normalizeFieldName(path[0] ?? '')

  if (root.includes('iptc')) return 'iptc'
  if (root.includes('xmp') || root === 'dc' || root === 'photoshop') return 'xmp'
  if (root === 'raw') return 'raw'
  return 'exif'
}

function stringifyMetadataValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return undefined
  if (Array.isArray(value)) {
    const values = value.map(stringifyMetadataValue).filter((entry): entry is string => Boolean(entry))
    return values.length ? values.join(', ') : undefined
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.value === 'string') return record.value
    const values = Object.values(record)
      .map(stringifyMetadataValue)
      .filter((entry): entry is string => Boolean(entry))
    return values.length ? values.join(', ') : undefined
  }

  const text = String(value).trim()
  return text || undefined
}

function categoriesForField(path: string[], value: string): MetadataCategory[] {
  const normalizedPath = path.map(normalizeFieldName).join('.')
  const normalizedValue = value.toLowerCase()
  const categories = new Set<MetadataCategory>()

  for (const rule of METADATA_FIELD_RULES) {
    if (rule.names.some((name) => normalizedPath.includes(normalizeFieldName(name)))) {
      categories.add(rule.category)
    }
  }

  if (KNOWN_GENERATOR_TERMS.some((term) => normalizedValue.includes(term))) {
    categories.add('generator')
  }

  return [...categories]
}

function collectMetadataFindings(value: unknown, path: string[] = []): MetadataFinding[] {
  if (value === undefined || value === null) return []
  if (value instanceof Uint8Array) return []

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectMetadataFindings(entry, [...path, String(index)]))
  }

  if (value instanceof Date || typeof value !== 'object') {
    const text = stringifyMetadataValue(value)
    if (!text) return []

    return categoriesForField(path, text).map((category) => ({
      source: sourceFromPath(path),
      category,
      field: path.join('.') || 'metadata',
      value: text,
      matchedGeneratorTerm: KNOWN_GENERATOR_TERMS.find((term) => text.toLowerCase().includes(term)),
    }))
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
    collectMetadataFindings(entry, [...path, key]),
  )
}

function hasStructuredMetadata(parsed: unknown) {
  return Boolean(parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0)
}

function hasReadableMetadataMarkers(sample: string) {
  return (
    sample.includes('exif') ||
    sample.includes('xmp') ||
    sample.includes('iptc') ||
    sample.includes('photoshop') ||
    sample.includes('software')
  )
}

export async function parseMetadata(bytes: ArrayBuffer, sample = decodeTextSample(bytes)) {
  let parsed: unknown
  let parserError: string | undefined

  try {
    const options = {
      tiff: true,
      ifd0: {},
      exif: true,
      xmp: { parse: true, multiSegment: true },
      iptc: true,
      userComment: true,
      mergeOutput: false,
      silentErrors: true,
    } as ExifrOptions
    parsed = await exifr.parse(bytes, options)
  } catch (error) {
    parserError = error instanceof Error ? error.message : String(error)
  }

  const findings = collectMetadataFindings(parsed)
  const present = hasStructuredMetadata(parsed) || hasReadableMetadataMarkers(sample)
  const generatorTerm = findings.find((finding) => finding.matchedGeneratorTerm)?.matchedGeneratorTerm

  if (generatorTerm) {
    return {
      state: 'found',
      presence: 'present',
      detail: `Structured metadata contains a known generator marker matching "${generatorTerm}".`,
      findings,
      parser: { name: 'exifr', parsed: hasStructuredMetadata(parsed), error: parserError },
    } satisfies MetadataReport
  }

  if (present) {
    return {
      state: 'clear',
      presence: 'present',
      detail: findings.length
        ? 'Metadata is present, but no known generator marker was found in provenance-focused fields.'
        : 'Metadata markers are present, but no provenance-focused EXIF/XMP/IPTC fields were recognized.',
      findings,
      parser: { name: 'exifr', parsed: hasStructuredMetadata(parsed), error: parserError },
    } satisfies MetadataReport
  }

  return {
    state: 'warning',
    presence: 'missing',
    detail: 'No EXIF, XMP, or IPTC metadata was found by the local parser or readable marker scan.',
    findings,
    parser: { name: 'exifr', parsed: false, error: parserError },
  } satisfies MetadataReport
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
  const hasMetadata = hasReadableMetadataMarkers(sample)

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
    detectSynthIdSupport(),
    detectStructure(fileType, sample),
  ]
}

export async function analyzeBytes(input: AnalysisInput): Promise<AssetReport> {
  const sample = decodeTextSample(input.bytes)
  const metadata = await parseMetadata(input.bytes, sample)

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
    metadata,
  }
}

export function reportStatus(report: AssetReport) {
  if (report.metadata.state === 'found') return 'Known marker found'
  if (report.checks.some((check) => check.state === 'found')) return 'Known marker found'
  if (report.checks.some((check) => check.state === 'warning')) return 'No known marker detected'
  if (report.metadata.state === 'warning') return 'No known marker detected'
  return 'Clean local scan'
}

export function resultWording(report: AssetReport) {
  const status = reportStatus(report)

  if (status === 'Known marker found') {
    return 'Known AI-generation or provenance marker text was found in the local scan.'
  }

  if (status === 'No known marker detected') {
    return 'No known AI-generation marker was detected, but one or more checks remain limited or inconclusive.'
  }

  return 'No known AI-generation marker was detected by the current local checks.'
}

export function certificatePreview(report: AssetReport): CertificatePreview {
  if (!report.previewUrl) {
    return {
      type: 'none',
      note: 'No preview reference was available when this certificate was created.',
    }
  }

  return {
    type: 'browser-object-url',
    uri: report.previewUrl,
    note:
      'Browser-local preview reference. Blob URLs are session-scoped and are not expected to resolve after export.',
  }
}

export function buildCertificate(report: AssetReport): AntiSlopCertificateV1 {
  const status = reportStatus(report)

  return {
    schema: CERTIFICATE_SCHEMA,
    schemaVersion: CERTIFICATE_SCHEMA_VERSION,
    tool: {
      name: 'AntiSlop',
      version: TOOL_VERSION,
    },
    result: {
      status,
      wording: resultWording(report),
    },
    file: {
      name: report.fileName,
      type: report.fileType,
      sizeBytes: report.fileSize,
      dimensions: report.dimensions,
      sha256: report.hash,
    },
    preview: certificatePreview(report),
    checkedAt: report.checkedAt,
    checks: report.checks.map((check) => ({
      id: check.id,
      label: check.label,
      state: check.state,
      detail: check.detail,
    })),
    metadata: report.metadata,
    limitations: [...CERTIFICATE_LIMITATIONS],
  }
}

export function stringifyCertificate(certificate: AntiSlopCertificateV1) {
  return `${JSON.stringify(certificate, null, 2)}\n`
}

export function certificateFileName(report: AssetReport) {
  const safeName = report.fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${safeName || 'asset'}.antislop-certificate-v1.json`
}
