import { useMemo, useState } from 'react'
import './App.css'

type CheckState = 'clear' | 'warning' | 'found'

type MarkerCheck = {
  id: string
  label: string
  state: CheckState
  detail: string
}

type AssetReport = {
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

const KNOWN_GENERATOR_TERMS = [
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
]

const formatter = new Intl.NumberFormat('en')

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function decodeTextSample(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes.slice(0, Math.min(bytes.byteLength, 2_000_000)))
  let sample = ''

  for (const byte of view) {
    sample += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' '
  }

  return sample.replace(/\s+/g, ' ').toLowerCase()
}

function detectC2pa(sample: string): MarkerCheck {
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

function detectGeneratorMetadata(sample: string): MarkerCheck {
  const term = KNOWN_GENERATOR_TERMS.find((entry) => sample.includes(entry))

  return {
    id: 'metadata',
    label: 'Generator metadata',
    state: term ? 'found' : 'clear',
    detail: term
      ? `Found metadata text matching “${term}”. Review the technical metadata before sharing.`
      : 'No common AI generator names were found in readable metadata.',
  }
}

function detectSynthIdSupport(): MarkerCheck {
  return {
    id: 'synthid',
    label: 'SynthID-style invisible watermarks',
    state: 'warning',
    detail:
      'Not locally verifiable yet. Vendor-specific detectors are not generally available for offline browser use.',
  }
}

function detectStructure(file: File, sample: string): MarkerCheck {
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
      ? `${file.type || 'Unknown format'} contains readable metadata or structured marker segments.`
      : 'No readable metadata markers found. This is common after export, compression, or screenshot workflows.',
  }
}

async function imageDimensions(file: File) {
  const url = URL.createObjectURL(file)

  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return `${formatter.format(image.naturalWidth)} x ${formatter.format(image.naturalHeight)}`
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function analyzeFile(file: File): Promise<AssetReport> {
  const bytes = await file.arrayBuffer()
  const hash = toHex(await crypto.subtle.digest('SHA-256', bytes))
  const sample = decodeTextSample(bytes)
  const previewUrl = URL.createObjectURL(file)

  return {
    id: crypto.randomUUID(),
    fileName: file.name,
    fileType: file.type || 'unknown',
    fileSize: file.size,
    dimensions: file.type.startsWith('image/') ? await imageDimensions(file) : 'not an image',
    hash,
    checkedAt: new Date().toISOString(),
    previewUrl,
    checks: [
      detectC2pa(sample),
      detectGeneratorMetadata(sample),
      detectSynthIdSupport(),
      detectStructure(file, sample),
    ],
  }
}

function reportStatus(report: AssetReport) {
  if (report.checks.some((check) => check.state === 'found')) return 'Known marker found'
  if (report.checks.some((check) => check.state === 'warning')) return 'No known marker detected'
  return 'Clean local scan'
}

function App() {
  const [reports, setReports] = useState<AssetReport[]>([])
  const [isScanning, setIsScanning] = useState(false)

  const activeReport = reports[0]
  const certificate = useMemo(() => {
    if (!activeReport) return ''

    return JSON.stringify(
      {
        tool: 'AntiSlop',
        version: '0.1.0',
        statement:
          'Known AI-generation provenance markers were checked locally. This report does not prove human authorship.',
        file: {
          name: activeReport.fileName,
          sha256: activeReport.hash,
          size: activeReport.fileSize,
          type: activeReport.fileType,
          dimensions: activeReport.dimensions,
        },
        checkedAt: activeReport.checkedAt,
        checks: activeReport.checks,
      },
      null,
      2,
    )
  }, [activeReport])

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setIsScanning(true)

    try {
      const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
      const nextReports = await Promise.all(imageFiles.map(analyzeFile))
      setReports((current) => [...nextReports, ...current])
    } finally {
      setIsScanning(false)
    }
  }

  function downloadCertificate(report: AssetReport) {
    const blob = new Blob([certificate], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${report.fileName}.antislop-report.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Private, browser-only asset marker check</p>
          <h1>AntiSlop</h1>
          <p className="lede">
            Scan game art for known AI provenance markers, keep the file on your
            machine, and export a careful report for review.
          </p>
        </div>

        <label className="drop-zone">
          <input
            multiple
            accept="image/*"
            type="file"
            onChange={(event) => void onFiles(event.target.files)}
          />
          <span className="drop-title">Drop images here</span>
          <span className="drop-detail">
            PNG, JPEG, WebP, and other browser-readable image files. Nothing is uploaded.
          </span>
        </label>
      </section>

      <section className="workspace">
        <aside className="queue-panel">
          <div className="panel-heading">
            <h2>Asset Queue</h2>
            <span>{isScanning ? 'Scanning...' : `${reports.length} checked`}</span>
          </div>

          {reports.length === 0 ? (
            <p className="empty-state">
              Add an image to create the first local provenance report.
            </p>
          ) : (
            reports.map((report) => (
              <article className="queue-item" key={report.id}>
                <img src={report.previewUrl} alt="" />
                <div>
                  <strong>{report.fileName}</strong>
                  <span>{reportStatus(report)}</span>
                </div>
              </article>
            ))
          )}
        </aside>

        <section className="report-panel">
          {activeReport ? (
            <>
              <div className="report-summary">
                <img src={activeReport.previewUrl} alt="Checked asset preview" />
                <div>
                  <p className="eyebrow">Certificate Preview</p>
                  <h2>{reportStatus(activeReport)}</h2>
                  <p>
                    Checked {activeReport.fileName} locally. No result here can prove
                    human authorship; it records which known markers were checked.
                  </p>
                  <button type="button" onClick={() => downloadCertificate(activeReport)}>
                    Export JSON Report
                  </button>
                </div>
              </div>

              <dl className="facts-grid">
                <div>
                  <dt>SHA-256</dt>
                  <dd>{activeReport.hash.slice(0, 24)}...</dd>
                </div>
                <div>
                  <dt>Dimensions</dt>
                  <dd>{activeReport.dimensions}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(activeReport.fileSize)}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{activeReport.fileType}</dd>
                </div>
              </dl>

              <div className="checks-list">
                {activeReport.checks.map((check) => (
                  <article className={`check-row ${check.state}`} key={check.id}>
                    <span>{check.state}</span>
                    <div>
                      <h3>{check.label}</h3>
                      <p>{check.detail}</p>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="blank-report">
              <h2>Evidence, not vibes.</h2>
              <p>
                AntiSlop checks for known provenance signals and produces a report
                that says exactly what was inspected.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
