import { sb } from './lib'

// Reduce la foto (máx. 1600 px, JPEG) antes de subirla, para que cargue rápido desde el celular.
async function comprimir(file) {
  try {
    const bmp = await createImageBitmap(file)
    const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * escala)
    c.height = Math.round(bmp.height * escala)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82))
  } catch {
    return file
  }
}

export async function subirFoto(trabajoId, file) {
  const blob = await comprimir(file)
  const path = `${trabajoId}/${Date.now()}.jpg`
  const { error } = await sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  const { error: e2 } = await sb.from('trabajos').update({ foto_path: path }).eq('id', trabajoId)
  if (e2) throw e2
  return path
}
