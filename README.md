# AntiSlop

AntiSlop is a private, browser-based asset marker check for artists, developers, and small teams.

It checks image assets locally for known AI provenance markers and exports reports that say exactly what was checked. The goal is evidence, not magic: AntiSlop can report that no supported marker was detected, but it cannot prove that an image was human-made.

## Current Features

- Local image drop zone, no upload path.
- Batch queue for multiple image assets.
- Selectable asset results with per-asset removal.
- Guarded new-report action to clear the current queue.
- SHA-256 hash for the exact checked file.
- Browser thumbnail and file summary.
- Readable metadata scan for common generator strings.
- C2PA / Content Credentials adapter with browser WASM validation where supported.
- Explicit unsupported status for vendor-only invisible watermark checks such as SynthID.
- Visible result buckets: `AI markers found`, `No AI markers found`, and `Could not complete check`.
- JSON report export for archives and automation.
- JSON report pack ZIP for all scanned assets.
- Self-contained single-asset and full-batch HTML reports with print-friendly styling.
- About / Methods and Privacy section explaining the local-first approach.

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

## Remaining Work

- Broader C2PA fixture coverage with real signed public test assets.
- More public expected snapshots where fixture licensing allows.
- UI verification with screenshots across desktop and mobile viewports.
- Optional report-pack improvements, such as including HTML reports in ZIP exports.
- Optional research watermark modules where an offline detector is legally and technically available.

## Language Policy

AntiSlop should not claim to be a generic AI detector. Generic visual AI classifiers are brittle and can create false accusations against artists.

Preferred wording:

- "Known AI provenance markers checked locally."
- "No supported AI marker was detected."
- "This report does not prove human authorship."
- "Check image assets for known AI provenance markers."

Avoid:

- "This image is not AI-generated."
- "Proof this asset is human-made."

## Development

```bash
npm install
npm run dev
```

Analyze documented local fixtures:

```bash
npm run fixtures:analyze
# or
npm run fixtures:analyze -- --manifest test-corpus/manifest.local.json --write
```

See [docs/test-corpus.md](docs/test-corpus.md) for fixture layout, privacy rules, and expected snapshot guidance.

Build for Cloudflare Pages:

```bash
npm run lint
npm test
npm run build
```

Cloudflare Pages settings:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: 22

## License

MIT
