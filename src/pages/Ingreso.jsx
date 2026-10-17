import { useEffect, useState } from 'react'
import { sb, TIPOS, cargarListas, errorMsg, ir, num, resolverTallerista } from '../lib'
import { subirFotoItem } from '../foto'
import { CampoTallerista, CamposPresupuesto } from '../components'

let claveItem = 0
const itemVacio = () => ({ clave: ++claveItem, descripcion: '', tallerista: '', foto: null, preview: null, pres: { hechura: '', moneda: 'ARS', metal: 'oro', peso: '' } })

export default function Ingreso() {
  const [listas, setListas] = useState({ clientes: [], talleristas: [] })
  const [sobre, setSobre] = useState('')
  const [cliente, setCliente] = useState('')
  const [tipo, setTipo] = useState('taller')
  const [items, setItems] = useState([itemVacio()])
  const [msg, setMsg] = useState(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargarListas().then(setListas) }, [])

  const cambiarItem = (clave, campos) => setItems((xs) => xs.map((x) => (x.clave === clave ? { ...x, ...campos } : x)))
  const quitarItem = (clave) => setItems((xs) => xs.filter((x) => x.clave !== clave))

  function elegirFoto(clave, e) {
    const f = e.target.files?.[0]
    cambiarItem(clave, { foto: f || null, preview: f ? URL.createObjectURL(f) : null })
  }

  async function guardar(e) {
    e.preventDefault()
    setMsg(null)
    const nombre = cliente.trim()
    if (!nombre) return setMsg({ error: 'Elegí o escribí el cliente.' })

    // Validar presupuestos de cada ítem
    const datos = []
    for (const [i, it] of items.entries()) {
      const d = { descripcion: it.descripcion.trim() }
      if (tipo === 'presupuesto') {
        const h = num(it.pres.hechura), p = num(it.pres.peso)
        if (h === null || Number.isNaN(h)) return setMsg({ error: `Cargá la hechura del ítem ${i + 1}.` })
        if (Number.isNaN(p)) return setMsg({ error: `El peso del ítem ${i + 1} no es un número válido.` })
        Object.assign(d, { presupuesto_hechura: h, presupuesto_moneda: it.pres.moneda, presupuesto_metal: it.pres.metal, presupuesto_peso: p })
      }
      datos.push(d)
    }

    setGuardando(true)
    try {
      let c = listas.clientes.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase())
      if (!c) {
        if (!window.confirm(`"${nombre}" no está registrado. ¿Lo agrego como cliente nuevo?`)) { setGuardando(false); return }
        const { data, error } = await sb.from('clientes').insert({ nombre }).select('id,nombre').single()
        if (error) throw error
        c = data
      }
      // Talleristas (se crean si son nuevos)
      let talls = listas.talleristas
      for (const [i, it] of items.entries()) {
        const id = await resolverTallerista(it.tallerista, talls)
        if (id && !talls.some((x) => x.id === id)) talls = [...talls, { id, nombre: it.tallerista.trim(), activo: true }]
        datos[i].tallerista_id = id
      }
      const { data: r, error } = await sb.rpc('crear_sobre', { p: { nro_sobre: sobre.trim(), cliente_id: c.id, tipo, items: datos } })
      if (error) throw error

      // Fotos de cada ítem
      const fallas = []
      for (const [i, it] of items.entries()) {
        if (!it.foto) continue
        try { await subirFotoItem({ id: r.items[i], trabajo_id: r.trabajo_id }, it.foto) } catch { fallas.push(i + 1) }
      }
      setMsg(fallas.length
        ? { error: `El sobre ${sobre.trim()} se guardó, pero no se pudo subir la foto del ítem ${fallas.join(', ')}.` }
        : { ok: `Sobre ${sobre.trim()} ingresado para ${c.nombre}${items.length > 1 ? ` con ${items.length} ítems` : ''}.` })
      setSobre(''); setCliente(''); setItems([itemVacio()])
      cargarListas().then(setListas)
    } catch (e) {
      setMsg({ error: errorMsg(e) })
    }
    setGuardando(false)
  }

  return (
    <section>
      <h1>Nuevo ingreso</h1>
      <form className="card form" onSubmit={guardar}>
        <div className="fila2">
          <label>Número de sobre
            <input value={sobre} onChange={(e) => setSobre(e.target.value)} required inputMode="numeric" autoFocus />
          </label>
          <label>Cliente
            <input list="lista-clientes" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Escribí para buscar o agregar" required />
            <datalist id="lista-clientes">
              {listas.clientes.map((c) => <option key={c.id} value={c.nombre} />)}
            </datalist>
          </label>
        </div>

        <fieldset>
          <legend>Tipo de ingreso</legend>
          <div className="opciones">
            {Object.entries(TIPOS).map(([k, t]) => (
              <label key={k} className={'opcion' + (tipo === k ? ' sel' : '')}>
                <input type="radio" name="tipo" value={k} checked={tipo === k} onChange={() => setTipo(k)} />
                {t}
              </label>
            ))}
          </div>
          {tipo === 'presupuesto' && <p className="ayuda">Cada ítem queda Pendiente hasta que el cliente acepte o rechace su presupuesto.</p>}
          {tipo === 'trabajo_nuevo' && <p className="ayuda">Pieza nueva que hay que fabricar para el cliente.</p>}
        </fieldset>

        <div className="items-ingreso">
          {items.map((it, i) => (
            <div key={it.clave} className="item-ingreso">
              <div className="item-cab">
                <b>Ítem {i + 1}</b>
                {items.length > 1 && <button type="button" className="btn-link" onClick={() => quitarItem(it.clave)} aria-label={'Quitar ítem ' + (i + 1)}>Quitar</button>}
              </div>
              <label>Descripción del trabajo
                <textarea rows={2} value={it.descripcion} onChange={(e) => cambiarItem(it.clave, { descripcion: e.target.value })} placeholder="Ej.: anillo, soldar" />
              </label>
              {tipo === 'presupuesto' && <CamposPresupuesto v={it.pres} set={(pres) => cambiarItem(it.clave, { pres })} />}
              <div className="fila2">
                <label>Tallerista
                  <CampoTallerista id={'tall-ing-' + it.clave} valor={it.tallerista} onChange={(v) => cambiarItem(it.clave, { tallerista: v })} talleristas={listas.talleristas} placeholder="Quién va a hacer el trabajo" />
                </label>
                <label>Foto
                  <input type="file" accept="image/*" capture="environment" onChange={(e) => elegirFoto(it.clave, e)} />
                </label>
              </div>
              {it.preview && <img src={it.preview} className="foto-prev" alt={'Ítem ' + (i + 1)} />}
            </div>
          ))}
          <button type="button" className="btn agregar-item" onClick={() => setItems([...items, itemVacio()])}>+ Agregar otro ítem</button>
        </div>

        {msg?.error && <div className="error">{msg.error}</div>}
        {msg?.ok && <div className="ok">{msg.ok} <a href="#/sobres" onClick={(e) => { e.preventDefault(); ir('sobres') }}>Ver sobres</a></div>}

        <button className="btn primario" disabled={guardando}>{guardando ? 'Guardando…' : 'Ingresar sobre'}</button>
      </form>
    </section>
  )
}
