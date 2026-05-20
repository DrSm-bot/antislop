import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { analyzeBytes, type CheckState } from '../src/core/analysis.ts'

type FixtureCategory =
  | 'human-made'
  | 'ai-generated'
  | 'stripped-metadata'
  | 'transformed'
  | 'c2pa-bearing'

type FixtureManifest = {
  fixtures: FixtureEntry[]
}

type FixtureEntry = {
  id: string
  category: FixtureCategory
  path?: string
  fileName?: string
  fileType: string
  dimensions: string
  sampleText?: string
  syntheticXmpDescription?: string
  license?: string
  expected?: Record<string, CheckState>
  expectedMetadata?: {
    presence?: 'missing' | 'present'
    state?: CheckState
  }
}

type RunnerOptions = {
  manifestPath: string
  writeSnapshots: boolean
}

const DEFAULT_MANIFEST = 'test-corpus/manifest.example.json'
const textEncoder = new TextEncoder()

function usage() {
  return [
    'Usage: npm run fixtures:analyze -- [--manifest <path>] [--write]',
    '',
    'Examples:',
    '  npm run fixtures:analyze',
    '  npm run fixtures:analyze -- --manifest test-corpus/manifest.local.json --write',
  ].join('\n')
}

function parseArgs(args: string[]): RunnerOptions {
  let manifestPath = DEFAULT_MANIFEST
  let writeSnapshots = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--manifest') {
      const value = args[index + 1]
      if (!value) throw new Error('--manifest requires a path')
      manifestPath = value
      index += 1
      continue
    }

    if (arg === '--write') {
      writeSnapshots = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`)
  }

  return { manifestPath, writeSnapshots }
}

function assertFixture(entry: FixtureEntry) {
  if (!entry.id) throw new Error('Fixture is missing id')
  if (!entry.category) throw new Error(`Fixture ${entry.id} is missing category`)
  if (!entry.fileType) throw new Error(`Fixture ${entry.id} is missing fileType`)
  if (!entry.dimensions) throw new Error(`Fixture ${entry.id} is missing dimensions`)
  if (!entry.path && entry.sampleText === undefined && entry.syntheticXmpDescription === undefined) {
    throw new Error(`Fixture ${entry.id} needs path, sampleText, or syntheticXmpDescription`)
  }
}

function jpegWithApp1(payload: string) {
  const payloadBytes = textEncoder.encode(payload)
  const segmentLength = payloadBytes.length + 2
  const bytes = new Uint8Array(2 + 2 + 2 + payloadBytes.length + 2)
  let offset = 0

  bytes.set([0xff, 0xd8, 0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff], offset)
  offset += 6
  bytes.set(payloadBytes, offset)
  offset += payloadBytes.length
  bytes.set([0xff, 0xd9], offset)

  return bytes
}

function syntheticXmpPacket(description: string) {
  return [
    'http://ns.adobe.com/xap/1.0/\\0',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" ',
    'xmp:CreatorTool="Affinity Photo 2" xmp:CreateDate="2026-05-20T00:00:00Z">',
    '<dc:creator><rdf:Seq><rdf:li>Fixture Artist</rdf:li></rdf:Seq></dc:creator>',
    '<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright Fixture Artist</rdf:li></rdf:Alt></dc:rights>',
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${description}</rdf:li></rdf:Alt></dc:description>`,
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
  ].join('')
}

async function bytesForFixture(entry: FixtureEntry, manifestDir: string) {
  if (entry.path) {
    const fixturePath = path.resolve(manifestDir, entry.path)
    const bytes = await readFile(fixturePath)
    return {
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      fileName: entry.fileName ?? path.basename(entry.path),
      fileSize: bytes.byteLength,
    }
  }

  if (entry.syntheticXmpDescription !== undefined) {
    const bytes = jpegWithApp1(syntheticXmpPacket(entry.syntheticXmpDescription))
    return {
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      fileName: entry.fileName ?? `${entry.id}.jpg`,
      fileSize: bytes.byteLength,
    }
  }

  const bytes = textEncoder.encode(entry.sampleText ?? '')
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    fileName: entry.fileName ?? `${entry.id}.fixture`,
    fileSize: bytes.byteLength,
  }
}

function validateExpected(entry: FixtureEntry, report: Awaited<ReturnType<typeof analyzeBytes>>) {
  for (const [checkId, expectedState] of Object.entries(entry.expected ?? {})) {
    const actual = report.checks.find((check) => check.id === checkId)?.state

    if (actual !== expectedState) {
      throw new Error(
        `${entry.id}: expected ${checkId} to be ${expectedState}, got ${actual ?? 'missing'}`,
      )
    }
  }

  if (entry.expectedMetadata?.presence && report.metadata.presence !== entry.expectedMetadata.presence) {
    throw new Error(
      `${entry.id}: expected metadata presence to be ${entry.expectedMetadata.presence}, got ${report.metadata.presence}`,
    )
  }

  if (entry.expectedMetadata?.state && report.metadata.state !== entry.expectedMetadata.state) {
    throw new Error(
      `${entry.id}: expected metadata state to be ${entry.expectedMetadata.state}, got ${report.metadata.state}`,
    )
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifestPath = path.resolve(options.manifestPath)
  const manifestDir = path.dirname(manifestPath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureManifest

  if (!Array.isArray(manifest.fixtures)) {
    throw new Error('Manifest must contain a fixtures array')
  }

  const reports = []

  for (const entry of manifest.fixtures) {
    assertFixture(entry)
    const fixtureBytes = await bytesForFixture(entry, manifestDir)
    const report = await analyzeBytes({
      bytes: fixtureBytes.bytes,
      fileName: fixtureBytes.fileName,
      fileType: entry.fileType,
      fileSize: fixtureBytes.fileSize,
      dimensions: entry.dimensions,
      previewUrl: entry.path ?? `fixture:${entry.id}`,
      checkedAt: '1970-01-01T00:00:00.000Z',
      id: entry.id,
    })

    validateExpected(entry, report)
    reports.push(report)

    if (options.writeSnapshots) {
      const outDir = path.resolve('test-corpus/expected')
      await mkdir(outDir, { recursive: true })
      await writeFile(path.join(outDir, `${entry.id}.json`), `${JSON.stringify(report, null, 2)}\n`)
    }

    console.log(`ok ${entry.id}`)
  }

  console.log(`analyzed ${reports.length} fixture(s)`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
