import type { GenerationModel } from './generation-state'
import { addUploads, uploadRef, type UploadedImage } from './uploads'

export type AddImageResult = { added: UploadedImage[]; errors: string[] }

// Store the files, select the first one and reload. Load notices cross that
// reload when at least one image was added; failures are returned to the caller.
export async function addImageFiles(files: File[], model: GenerationModel): Promise<AddImageResult> {
  const result = await addUploads(files)
  const first = result.added[0]
  if (!first) return result
  model.setField('image', uploadRef(first.id))
  model.commit()
  return result
}
