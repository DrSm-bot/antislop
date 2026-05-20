import { analyzeBytes, type AnalysisInput, type AssetReport } from '../core/analysis'

type WorkerResponse =
  | {
      id: number
      report: AssetReport
    }
  | {
      id: number
      error: string
    }

type PendingAnalysis = {
  resolve: (report: AssetReport) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let nextRequestId = 1
const pending = new Map<number, PendingAnalysis>()

function getWorker() {
  if (typeof Worker === 'undefined') return undefined

  worker ??= new Worker(new URL('./analysisWorker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const pendingAnalysis = pending.get(event.data.id)
    if (!pendingAnalysis) return

    pending.delete(event.data.id)

    if ('report' in event.data) {
      pendingAnalysis.resolve(event.data.report)
      return
    }

    pendingAnalysis.reject(new Error(event.data.error))
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Analysis worker failed.')
    pending.forEach(({ reject }) => reject(error))
    pending.clear()
    worker?.terminate()
    worker = undefined
  })

  return worker
}

export function analyzeBytesOffMainThread(input: AnalysisInput): Promise<AssetReport> {
  const analysisWorker = getWorker()
  if (!analysisWorker) return analyzeBytes(input)

  const id = nextRequestId++

  return new Promise<AssetReport>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    analysisWorker.postMessage({ id, input }, [input.bytes])
  })
}
