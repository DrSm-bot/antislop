import { analyzeBytes, decodeTextSample } from './analysis.ts'

function bytesFromText(value: string) {
  return new TextEncoder().encode(value).buffer
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function reportFor(text: string) {
  return analyzeBytes({
    bytes: bytesFromText(text),
    fileName: 'synthetic.png',
    fileType: 'image/png',
    fileSize: text.length,
    dimensions: '1 x 1',
    previewUrl: 'blob:test',
    checkedAt: '2026-05-20T00:00:00.000Z',
    id: 'test-report',
  })
}

function checkState(report: Awaited<ReturnType<typeof reportFor>>, id: string) {
  const check = report.checks.find((entry) => entry.id === id)
  assert(check !== undefined, `Missing ${id} check`)
  return check.state
}

const knownGenerator = await reportFor('Software: Stable Diffusion XL')
assert(checkState(knownGenerator, 'metadata') === 'found', 'known generator text is flagged')
assert(checkState(knownGenerator, 'c2pa') === 'clear', 'generator-only text does not imply C2PA')

const noMarker = await reportFor('ordinary camera export with EXIF metadata')
assert(checkState(noMarker, 'metadata') === 'clear', 'ordinary metadata has no generator flag')
assert(checkState(noMarker, 'structure') === 'clear', 'EXIF marker counts as metadata structure')

const possibleC2pa = await reportFor('asset includes Content Credentials manifest bytes')
assert(checkState(possibleC2pa, 'c2pa') === 'warning', 'C2PA-like text is surfaced as possible provenance')
assert(checkState(possibleC2pa, 'metadata') === 'clear', 'C2PA text does not imply generator metadata')

const stripped = await reportFor('\x00\x01\x02\xff')
assert(checkState(stripped, 'metadata') === 'clear', 'binary-only sample has no generator flag')
assert(checkState(stripped, 'structure') === 'warning', 'missing metadata markers are reported')
assert(decodeTextSample(bytesFromText('A\x00B')) === 'a b', 'text sampler strips unreadable bytes')

console.log('analysis core tests passed')
