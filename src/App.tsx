import { useMemo, useState, type DragEvent } from 'react'
import { analyzeImageFile } from './lib/browserAnalysis'
import { createReportZipBlob, reportZipFileName } from './lib/zipExport'
import {
  buildCertificate,
  buildHtmlReport,
  buildProjectHtmlReport,
  certificateFileName,
  formatBytes,
  htmlReportFileName,
  projectHtmlReportFileName,
  reportStatus,
  resultWording,
  summarizeReportStatuses,
  stringifyCertificate,
  type AssetReport,
  type ReportStatus,
} from './core/analysis'
import './App.css'

type ScanNotice =
  | {
      tone: 'info' | 'success' | 'warning' | 'error'
      title: string
      detail: string
    }
  | null

type QueueProgress = {
  total: number
  completed: number
  failed: number
  skipped: number
  currentFile?: string
}

const QUEUE_YIELD_EVERY = 2

function statusTone(status: ReportStatus | null) {
  if (status === 'AI markers found') return 'found'
  if (status === 'Could not complete check') return 'warning'
  return 'clear'
}

function statusBadgeLabel(status: ReportStatus | null) {
  if (status === 'No AI markers found') return '✓ No AI markers found'
  if (status === 'AI markers found') return 'AI markers found'
  return 'Could not complete check'
}

function pauseForPaint() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

async function previewUrlToDataUrl(previewUrl: string) {
  const response = await fetch(previewUrl)
  const blob = await response.blob()

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(blob)
  })
}

