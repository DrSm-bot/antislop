# AntiSlop

AntiSlop is a private, browser-based asset marker check for game artists and small teams.

It scans image files locally for known AI provenance markers and exports a report that says exactly what was checked. The goal is evidence, not magic: AntiSlop can report that no supported marker was detected, but it cannot prove that an image was human-made.

## MVP Scope

- Local image drop zone, no upload path.
- SHA-256 hash for the exact checked file.
- Browser thumbnail and file summary.
- Readable metadata scan for common generator strings.
- C2PA / Content Credentials adapter with browser WASM validation where supported.
- Explicit unsupported status for vendor-only invisible watermark checks such as SynthID.
- JSON report export for archives and automation.
- Self-contained HTML report export with print-friendly styling.

## C2PA Capability

AntiSlop uses the current Content Authenticity Initiative browser package,
`@contentauth/c2pa-web`, for C2PA reads in the static app. The older `c2pa-js`
package name is only a security holding package on npm, and the unscoped `c2pa`
package points at the legacy stack.

For browser-supported formats, the adapter attempts local WASM verification and
records:

- validation state: `not-found`, `found`, `valid`, `invalid`, or `unsupported`
- issuer or signing common name when the manifest exposes it
- claim generator
- C2PA action assertions when available
- verifier errors or validation status notes

Limitations:

- The app remains static and browser-only; files are not uploaded.
- If `@contentauth/c2pa-web` cannot initialize, cannot parse a file, or the file
  type is unsupported, AntiSlop reports `unsupported` or falls back to marker-byte
  sniffing. That fallback can only say marker-looking bytes were present; it is not
  cryptographic C2PA validation.
- `valid` means the local C2PA library returned a `Valid` or `Trusted` manifest
  store state. It is still not proof of human authorship.

## Planned Checks

- Broader C2PA fixture coverage with real signed public test assets.
- EXIF, XMP, and IPTC parsing with structured field output.
- Batch reports and ZIP export for project folders.
- Batch HTML report pack export.
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

Analyze documented local fixtures:

\`\`\`bash
npm run fixtures:analyze
# or
npm run fixtures:analyze -- --manifest test-corpus/manifest.local.json --write
\`\`\`

See [docs/test-corpus.md](docs/test-corpus.md) for fixture layout, privacy rules, and expected snapshot guidance.

Build for Cloudflare Pages:

\`\`\`bash
npm run build
\`\`\`

Cloudflare Pages settings:

- Build command: \`npm run build\`
- Output directory: \`dist\`

## License

MIT
