# AntiSlop MVP Roadmap

AntiSlop is a local-first marker check for image assets. The MVP must help artists produce a defensible report without pretending to prove human authorship.

## MVP Definition

The MVP is complete when a user can:

1. Open AntiSlop as a static browser app.
2. Drop one or more image files without uploading them anywhere.
3. See file identity, thumbnail, dimensions, hash, and check status.
4. Inspect structured metadata and provenance findings.
5. Export a report suitable for attaching to an asset review package.
6. Understand the limits of the report in plain language.

## Work Slices

### 1. Analysis Core

- Move scan logic out of App.tsx into typed modules.
- Return deterministic report objects that can be tested without rendering React.
- Add fixtures for synthetic files that contain known metadata strings.
- Keep the API ready for C2PA and EXIF/XMP/IPTC adapters.

### 2. Structured Metadata

- Parse EXIF, XMP, and IPTC fields using a maintained browser-compatible library.
- Surface software, creator, copyright, prompt/generator-like fields, timestamps, and edit history where present.
- Distinguish "metadata missing" from "metadata present but no known generator marker found."

### 3. C2PA Verification

- Integrated the current Content Authenticity Initiative browser/WASM stack through `@contentauth/c2pa-web`.
- Validate manifests where possible instead of byte-sniffing only.
- Show issuer, claim generator, actions, validation state, and manifest errors.
- Keep unsupported or stripped C2PA states explicit.
- Remaining work: add committed public signed C2PA fixtures to exercise real valid/invalid manifests in CI.

### 4. Report Export

- Define a stable report schema.
- Export JSON for archives and automation.
- Export a self-contained, print-friendly HTML report for sharing or browser print-to-PDF.
- Include thumbnail, SHA-256, checks performed, result wording, tool version, timestamp, and limitations.
- Avoid any statement that claims proof of human authorship.

### 5. Batch Workflow

- Handle many files without UI stalls.
- Add per-file status, summary counts, and report ZIP export.
- Use workers where parsing or hashing blocks the main thread.

### 6. Test Corpus

- Add a documented fixture layout for human-made, AI-generated, stripped-metadata, and transformed images.
- Do not commit private or copyrighted test assets without permission.
- Store expected outcomes as report snapshots where licensing allows.

### 7. Product Polish

- Improve empty, loading, error, and unsupported states.
- Tune responsive layout for desktop and mobile.
- Add accessible keyboard and screen-reader flows for file upload and report export.
- Keep the copy sharp: "scan game art for known AI provenance markers."

## Non-Goals For MVP

- Generic visual AI classification.
- Uploading files to cloud detectors.
- Vendor-only watermark checks unless an offline verifier is publicly available.
- Claims that an asset is human-made or legally safe to use.

## Cloudflare Pages

- Build command: npm run build
- Output directory: dist
- No server-side functions required for MVP.
