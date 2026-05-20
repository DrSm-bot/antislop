import { analyzeBytes, type AssetReport } from '../core/analysis'

const formatter = new Intl.NumberFormat('en')

export async function imageDimensions(file: File) {
  const url = URL.createObjectURL(file)

  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return `${formatter.format(image.naturalWidth)} x ${formatter.format(image.naturalHeight)}`
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function analyzeImageFile(file: File): Promise<AssetReport> {
  const bytes = await file.arrayBuffer()
  const previewUrl = URL.createObjectURL(file)

  return analyzeBytes({
    bytes,
    fileName: file.name,
    fileType: file.type || 'unknown',
    fileSize: file.size,
    dimensions: file.type.startsWith('image/') ? await imageDimensions(file) : 'not an image',
    previewUrl,
  })
}
