import {
  createC2pa,
  isSupportedReaderFormat,
  type Action,
  type C2paSdk,
  type Manifest,
  type ManifestAssertion,
  type ValidationStatus,
} from '@contentauth/c2pa-web'
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url'
import {
  emptyC2paResult,
  sniffC2paBytes,
  type C2paActionSummary,
  type C2paVerificationResult,
} from '../core/c2pa'
import { decodeTextSample } from '../core/analysis'

let sdkPromise: Promise<C2paSdk> | undefined

function c2paSdk() {
  sdkPromise ??= createC2pa({ wasmSrc })
  return sdkPromise
}

function softwareAgentName(agent: Action['softwareAgent']) {
  if (!agent) return undefined
  if (typeof agent === 'string') return agent
  return [agent.name, agent.version].filter(Boolean).join(' ') || undefined
}

function extractActions(manifest: Manifest): C2paActionSummary[] {
  const actionAssertions = manifest.assertions?.filter((assertion: ManifestAssertion) =>
    assertion.label.toLowerCase().includes('actions'),
  )

  return (
    actionAssertions?.flatMap((assertion) => {
      const data = assertion.data as { actions?: Action[] } | Action[] | undefined
      const actions = Array.isArray(data) ? data : data?.actions

      return (
        actions?.map((action) => ({
          action: action.action,
          when: action.when ?? undefined,
          softwareAgent: softwareAgentName(action.softwareAgent),
          digitalSourceType: action.digitalSourceType ?? undefined,
        })) ?? []
      )
    }) ?? []
  )
}

function validationErrors(statuses: ValidationStatus[] | null | undefined) {
  return (
    statuses?.map((status) =>
      [status.code, status.url, status.explanation].filter(Boolean).join(': '),
    ) ?? []
  )
}

export async function verifyC2paInBrowser(
  bytes: ArrayBuffer,
  fileType: string,
): Promise<C2paVerificationResult> {
  const sampleFallback = () => sniffC2paBytes(decodeTextSample(bytes), fileType)

  if (!isSupportedReaderFormat(fileType)) {
    return emptyC2paResult('unsupported', 'c2pa-web', [
      String(fileType || 'unknown') + ' is not supported by @contentauth/c2pa-web.',
    ])
  }

  if (!globalThis.WebAssembly || typeof Blob === 'undefined') {
    const sniffed = sampleFallback()
    return {
      ...sniffed,
      state: sniffed.state === 'found' ? 'found' : 'unsupported',
      errors: ['WebAssembly or Blob support is unavailable in this browser runtime.'],
    }
  }

  let reader: Awaited<ReturnType<C2paSdk['reader']['fromBlob']>> | undefined

  try {
    const sdk = await c2paSdk()
    reader = await sdk.reader.fromBlob(fileType, new Blob([bytes], { type: fileType }))

    if (!reader) return emptyC2paResult('not-found', 'c2pa-web')

    const [store, manifest] = await Promise.all([reader.manifestStore(), reader.activeManifest()])
    const validationState = store.validation_state
    const errors = validationErrors(store.validation_status)
    const signatureInfo = manifest.signature_info ?? undefined
    const issuer = signatureInfo?.issuer ?? signatureInfo?.common_name ?? undefined
    const state =
      validationState === 'Valid' || validationState === 'Trusted'
        ? 'valid'
        : validationState === 'Invalid'
          ? 'invalid'
          : 'found'

    return {
      state,
      issuer,
      claimGenerator: manifest.claim_generator ?? undefined,
      actions: extractActions(manifest),
      errors,
      source: 'c2pa-web',
    }
  } catch (error) {
    const sniffed = sampleFallback()
    const message = error instanceof Error ? error.message : String(error)

    return {
      ...sniffed,
      state: sniffed.state === 'found' ? 'found' : 'unsupported',
      source: 'c2pa-web',
      errors: ['@contentauth/c2pa-web verification failed: ' + message],
    }
  } finally {
    await reader?.free()
  }
}
