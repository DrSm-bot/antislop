import { useState } from 'react'
import { analyzeImageFile } from './lib/browserAnalysis'
import {
  buildCertificate,
  certificateFileName,
  formatBytes,
  reportStatus,
  stringifyCertificate,
  type AssetReport,
} from './core/analysis'
import './App.css'

function App() {
  const [reports, setReports] = useState<AssetReport[]>([])
  const [isScanning, setIsScanning] = useState(false)

  const activeReport = reports[0]
  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setIsScanning(true)

    try {
      const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
      const nextReports = await Promise.all(imageFiles.map(analyzeImageFile))
      setReports((current) => [...nextReports, ...current])
    } finally {
      setIsScanning(false)
    }
  }

  function downloadCertificate(report: AssetReport) {
    const reportCertificate = buildCertificate(report)
    const blob = new Blob([stringifyCertificate(reportCertificate)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = certificateFileName(report)
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
