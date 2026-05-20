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
  license?: string
  expected?: Record<string, CheckState>
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
  if (!entry.path && entry.sampleText === undefined) {
    throw new Error(`Fixture ${entry.id} needs either path or sampleText`)
  }
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
