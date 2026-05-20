# AntiSlop Roadmap

AntiSlop is a local-first marker check for image assets. It helps artists, developers, and small teams produce a defensible report without pretending to prove human authorship.

## Current MVP State

The current app can:

1. Open as a static browser app.
2. Check one or more image files without uploading them anywhere.
3. Show file identity, thumbnail, dimensions, SHA-256 hash, and marker result.
4. Switch between scanned assets in the queue.
5. Remove a single asset from the queue after confirmation.
6. Start a new report by clearing the queue after confirmation.
7. Inspect C2PA / Content Credentials status, metadata findings, and local marker checks.
8. Export a selected asset as a self-contained, print-friendly HTML report.
9. Export a selected asset as a JSON report.
10. Export all scanned assets as one full-batch HTML report with methods and privacy rationale.
11. Export all scanned assets as a ZIP containing JSON reports and a summary manifest.
12. Read an in-app About / Methods and Privacy section explaining what is checked and why files stay local.

## Shipped Work Slices

### 1. Analysis Core

- Scan logic lives in typed core modules.
- Reports are deterministic enough for Node-side tests.
- Synthetic fixtures cover generator strings, missing metadata, and C2PA states.
- The core exposes JSON report, HTML report, and report-package builders.

### 2. Structured Metadata

- EXIF, XMP, IPTC, and readable byte markers are parsed through `exifr` plus raw marker scanning.
- Software, creator, copyright, timestamp, generator, prompt, and edit-trace fields are surfaced where present.
- Metadata missing is treated as a check note, not top-level AI evidence.

### 3. C2PA Verification

- C2PA / Content Credentials verification is integrated through `@contentauth/c2pa-web`.
- The app records issuer, claim generator, actions, validation state, and verifier notes where available.
- Unsupported formats and verifier failures remain explicit.
- Byte sniffing remains a fallback only and is described as marker-only, not cryptographic validation.

### 4. Report Export

- JSON report schema exists for archives and automation.
- Single-asset HTML reports are self-contained and print-friendly.
- Full-batch HTML reports include summary counts, asset rows, methods, limitations, and cloud-scanner privacy rationale.
- Long filenames and SHA-256 hashes collapse behind expandable details in HTML reports.
- JSON report packs are exported as ZIP archives.

### 5. Batch Workflow

- Multiple files can be checked in one selection/drop.
- Queue results are selectable.
- Summary counts update across the batch.
- New Report and Remove actions are guarded by confirmation prompts.

### 6. Product Polish

- Top-level outcomes are `AI markers found`, `No AI markers found`, and `Could not complete check`.
- The app avoids generic AI-detector claims.
- Copy now describes general image assets instead of the earlier narrower framing.
- In-app About content explains local methods and privacy tradeoffs.

## Remaining Work

### Public Fixtures

- Add committed public signed C2PA fixtures to exercise real valid/invalid manifests in CI.
- Add public expected snapshots where licensing allows.
- Keep private/local test images in `test-corpus/local/**`.

### UI Verification

- Add screenshot-based checks for desktop and mobile layouts.
- Verify print output for single-asset and full-batch HTML reports.
- Exercise long filenames, long metadata values, and large batch reports.

### Report Pack Improvements

- Consider adding HTML reports to the ZIP export alongside JSON reports.
- Consider an index HTML file inside report packs.
- Consider a lightweight manifest viewer for exported packs.

### Offline Watermark Research

- Track vendor watermark systems such as SynthID, but only implement checks where an offline browser verifier is legally and technically available.
- Do not add cloud-scanner flows that require artists to upload unpublished work to AI providers.

## Non-Goals

- Generic visual AI classification.
- Uploading files to cloud detectors.
- Claims that an asset is human-made or legally safe to use.
- A remote validation service for private project assets.

## Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 22
- No server-side functions required.
