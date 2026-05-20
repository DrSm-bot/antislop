# AntiSlop

AntiSlop is a private, browser-based asset marker check for game artists and small teams.

It scans image files locally for known AI provenance markers and exports a report that says exactly what was checked. The goal is evidence, not magic: AntiSlop can report that no supported marker was detected, but it cannot prove that an image was human-made.

## MVP Scope

- Local image drop zone, no upload path.
- SHA-256 hash for the exact checked file.
- Browser thumbnail and file summary.
- Readable metadata scan for common generator strings.
- Initial C2PA / Content Credentials marker scan.
- Explicit unsupported status for vendor-only invisible watermark checks such as SynthID.
- JSON certificate export.

## Planned Checks

- Full C2PA manifest validation through the Content Authenticity Initiative WASM/JS stack.
- EXIF, XMP, and IPTC parsing with structured field output.
- Batch reports and ZIP export for project folders.
- PDF/PNG certificate export.
- Optional research watermark modules where an offline detector is legally and technically available.

## Language Policy

AntiSlop should not claim to be a generic AI detector. Generic visual AI classifiers are brittle and can create false accusations against artists.

Preferred wording:

- "Known AI provenance markers checked locally."
- "No supported AI marker was detected."
- "This report does not prove human authorship."

Avoid:

- "This image is not AI-generated."
- "Proof this asset is human-made."

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

Build for Cloudflare Pages:

\`\`\`bash
npm run build
\`\`\`

Cloudflare Pages settings:

- Build command: \`npm run build\`
- Output directory: \`dist\`

## License

MIT
