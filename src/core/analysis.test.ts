import {
  buildCertificate,
  certificateFileName,
  decodeTextSample,
  analyzeBytes,
  stringifyCertificate,
} from './analysis.ts'

function bytesFromText(value: string) {
  return new TextEncoder().encode(value).buffer
}

function jpegWithApp1(payload: string) {
  const payloadBytes = new TextEncoder().encode(payload)
  const segmentLength = payloadBytes.length + 2
  const bytes = new Uint8Array(2 + 2 + 2 + payloadBytes.length + 2)
  let offset = 0

  bytes.set([0xff, 0xd8, 0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff], offset)
  offset += 6
  bytes.set(payloadBytes, offset)
  offset += payloadBytes.length
  bytes.set([0xff, 0xd9], offset)

  return bytes.buffer
}

function xmpPacket(description: string) {
  return [
    'http://ns.adobe.com/xap/1.0/\\0',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" ',
    'xmp:CreatorTool="Affinity Photo 2" xmp:CreateDate="2026-05-20T00:00:00Z">',
    '<dc:creator><rdf:Seq><rdf:li>Alice Example</rdf:li></rdf:Seq></dc:creator>',
    '<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright Alice</rdf:li></rdf:Alt></dc:rights>',
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description>`,
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
  ].join('')
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

async function reportForBytes(bytes: ArrayBuffer, fileName = 'synthetic.jpg') {
  return analyzeBytes({
    bytes,
    fileName,
    fileType: 'image/jpeg',
    fileSize: bytes.byteLength,
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
assert(checkState(knownGenerator, 'c2pa') === 'clear', 'generator-only text does not imply C2PA')

const noMarker = await reportFor('ordinary camera export with EXIF metadata')
assert(checkState(noMarker, 'structure') === 'clear', 'EXIF marker counts as metadata structure')

const possibleC2pa = await reportFor('asset includes Content Credentials manifest bytes')
assert(checkState(possibleC2pa, 'c2pa') === 'warning', 'C2PA-like text is surfaced as possible provenance')

const stripped = await reportFor('\x00\x01\x02\xff')
assert(checkState(stripped, 'structure') === 'warning', 'missing metadata markers are reported')
assert(stripped.metadata.presence === 'missing', 'binary-only sample has missing metadata')
assert(stripped.metadata.state === 'warning', 'missing metadata is distinct from clean metadata')
assert(decodeTextSample(bytesFromText('A\x00B')) === 'a b', 'text sampler strips unreadable bytes')

const presentMetadata = await reportForBytes(jpegWithApp1(xmpPacket('Camera-original concept art')))
assert(presentMetadata.metadata.presence === 'present', 'XMP metadata is parsed as present')
assert(
  presentMetadata.metadata.state === 'clear',
  'metadata without known generator markers is not flagged',
)
assert(
  presentMetadata.metadata.findings.some((finding) => finding.category === 'creator'),
  'creator fields are extracted',
)
assert(
  presentMetadata.metadata.findings.some((finding) => finding.category === 'copyright'),
  'copyright fields are extracted',
)

const generatorMetadata = await reportForBytes(
  jpegWithApp1(xmpPacket('Prompt: stable diffusion fantasy inventory icon')),
)
assert(generatorMetadata.metadata.presence === 'present', 'generator fixture has metadata present')
assert(generatorMetadata.metadata.state === 'found', 'known generator metadata is flagged')
assert(
  generatorMetadata.metadata.findings.some(
    (finding) => finding.category === 'generator' && finding.matchedGeneratorTerm,
  ),
  'generator field records matched term',
)

const certificate = buildCertificate(generatorMetadata)
assert(certificate.schema === 'antislop.certificate', 'certificate has a stable schema name')
assert(certificate.schemaVersion === 1, 'certificate has a versioned schema')
assert(certificate.tool.name === 'AntiSlop', 'certificate identifies the tool')
assert(certificate.tool.version === '0.1.0', 'certificate records the tool version')
assert(certificate.result.status === 'Known marker found', 'certificate records result status')
assert(
  certificate.result.wording ===
    'Known AI-generation or provenance marker text was found in the local scan.',
  'certificate records careful result wording',
)
assert(certificate.file.name === 'synthetic.jpg', 'certificate includes file name')
assert(certificate.file.type === 'image/jpeg', 'certificate includes file type')
assert(certificate.file.sizeBytes === generatorMetadata.fileSize, 'certificate includes size')
assert(certificate.file.dimensions === '1 x 1', 'certificate includes dimensions')
assert(certificate.file.sha256.length === 64, 'certificate includes SHA-256')
assert(certificate.preview.type === 'browser-object-url', 'certificate includes preview reference')
assert(certificate.checkedAt === '2026-05-20T00:00:00.000Z', 'certificate includes timestamp')
assert(certificate.checks.length === generatorMetadata.checks.length, 'certificate includes check list')
assert(certificate.metadata?.presence === 'present', 'certificate includes metadata report')
assert(
  certificate.limitations.some((entry) => entry.includes('does not prove human authorship')),
  'certificate avoids human authorship claims',
)

const serializedCertificate = stringifyCertificate(certificate)
assert(serializedCertificate.endsWith('\n'), 'certificate JSON has a stable trailing newline')
assert(
  JSON.parse(serializedCertificate).schemaVersion === 1,
  'serialized certificate remains parseable JSON',
)
assert(
  certificateFileName({
    ...knownGenerator,
    fileName: ' test image @ 2x.png ',
  }) === 'test-image-2x.png.antislop-certificate-v1.json',
  'certificate filename is stable and sanitized',
)

console.log('analysis core tests passed')
