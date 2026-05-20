export type C2paVerificationState = 'not-found' | 'found' | 'valid' | 'invalid' | 'unsupported'

export type C2paActionSummary = {
  action: string
  when?: string
  softwareAgent?: string
  digitalSourceType?: string
}

export type C2paVerificationResult = {
  state: C2paVerificationState
  issuer?: string
  claimGenerator?: string
  actions: C2paActionSummary[]
  errors: string[]
  source: 'byte-sniff' | 'c2pa-web'
}

export const C2PA_SUPPORTED_BROWSER_FORMATS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
] as const

export function isLikelyC2paFormat(fileType: string) {
  return C2PA_SUPPORTED_BROWSER_FORMATS.includes(
    fileType.toLowerCase() as (typeof C2PA_SUPPORTED_BROWSER_FORMATS)[number],
  )
}

export function emptyC2paResult(
  state: C2paVerificationState,
  source: C2paVerificationResult['source'],
  errors: string[] = [],
): C2paVerificationResult {
  return {
    state,
    actions: [],
    errors,
    source,
  }
}

export function sniffC2paBytes(sample: string, fileType: string): C2paVerificationResult {
  const hasMarker =
    sample.includes('c2pa') ||
    sample.includes('contentauthenticity') ||
    sample.includes('content credentials')

  if (!isLikelyC2paFormat(fileType)) {
    return emptyC2paResult(
      hasMarker ? 'found' : 'unsupported',
      'byte-sniff',
      [String(fileType || 'unknown') + ' is not in the browser C2PA verifier supported-format set.'],
    )
  }

  return emptyC2paResult(hasMarker ? 'found' : 'not-found', 'byte-sniff')
}

export function c2paCheckDetail(result: C2paVerificationResult) {
  const prefix = result.source === 'c2pa-web' ? 'C2PA WASM verifier' : 'C2PA byte scan'

  if (result.state === 'valid') {
    return prefix + ' found a manifest with a valid validation state.'
  }

  if (result.state === 'invalid') {
    return prefix + ' found C2PA metadata, but validation reported it invalid.'
  }

  if (result.state === 'found') {
    return result.source === 'c2pa-web'
      ? prefix + ' found C2PA metadata, but did not return a valid or invalid final validation state.'
      : prefix + ' found C2PA marker bytes. This is a marker-only fallback, not cryptographic validation.'
  }

  if (result.state === 'unsupported') {
    return (
      prefix +
      ' could not verify this file. ' +
      (result.errors[0] ?? 'The format or runtime is unsupported.')
    )
  }

  return prefix + ' found no C2PA manifest in this file.'
}

export function c2paStateToCheckState(result: C2paVerificationResult) {
  if (result.state === 'valid' || result.state === 'not-found') return 'clear'
  if (result.state === 'found' || result.state === 'unsupported') return 'warning'
  return 'found'
}
