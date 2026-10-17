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

async function subir(trabajoId, file) {
  const blob = await comprimir(file)
  const path = `${trabajoId}/${Date.now()}.jpg`
  const { error } = await sb.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

// Foto principal del sobre (la reemplaza si ya había una)
export async function subirFoto(trabajoId, file) {
  const path = await subir(trabajoId, file)
  const { error } = await sb.from('trabajos').update({ foto_path: path }).eq('id', trabajoId)
  if (error) throw error
  return path
}

// Foto adicional (no reemplaza ninguna)
export async function agregarFoto(trabajoId, file) {
  const path = await subir(trabajoId, file)
  const { error } = await sb.from('trabajo_fotos').insert({ trabajo_id: trabajoId, path })
  if (error) throw error
  return path
}
