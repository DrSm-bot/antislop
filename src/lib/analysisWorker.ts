import { analyzeBytes, type AnalysisInput } from '../core/analysis'

type AnalyzeRequest = {
  id: number
  input: AnalysisInput
}

type AnalyzeResponse =
  | {
      id: number
      report: Awaited<ReturnType<typeof analyzeBytes>>
    }
  | {
      id: number
      error: string
    }

self.addEventListener('message', (event: MessageEvent<AnalyzeRequest>) => {
  const { id, input } = event.data

  void analyzeBytes(input)
    .then((report) => {
      self.postMessage({ id, report } satisfies AnalyzeResponse)
    })
    .catch((error: unknown) => {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies AnalyzeResponse)
    })
})
