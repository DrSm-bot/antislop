import exifr from 'exifr'
import {
  c2paCheckDetail,
  c2paStateToCheckState,
  sniffC2paBytes,
  type C2paVerificationResult,
} from './c2pa.ts'

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
  c2pa: C2paVerificationResult
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
    status: ReportStatus
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
  c2pa?: C2paVerificationResult
  metadata?: MetadataReport
  limitations: string[]
}

export type ReportStatus = 'AI markers found' | 'No AI markers found' | 'Could not complete check'

export type ReportStatusCounts = Record<ReportStatus, number>

export type ReportPackageEntry = {
  path: string
  contents: string
}

export type ReportPackageManifestV1 = {
  schema: 'antislop.reportPackage'
  schemaVersion: 1
  generatedAt: string
  totalReports: number
  statusCounts: ReportStatusCounts
  reports: Array<{
    fileName: string
    reportPath: string
    status: ReportStatus
    sha256: string
    checkedAt: string
  }>
}

export type AnalysisInput = {
  bytes: ArrayBuffer
  fileName: string
  fileType: string
  fileSize: number
  dimensions: string
  previewUrl: string
  c2pa?: C2paVerificationResult
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
  'made with google ai',
  'trainedalgorithmicmedia',
  'trained algorithmic media',
  '--v 7',
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
  'C2PA validation uses @contentauth/c2pa-web in supported browser runtimes; unsupported formats and verifier failures are reported explicitly.',
  'When the C2PA WASM verifier cannot run, AntiSlop falls back to marker-byte sniffing only and does not cryptographically validate signatures.',
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

function rawMetadataFindings(sample: string): MetadataFinding[] {
  const findings: MetadataFinding[] = []

  for (const term of KNOWN_GENERATOR_TERMS) {
    const index = sample.indexOf(term)

    if (index === -1) continue

    const start = Math.max(0, index - 48)
    const end = Math.min(sample.length, index + term.length + 72)
    findings.push({
      source: 'raw',
      category: 'generator',
      field: 'readable-bytes',
      value: sample.slice(start, end).trim(),
      matchedGeneratorTerm: term,
    })
  }

  return findings
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

  const findings = [...collectMetadataFindings(parsed), ...rawMetadataFindings(sample)]
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

export function detectC2pa(result: C2paVerificationResult): MarkerCheck {
  return {
    id: 'c2pa',
    label: 'C2PA / Content Credentials',
    state: c2paStateToCheckState(result),
    detail: c2paCheckDetail(result),
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

export function buildChecks(fileType: string, sample: string, c2pa = sniffC2paBytes(sample, fileType)) {
  return [
    detectC2pa(c2pa),
    detectSynthIdSupport(),
    detectStructure(fileType, sample),
  ]
}

export async function analyzeBytes(input: AnalysisInput): Promise<AssetReport> {
  const sample = decodeTextSample(input.bytes)
  const c2pa = input.c2pa ?? sniffC2paBytes(sample, input.fileType)
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
    checks: buildChecks(input.fileType, sample, c2pa),
    c2pa,
    metadata,
  }
}

export function reportStatus(report: AssetReport): ReportStatus {
  if (report.metadata.state === 'found') return 'AI markers found'
  if (report.checks.some((check) => check.state === 'found')) return 'AI markers found'
  if (report.checks.length === 0 && report.metadata.presence === 'missing') return 'Could not complete check'
  return 'No AI markers found'
}

export function markerEvidenceSummary(report: AssetReport) {
  const evidence = [
    ...report.metadata.findings
      .map((finding) => finding.matchedGeneratorTerm)
      .filter((term): term is string => Boolean(term)),
    ...report.checks.filter((check) => check.state === 'found').map((check) => check.label),
  ]

  return [...new Set(evidence)]
}

export function resultWording(report: AssetReport) {
  const status = reportStatus(report)

  if (status === 'AI markers found') {
    const evidence = markerEvidenceSummary(report)
    return evidence.length
      ? `Evidence of generative AI use was found in the local scan. Signals: ${evidence.join(', ')}.`
      : 'Evidence of generative AI use was found in the local scan.'
  }

  if (status === 'No AI markers found') {
    return 'AntiSlop checked metadata, C2PA and Content Credentials markers, known provider strings, and supported local signals. No supported generative AI markers were found.'
  }

  return 'AntiSlop could not complete enough local checks for a marker result.'
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
    c2pa: report.c2pa,
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

  return `${safeName || 'asset'}.antislop-report-v1.json`
}

export function htmlReportFileName(report: AssetReport) {
  const safeName = report.fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${safeName || 'asset'}.antislop-report.html`
}

export function projectHtmlReportFileName(date = new Date()) {
  return `antislop-full-report-${date.toISOString().slice(0, 10)}.html`
}

function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stateLabel(state: CheckState) {
  if (state === 'found') return 'Evidence found'
  if (state === 'warning') return 'Check note'
  return 'No marker found'
}

function shortenMiddle(value: string, head = 18, tail = 10) {
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

function expandableValue(value: string, label: string, className = 'expandable') {
  const shortValue = shortenMiddle(value)

  if (shortValue === value) return `<span class="${escapeHtml(className)}">${escapeHtml(value)}</span>`

  return `<details class="${escapeHtml(className)}"><summary aria-label="Show full ${escapeHtml(
    label,
  )}">${escapeHtml(shortValue)}</summary><span>${escapeHtml(value)}</span></details>`
}

export function buildHtmlReport(report: AssetReport, previewDataUrl?: string) {
  const status = reportStatus(report)
  const tone = status === 'AI markers found' ? 'found' : status === 'Could not complete check' ? 'warning' : 'clear'
  const checks = [
    ...report.checks,
    {
      id: 'metadata',
      label: 'EXIF / XMP / IPTC metadata',
      state: report.metadata.state,
      detail: report.metadata.detail,
    } satisfies MarkerCheck,
  ]
  const findingRows = report.metadata.findings
    .map(
      (finding) => `<tr><td>${escapeHtml(finding.source.toUpperCase())}</td><td>${escapeHtml(
        finding.category,
      )}</td><td>${escapeHtml(finding.field)}</td><td>${escapeHtml(finding.value)}</td></tr>`,
    )
    .join('')
  const checkRows = checks
    .map(
      (check) => `<tr><td><span class="pill ${escapeHtml(check.state)}">${escapeHtml(
        stateLabel(check.state),
      )}</span></td><td>${escapeHtml(check.label)}</td><td>${escapeHtml(check.detail)}</td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AntiSlop HTML Report - ${escapeHtml(report.fileName)}</title>
  <style>
    :root { color: #17201a; background: #f5f7f2; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
    header { display: grid; grid-template-columns: minmax(180px, 280px) 1fr; gap: 24px; align-items: center; margin-bottom: 24px; }
    img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border: 1px solid #ccd7cd; border-radius: 8px; background: #dce5dd; }
    h1, h2, p { margin-top: 0; }
    h1 { margin-bottom: 8px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 28px 0 10px; font-size: 18px; }
    p { color: #445247; line-height: 1.55; }
    .eyebrow { margin-bottom: 8px; color: #5c6b60; font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .badge { display: inline-flex; width: fit-content; align-items: center; min-height: 32px; margin-bottom: 12px; padding: 0 12px; border: 1px solid #9aa89b; border-radius: 999px; font-size: 14px; font-weight: 900; }
    .badge.clear, .pill.clear { border-color: #7aa673; color: #18521f; background: #e7f4e4; }
    .badge.found, .pill.found { border-color: #b87070; color: #6b1d1d; background: #fae8e8; }
    .badge.warning, .pill.warning { border-color: #b49b63; color: #5d4310; background: #f8efda; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 20px 0; }
    .fact { padding: 12px; border: 1px solid #d9e2da; border-radius: 8px; background: #fff; }
    .fact span { display: block; color: #5c6b60; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .fact strong { display: block; margin-top: 4px; overflow-wrap: anywhere; }
    details.expandable summary { cursor: pointer; color: #17201a; font-weight: 900; overflow-wrap: anywhere; }
    details.expandable span { display: block; margin-top: 6px; color: #445247; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 22px; background: #fff; }
    th, td { padding: 10px; border: 1px solid #d9e2da; text-align: left; vertical-align: top; }
    th { color: #46534b; font-size: 12px; text-transform: uppercase; }
    .pill { display: inline-flex; padding: 4px 8px; border: 1px solid #9aa89b; border-radius: 999px; font-size: 12px; font-weight: 900; white-space: nowrap; }
    footer { margin-top: 28px; color: #5c6b60; font-size: 12px; line-height: 1.5; }
    @media print {
      :root { background: #fff; }
      main { max-width: none; padding: 0; }
      header { grid-template-columns: 180px 1fr; break-inside: avoid; }
      body { color: #000; }
      .fact, table { break-inside: avoid; }
      a { color: inherit; text-decoration: none; }
    }
    @media (max-width: 680px) {
      header, .facts { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      ${previewDataUrl ? `<img src="${escapeHtml(previewDataUrl)}" alt="Preview of ${escapeHtml(report.fileName)}">` : '<div></div>'}
      <div>
        <p class="eyebrow">AntiSlop HTML Report</p>
        <span class="badge ${escapeHtml(tone)}">${escapeHtml(status === 'No AI markers found' ? 'No AI markers found' : status)}</span>
        <h1>${escapeHtml(status === 'AI markers found' ? 'Evidence of AI generation found' : status)}</h1>
        <p>${escapeHtml(resultWording(report))}</p>
      </div>
    </header>
    <section class="facts" aria-label="File facts">
      <div class="fact"><span>File</span><strong>${expandableValue(report.fileName, 'file name')}</strong></div>
      <div class="fact"><span>Checked</span><strong>${escapeHtml(report.checkedAt)}</strong></div>
      <div class="fact"><span>Dimensions</span><strong>${escapeHtml(report.dimensions)}</strong></div>
      <div class="fact"><span>Size</span><strong>${escapeHtml(formatBytes(report.fileSize))}</strong></div>
      <div class="fact"><span>Format</span><strong>${escapeHtml(report.fileType)}</strong></div>
      <div class="fact"><span>SHA-256</span><strong>${expandableValue(report.hash, 'SHA-256 hash')}</strong></div>
    </section>
    <section>
      <h2>Checks Performed</h2>
      <table>
        <thead><tr><th>Result</th><th>Check</th><th>Detail</th></tr></thead>
        <tbody>${checkRows}</tbody>
      </table>
    </section>
    <section>
      <h2>Metadata Findings</h2>
      ${findingRows ? `<table><thead><tr><th>Source</th><th>Category</th><th>Field</th><th>Value</th></tr></thead><tbody>${findingRows}</tbody></table>` : '<p>No provenance-focused metadata findings were recorded.</p>'}
    </section>
    <footer>
      <strong>Limitations:</strong> ${CERTIFICATE_LIMITATIONS.map(escapeHtml).join(' ')}
    </footer>
  </main>
</body>
</html>`
}

export function buildProjectHtmlReport(
  reports: AssetReport[],
  previewDataUrls: Record<string, string> = {},
  generatedAt = new Date().toISOString(),
) {
  const counts = summarizeReportStatuses(reports)
  const assetRows = reports
    .map((report) => {
      const status = reportStatus(report)
      const tone = status === 'AI markers found' ? 'found' : status === 'Could not complete check' ? 'warning' : 'clear'
      const preview = previewDataUrls[report.id]
      const evidence = markerEvidenceSummary(report)
      const fileLabel = expandableValue(report.fileName, 'file name', 'compact-value')
      const hashLabel = expandableValue(report.hash, 'SHA-256 hash', 'compact-value hash')
      return `<tr>
        <td>${preview ? `<img src="${escapeHtml(preview)}" alt="Preview of ${escapeHtml(report.fileName)}">` : ''}</td>
        <td><strong>${fileLabel}</strong><span>${escapeHtml(report.dimensions)} · ${escapeHtml(formatBytes(report.fileSize))}</span></td>
        <td><span class="pill ${escapeHtml(tone)}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(evidence.length ? evidence.join(', ') : 'No supported generative AI marker recorded')}</td>
        <td>${hashLabel}</td>
      </tr>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AntiSlop Full HTML Report</title>
  <style>
    :root { color: #17201a; background: #f5f7f2; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; }
    main { max-width: 1120px; margin: 0 auto; padding: 34px 20px; }
    h1, h2, h3, p { margin-top: 0; letter-spacing: 0; }
    h1 { margin-bottom: 10px; font-size: 34px; }
    h2 { margin: 30px 0 10px; font-size: 22px; }
    h3 { margin-bottom: 8px; font-size: 16px; }
    p, li { color: #445247; line-height: 1.58; }
    .eyebrow { margin-bottom: 8px; color: #5c6b60; font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 24px 0; }
    .fact, .method { padding: 14px; border: 1px solid #d9e2da; border-radius: 8px; background: #fff; }
    .fact span { display: block; color: #5c6b60; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .fact strong { display: block; margin-top: 4px; font-size: 24px; }
    .methods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0 24px; background: #fff; }
    th, td { padding: 10px; border: 1px solid #d9e2da; text-align: left; vertical-align: top; }
    th { color: #46534b; font-size: 12px; text-transform: uppercase; }
    td img { width: 86px; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; background: #dce5dd; }
    td span { display: block; margin-top: 4px; color: #5c6b60; font-size: 12px; }
    .compact-value summary { cursor: pointer; color: #17201a; font-weight: 900; overflow-wrap: anywhere; }
    .compact-value > span { display: block; margin-top: 6px; color: #445247; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .hash summary { font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
    .pill { display: inline-flex; padding: 5px 9px; border: 1px solid #9aa89b; border-radius: 999px; font-size: 12px; font-weight: 900; white-space: nowrap; }
    .pill.clear { border-color: #7aa673; color: #18521f; background: #e7f4e4; }
    .pill.found { border-color: #b87070; color: #6b1d1d; background: #fae8e8; }
    .pill.warning { border-color: #b49b63; color: #5d4310; background: #f8efda; }
    footer { margin-top: 30px; color: #5c6b60; font-size: 12px; line-height: 1.5; }
    @media print {
      :root { background: #fff; }
      main { max-width: none; padding: 0; }
      .fact, .method, table { break-inside: avoid; }
      body { color: #000; }
    }
    @media (max-width: 780px) {
      .summary, .methods { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">AntiSlop Full HTML Report</p>
      <h1>Local asset marker report</h1>
      <p>This report summarizes the local AntiSlop checks performed for ${escapeHtml(reports.length)} image asset${reports.length === 1 ? '' : 's'} on ${escapeHtml(generatedAt)}. It records evidence found in the files; it does not claim to prove human authorship.</p>
    </header>
    <section class="summary" aria-label="Result summary">
      <div class="fact"><span>Total assets</span><strong>${escapeHtml(reports.length)}</strong></div>
      <div class="fact"><span>AI markers found</span><strong>${escapeHtml(counts['AI markers found'])}</strong></div>
      <div class="fact"><span>No AI markers found</span><strong>${escapeHtml(counts['No AI markers found'])}</strong></div>
      <div class="fact"><span>Could not check</span><strong>${escapeHtml(counts['Could not complete check'])}</strong></div>
    </section>
    <section>
      <h2>Methods Used</h2>
      <p>AntiSlop is designed as an offline, browser-based marker check for artists and small teams. Files are read locally in the browser so the checked artwork does not need to leave the user's device.</p>
      <div class="methods">
        <article class="method"><h3>Cryptographic provenance</h3><p>The app attempts C2PA / Content Credentials verification in supported browser runtimes. Valid, invalid, found, missing, and unsupported states are reported explicitly.</p></article>
        <article class="method"><h3>Metadata inspection</h3><p>EXIF, XMP, IPTC, and readable file metadata are scanned for known generator, workflow, prompt, software, and provider marker strings.</p></article>
        <article class="method"><h3>Raw marker search</h3><p>Readable byte ranges are checked for common provider markers that can survive in exported image files even when structured metadata parsing is incomplete.</p></article>
        <article class="method"><h3>Unsupported watermark systems</h3><p>Vendor-specific invisible watermark systems are listed as check notes when no offline browser verifier is available.</p></article>
      </div>
    </section>
    <section>
      <h2>Why Cloud Scanners Are Not Used</h2>
      <p>AntiSlop intentionally avoids cloud-based scanning services from large AI providers. Artists, game teams, and creators often need to inspect unpublished or client-owned work without sending those assets to third-party AI labs. A browser-local workflow keeps the privacy boundary simple: the file is checked on the user's device, and the report states exactly which local methods were available.</p>
      <p>This choice is a tradeoff. Cloud services may have access to private watermark detectors that cannot currently run in a browser, but using them would require uploading the artwork. AntiSlop prefers a transparent local result over a black-box remote verdict.</p>
    </section>
    <section>
      <h2>Asset Results</h2>
      <table>
        <thead><tr><th>Preview</th><th>Asset</th><th>Result</th><th>Evidence Summary</th><th>SHA-256</th></tr></thead>
        <tbody>${assetRows}</tbody>
      </table>
    </section>
    <footer>
      <strong>Limitations:</strong> ${CERTIFICATE_LIMITATIONS.map(escapeHtml).join(' ')}
    </footer>
  </main>
</body>
</html>`
}

export function summarizeReportStatuses(reports: AssetReport[]): ReportStatusCounts {
  return reports.reduce<ReportStatusCounts>(
    (counts, report) => {
      counts[reportStatus(report)] += 1
      return counts
    },
    {
      'AI markers found': 0,
      'No AI markers found': 0,
      'Could not complete check': 0,
    },
  )
}

export function buildReportPackageEntries(
  reports: AssetReport[],
  generatedAt = new Date().toISOString(),
): ReportPackageEntry[] {
  const usedPaths = new Set<string>()

  const certificateEntries = reports.map((report, index) => {
    const baseName = certificateFileName(report)
    const path = uniquePackagePath(baseName, usedPaths, index)
    usedPaths.add(path)

    return {
      report,
      entry: {
        path,
        contents: stringifyCertificate(buildCertificate(report)),
      },
    }
  })

  const manifest = buildReportPackageManifest(
    certificateEntries.map(({ report, entry }) => ({ report, path: entry.path })),
    generatedAt,
  )

  return [
    {
      path: 'antislop-summary.json',
      contents: `${JSON.stringify(manifest, null, 2)}\n`,
    },
    ...certificateEntries.map(({ entry }) => entry),
  ]
}

function buildReportPackageManifest(
  reports: Array<{ report: AssetReport; path: string }>,
  generatedAt: string,
): ReportPackageManifestV1 {
  return {
    schema: 'antislop.reportPackage',
    schemaVersion: 1,
    generatedAt,
    totalReports: reports.length,
    statusCounts: summarizeReportStatuses(reports.map(({ report }) => report)),
    reports: reports.map(({ report, path }) => ({
      fileName: report.fileName,
      reportPath: path,
      status: reportStatus(report),
      sha256: report.hash,
      checkedAt: report.checkedAt,
    })),
  }
}

function uniquePackagePath(baseName: string, usedPaths: Set<string>, index: number) {
  if (!usedPaths.has(baseName)) return baseName

  const suffix = `-${String(index + 1).padStart(3, '0')}`
  const jsonSuffix = '.json'

  if (baseName.endsWith(jsonSuffix)) {
    return `${baseName.slice(0, -jsonSuffix.length)}${suffix}${jsonSuffix}`
  }

  return `${baseName}${suffix}`
}
