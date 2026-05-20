# Local Test Corpus

Put local image fixtures under `local/` using these categories:

- `human-made/`
- `ai-generated/`
- `stripped-metadata/`
- `transformed/`
- `c2pa-bearing/`

Real images in `local/` are ignored by git. Commit only documentation, manifests that contain no private data, and expected snapshots in `expected/` when licensing allows.

Run:

```bash
npm run fixtures:analyze -- --manifest test-corpus/manifest.local.json
```

Use `--write` to update `test-corpus/expected/<fixture-id>.json`.
