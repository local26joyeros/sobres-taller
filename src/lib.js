import { createClient } from '@supabase/supabase-js'

// La clave publicable es pública por diseño; los datos se protegen con RLS (solo usuarios con sesión).
const url = import.meta.env.VITE_SUPABASE_URL || 'https://dmjowmlkumgxtvnlvund.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_vGk-ppaqgAnjhjd9msUNjQ_Efv0UjT5'

export const sb = createClient(url, key)

export const ESTADOS = {
  presupuesto: 'Presupuesto',
  esperando_confirmacion: 'Pendiente',
  rechazado: 'Rechazado – para devolver',
  taller: 'En taller',
  listo_para_facturar: 'Listo para facturar',
  facturado: 'Facturado',
  entregado: 'Entregado',
}

export const TIPOS = {
  presupuesto: 'Presupuesto',
  taller: 'Taller',
  trabajo_nuevo: 'Trabajo nuevo',
}

export const METALES = { oro: 'Oro', plata: 'Plata', platino: 'Platino' }
export const MONEDAS = { ARS: 'Pesos', USD: 'Dólares' }

const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf3 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })

export const plata = (v) => (v === null || v === undefined || v === '' ? '—' : nf2.format(Number(v)))
export const gramos = (v) => (v === null || v === undefined || v === '' ? '—' : nf3.format(Number(v)) + ' g')
export const hechura = (v, m) =>
  v === null || v === undefined ? '—' : (m === 'USD' ? 'US$ ' : '$ ') + nf2.format(Number(v))

export const fecha = (v) =>
  v
    ? new Date(v).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—'

export const fechaCorta = (v) => (v ? new Date(v).toLocaleDateString('es-AR') : '—')

// Acepta "3,25" o "3.25"
export const num = (s) => {
  if (s === null || s === undefined || String(s).trim() === '') return null
  let t = String(s).trim().replace(/\s/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

export const fino = (metal, peso) => {
  const p = num(peso)
  if (p === null || Number.isNaN(p)) return null
  return metal === 'oro' ? Math.round(p * 0.825 * 1000) / 1000 : p
}

export const errorMsg = (e) => {
  const m = e?.message || String(e)
  if (m.includes('duplicate key') && m.includes('nro_sobre')) return 'Ya existe un sobre con ese número.'
  if (m.includes('duplicate key') && m.includes('clientes')) return 'Ya existe un cliente con ese nombre.'
  if (m.includes('duplicate key') && m.includes('talleristas')) return 'Ya existe un tallerista con ese nombre.'
  if (m.includes('Invalid login')) return 'Usuario o contraseña incorrectos.'
  return m
}

export function ir(pagina, params = {}) {
  const q = new URLSearchParams(params).toString()
  window.location.hash = '/' + pagina + (q ? '?' + q : '')
}

export async function cargarListas() {
  const [c, t] = await Promise.all([
    sb.from('clientes').select('id,nombre').order('nombre'),
    sb.from('talleristas').select('id,nombre,activo').order('nombre'),
  ])
  return { clientes: c.data || [], talleristas: t.data || [] }
}

// "En taller (Alejandro)"
export const estadoTexto = (t) =>
  t.estado === 'taller' && t.tallerista ? `En taller (${t.tallerista})` : ESTADOS[t.estado]

export const etiquetaPeso = (metal) =>
  metal === 'oro' ? 'Peso oro 18k (g)' : metal === 'plata' ? 'Peso plata fina (g)' : 'Peso platino fino (g)'

export const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)

// Devuelve el id del tallerista con ese nombre; si no existe, lo crea.
export async function resolverTallerista(nombre, talleristas) {
  const n = (nombre || '').trim()
  if (!n) return null
  const t = talleristas.find((x) => x.nombre.toLowerCase() === n.toLowerCase())
  if (t) return t.id
  const { data, error } = await sb.from('talleristas').insert({ nombre: n }).select('id').single()
  if (error) throw error
  return data.id
}

export async function fotoUrl(path) {
  if (!path) return null
  const { data } = await sb.storage.from('fotos').createSignedUrl(path, 3600)
  return data?.signedUrl || null
}