function App() {
  const [reports, setReports] = useState<AssetReport[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [scanNotice, setScanNotice] = useState<ScanNotice>(null)
  const [queueProgress, setQueueProgress] = useState<QueueProgress>({
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  })

  const activeReport = reports.find((report) => report.id === selectedReportId) ?? reports[0]
  const activeStatus = activeReport ? reportStatus(activeReport) : null
  const statusCounts = useMemo(() => summarizeReportStatuses(reports), [reports])

  function summarizeScan(nextReports: AssetReport[], failedCount: number, skippedCount: number) {
    const parts = [`${nextReports.length} checked`]

    if (failedCount > 0) parts.push(`${failedCount} failed`)
    if (skippedCount > 0) parts.push(`${skippedCount} skipped`)

    return parts.join('. ') + '.'
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setIsScanning(true)
    setQueueProgress({ total: files.length, completed: 0, failed: 0, skipped: 0 })
    setScanNotice({
      tone: 'info',
      title: 'Checking files',
      detail: 'Reading selected files locally. Larger images may take a moment.',
    })

    try {
      const selectedFiles = Array.from(files)
      const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))
      const skippedCount = selectedFiles.length - imageFiles.length

      if (imageFiles.length === 0) {
        setScanNotice({
          tone: 'warning',
          title: 'No supported images selected',
          detail: 'Choose PNG, JPEG, WebP, or another browser-readable image file.',
        })
        return
      }

      const nextReports: AssetReport[] = []
      let failedCount = 0

      for (const [index, file] of imageFiles.entries()) {
        setQueueProgress({
          total: imageFiles.length,
          completed: index,
          failed: failedCount,
          skipped: skippedCount,
          currentFile: file.name,
        })

        try {
          nextReports.push(await analyzeImageFile(file))
        } catch {
          failedCount += 1
        }

        setQueueProgress({
          total: imageFiles.length,
          completed: index + 1,
          failed: failedCount,
          skipped: skippedCount,
          currentFile: imageFiles[index + 1]?.name,
        })

        if ((index + 1) % QUEUE_YIELD_EVERY === 0) {
          await pauseForPaint()
        }
      }

      if (nextReports.length > 0) {
        setReports((current) => [...nextReports, ...current])
        setSelectedReportId(nextReports[0].id)
      }

      if (failedCount > 0) {
        setScanNotice({
          tone: 'error',
          title: failedCount === imageFiles.length ? 'Scan failed' : 'Some files could not be checked',
          detail:
            failedCount === imageFiles.length
              ? 'The selected image could not be decoded or analyzed in this browser.'
              : summarizeScan(nextReports, failedCount, skippedCount),
        })
        return
      }

      setScanNotice({
        tone: skippedCount > 0 ? 'warning' : 'success',
        title: skippedCount > 0 ? 'Checked supported images' : 'Scan complete',
        detail:
          skippedCount > 0
            ? `${nextReports.length} checked. ${skippedCount} unsupported file${skippedCount === 1 ? '' : 's'} skipped.`
            : `${nextReports.length} image${nextReports.length === 1 ? '' : 's'} checked locally.`,
      })
    } finally {
      setIsScanning(false)
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    void onFiles(event.dataTransfer.files)
  }

  function downloadJsonReport(report: AssetReport) {
    const reportCertificate = buildCertificate(report)
    const blob = new Blob([stringifyCertificate(reportCertificate)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = certificateFileName(report)
    anchor.rel = 'noopener'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function downloadHtmlReport(report: AssetReport) {
    const previewDataUrl = await previewUrlToDataUrl(report.previewUrl)
    const blob = new Blob([buildHtmlReport(report, previewDataUrl)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = htmlReportFileName(report)
    anchor.rel = 'noopener'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function downloadFullHtmlReport() {
    const previews = Object.fromEntries(
      await Promise.all(
        reports.map(async (report) => [report.id, await previewUrlToDataUrl(report.previewUrl)] as const),
      ),
    )
    const blob = new Blob([buildProjectHtmlReport(reports, previews)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = projectHtmlReportFileName()
    anchor.rel = 'noopener'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function downloadAllReports() {
    const blob = createReportZipBlob(reports)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = reportZipFileName()
    anchor.rel = 'noopener'
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

        <label
          className={`drop-zone ${isScanning ? 'is-loading' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <input
            multiple
            accept="image/*"
            type="file"
            aria-label="Choose image files to check"
            aria-describedby="upload-help"
            onChange={(event) => void onFiles(event.target.files)}
          />
          <span className="drop-title">{isScanning ? 'Checking images...' : 'Drop images here'}</span>
          <span className="drop-action">Browse files</span>
          <span className="drop-detail" id="upload-help">
            PNG, JPEG, WebP, and other browser-readable image files. Files stay on this device.
          </span>
        </label>
      </section>

      <section className="workspace">
        <aside className="queue-panel" aria-busy={isScanning}>
          <div className="panel-heading">
            <h2>Asset Queue</h2>
            <span aria-live="polite">
              {isScanning
                ? `${queueProgress.completed}/${queueProgress.total} scanning`
                : `${reports.length} checked`}
            </span>
          </div>

          <dl className="status-summary" aria-label="Report status summary">
            <div>
              <dt>AI Found</dt>
              <dd>{statusCounts['AI markers found']}</dd>
            </div>
            <div>
              <dt>No AI Found</dt>
              <dd>{statusCounts['No AI markers found']}</dd>
            </div>
            <div>
              <dt>Could Not Check</dt>
              <dd>{statusCounts['Could not complete check']}</dd>
            </div>
          </dl>

          <div className="batch-actions">
            <div>
              <button
                type="button"
                onClick={downloadAllReports}
                disabled={reports.length === 0}
                aria-label="Download a ZIP containing JSON reports for all checked assets"
              >
                JSON Pack
              </button>
              <span className="action-hint">ZIP archive for automation</span>
            </div>
            <div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void downloadFullHtmlReport()}
                disabled={reports.length === 0}
                aria-label="Download a single HTML report for all checked assets"
              >
                Full HTML
              </button>
              <span className="action-hint">Printable batch report</span>
            </div>
            {queueProgress.failed > 0 || queueProgress.skipped > 0 ? (
              <span>
                {queueProgress.failed > 0 ? `${queueProgress.failed} failed` : null}
                {queueProgress.failed > 0 && queueProgress.skipped > 0 ? ' / ' : null}
                {queueProgress.skipped > 0 ? `${queueProgress.skipped} skipped` : null}
              </span>
            ) : null}
          </div>

          {isScanning ? (
            <div className="queue-progress" aria-live="polite">
              <progress
                value={queueProgress.completed}
                max={queueProgress.total || 1}
                aria-label="Batch scan progress"
              />
              <span>{queueProgress.currentFile ?? 'Preparing batch...'}</span>
            </div>
          ) : null}

          {scanNotice ? (
            <div className={`status-callout ${scanNotice.tone}`} role="status" aria-live="polite">
              <strong>{scanNotice.title}</strong>
              <span>{scanNotice.detail}</span>
            </div>
          ) : null}

          {reports.length === 0 && !isScanning ? (
            <p className="empty-state">
              Add an image to create the first local provenance report. Unsupported files are skipped with a note.
            </p>
          ) : reports.length === 0 ? (
            <p className="empty-state loading-state">Preparing the first report...</p>
          ) : (
            <div className="queue-list" role="list" aria-label="Checked assets">
              {reports.map((report) => (
                <article className="queue-item" key={report.id} role="listitem">
                  <button
                    type="button"
                    className={`queue-select ${activeReport?.id === report.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedReportId(report.id)}
                    aria-current={activeReport?.id === report.id ? 'true' : undefined}
                    aria-label={`View report for ${report.fileName}`}
                  >
                    <img src={report.previewUrl} alt="" />
                    <span>
                      <strong>{report.fileName}</strong>
                      <em>{reportStatus(report)}</em>
                    </span>
                  </button>
                </article>
              ))}
            </div>
          )}
        </aside>

        <section className="report-panel" aria-live="polite">
          {activeReport ? (
            <>
              <div className="report-summary">
                <img src={activeReport.previewUrl} alt="" />
                <div>
                  <p className="eyebrow">Report Preview</p>
                  <span className={`result-badge ${statusTone(activeStatus)}`}>
                    {statusBadgeLabel(activeStatus)}
                  </span>
                  <h2>{activeStatus === 'AI markers found' ? 'Evidence of AI generation found' : activeStatus}</h2>
                  <p>{resultWording(activeReport)}</p>
                  <div className="report-actions">
                    <button
                      type="button"
                      onClick={() => void downloadHtmlReport(activeReport)}
                      aria-label={`Download HTML report for selected asset ${activeReport.fileName}`}
                    >
                      Download HTML Report
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => downloadJsonReport(activeReport)}
                      aria-label={`Download JSON report for selected asset ${activeReport.fileName}`}
                    >
                      Download JSON Report
                    </button>
                  </div>
                  <p className="action-hint">HTML is self-contained and print-friendly. JSON is for archives and automation.</p>
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
                <div className="section-heading">
                  <h3>Marker Verdicts</h3>
                  <span>Raw byte and capability checks</span>
                </div>
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

              <section className="metadata-panel">
                <div className="section-heading">
                  <h3>C2PA Verification</h3>
                  <span>{activeReport.c2pa.state}</span>
                </div>
                <dl className="metadata-list">
                  <div>
                    <dt>Verifier</dt>
                    <dd>
                      <span>{activeReport.c2pa.source}</span>
                    </dd>
                  </div>
                  {activeReport.c2pa.issuer ? (
                    <div>
                      <dt>Issuer</dt>
                      <dd>
                        <span>{activeReport.c2pa.issuer}</span>
                      </dd>
                    </div>
                  ) : null}
                  {activeReport.c2pa.claimGenerator ? (
                    <div>
                      <dt>Claim Generator</dt>
                      <dd>
                        <span>{activeReport.c2pa.claimGenerator}</span>
                      </dd>
                    </div>
                  ) : null}
                  {activeReport.c2pa.actions.map((action, index) => (
                    <div key={action.action + '-' + (action.when ?? index)}>
                      <dt>Action</dt>
                      <dd>
                        <strong>{action.action}</strong>
                        {action.when ? <span>{action.when}</span> : null}
                        {action.softwareAgent ? <span>{action.softwareAgent}</span> : null}
                        {action.digitalSourceType ? <span>{action.digitalSourceType}</span> : null}
                      </dd>
                    </div>
                  ))}
                  {activeReport.c2pa.errors.map((error) => (
                    <div key={error}>
                      <dt>Verifier Note</dt>
                      <dd>
                        <span>{error}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="metadata-panel">
                <div className="section-heading">
                  <h3>EXIF / XMP / IPTC Metadata</h3>
                  <span>{activeReport.metadata.presence}</span>
                </div>
                <article className={`check-row ${activeReport.metadata.state}`}>
                  <span>{activeReport.metadata.state}</span>
                  <div>
                    <h3>Structured metadata parser</h3>
                    <p>{activeReport.metadata.detail}</p>
                  </div>
                </article>

                {activeReport.metadata.findings.length > 0 ? (
                  <dl className="metadata-list">
                    {activeReport.metadata.findings.map((finding) => (
                      <div key={`${finding.source}-${finding.category}-${finding.field}`}>
                        <dt>
                          {finding.source.toUpperCase()} · {finding.category}
                        </dt>
                        <dd>
                          <strong>{finding.field}</strong>
                          <span>{finding.value}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </section>
            </>
          ) : (
            <div className="blank-report">
              <h2>Evidence, not vibes.</h2>
              <p>
                AntiSlop checks for known provenance signals and produces a report
                that says exactly what was inspected. Select an image to see the report here.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
