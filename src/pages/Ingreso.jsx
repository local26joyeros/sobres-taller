import { useEffect, useRef, useState } from 'react'
import { sb, TIPOS, cargarListas, errorMsg, ir, num, resolverTallerista } from '../lib'
import { subirFoto, agregarFoto, subirFotoItem } from '../foto'
import { CampoTallerista, CamposPresupuesto } from '../components'

let clave = 0
const nuevaClave = () => ++clave
const itemVacio = () => ({ clave: nuevaClave(), nombre: '', descripcion: '', tallerista: '', foto: null, preview: null, pres: { hechura: '', moneda: 'ARS', metal: '', peso: '' } })

// Miniatura de una foto elegida, con una ✕ para sacarla
function FotoElegida({ src, quitar, alt }) {
  return (
    <div className="foto-elegida">
      <img src={src} alt={alt} />
      <button type="button" className="quitar-foto" onClick={quitar} aria-label="Quitar foto">×</button>
    </div>
  )
}

export default function Ingreso() {
  const [listas, setListas] = useState({ clientes: [], talleristas: [] })
  const [sobre, setSobre] = useState('')
  const [cliente, setCliente] = useState('')
  const [tipo, setTipo] = useState('taller')
  const [items, setItems] = useState([itemVacio()])
  const [fotosSobre, setFotosSobre] = useState([]) // [{ clave, file, preview }] — una foto puede mostrar todos los ítems
  const [msg, setMsg] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [faltan, setFaltan] = useState(null) // campos sin completar, para marcarlos
  const [preguntaFoto, setPreguntaFoto] = useState(false)
  const inputSobre = useRef()

  useEffect(() => { cargarListas().then(setListas) }, [])

  const cambiarItem = (k, campos) => setItems((xs) => xs.map((x) => (x.clave === k ? { ...x, ...campos } : x)))
  const quitarItem = (k) => setItems((xs) => xs.filter((x) => x.clave !== k))

  function elegirFotoItem(k, e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) cambiarItem(k, { foto: f, preview: URL.createObjectURL(f) })
  }
  function agregarFotosSobre(e) {
    const fs = [...(e.target.files || [])]
    e.target.value = ''
    if (fs.length) setFotosSobre((xs) => [...xs, ...fs.map((f) => ({ clave: nuevaClave(), file: f, preview: URL.createObjectURL(f) }))])
  }

  const totalFotos = fotosSobre.length + items.filter((it) => it.foto).length

  // Todos los campos son obligatorios (las fotos pueden ser del sobre o de cada ítem)
  function revisar() {
    const f = new Set()
    if (!sobre.trim()) f.add('sobre')
    if (!cliente.trim()) f.add('cliente')
    if (!totalFotos) f.add('fotos')
    items.forEach((it) => {
      if (!it.nombre.trim()) f.add(it.clave + '-nombre')
      if (!it.descripcion.trim()) f.add(it.clave + '-descripcion')
      if (!it.tallerista.trim()) f.add(it.clave + '-tallerista')
      if (tipo === 'presupuesto') {
        if (Number.isNaN(num(it.pres.hechura))) f.add(it.clave + '-hechura')
        if (Number.isNaN(num(it.pres.peso))) f.add(it.clave + '-peso')
      }
    })
    return f
  }
  const falta = (k) => (faltan?.has(k) ? ' falta' : '')

  async function intentar(e) {
    e.preventDefault()
    setMsg(null)
    const f = revisar()
    setFaltan(f)
    if (f.size) return setMsg({ error: f.has('fotos') && f.size === 1 ? 'Falta la foto del sobre.' : 'Faltan completar los campos marcados en rojo.' })
    // Presupuesto con una sola foto: preguntar si va así o se agrega otra
    if (tipo === 'presupuesto' && totalFotos === 1) return setPreguntaFoto(true)
    guardar()
  }

  async function guardar() {
    setPreguntaFoto(false)
    const nombre = cliente.trim()
    const datos = []
    for (const [i, it] of items.entries()) {
      const d = { nombre: it.nombre.trim(), descripcion: it.descripcion.trim() }
      if (tipo === 'presupuesto') {
        const h = num(it.pres.hechura), p = it.pres.metal ? num(it.pres.peso) : null
        if (Number.isNaN(h) || Number.isNaN(p)) return setMsg({ error: `Revisá la hechura y el peso del ítem ${i + 1}.` })
        Object.assign(d, { presupuesto_hechura: h, presupuesto_moneda: h === null ? null : it.pres.moneda, presupuesto_metal: it.pres.metal || null, presupuesto_peso: p })
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
      let talls = listas.talleristas
      for (const [i, it] of items.entries()) {
        const id = await resolverTallerista(it.tallerista, talls)
        if (id && !talls.some((x) => x.id === id)) talls = [...talls, { id, nombre: it.tallerista.trim(), activo: true }]
        datos[i].tallerista_id = id
      }
      const { data: r, error } = await sb.rpc('crear_sobre', { p: { nro_sobre: sobre.trim(), cliente_id: c.id, tipo, items: datos } })
      if (error) throw error

      // Fotos del sobre (la primera es la principal) y de cada ítem
      let fallas = 0
      for (const [i, fs] of fotosSobre.entries()) {
        try { await (i === 0 ? subirFoto(r.trabajo_id, fs.file) : agregarFoto(r.trabajo_id, fs.file)) } catch { fallas++ }
      }
      for (const [i, it] of items.entries()) {
        if (!it.foto) continue
        try { await subirFotoItem({ id: r.items[i], trabajo_id: r.trabajo_id }, it.foto) } catch { fallas++ }
      }
      if (fallas) {
        setMsg({ error: `El sobre ${sobre.trim()} se guardó, pero ${fallas === 1 ? 'una foto no se pudo subir' : fallas + ' fotos no se pudieron subir'}. Podés agregarlas abriendo el sobre.` })
        setGuardando(false)
        return
      }
      // Listo: volver a Sobres
      ir('sobres', { tab: 'todos' })
    } catch (e) {
      setMsg({ error: errorMsg(e) })
      setGuardando(false)
    }
  }

  return (
    <section>
      <h1>Nuevo ingreso</h1>
      <form className="card form" onSubmit={intentar} noValidate>
        <div className="fila2">
          <label>Número de sobre
            <input className={falta('sobre')} value={sobre} onChange={(e) => setSobre(e.target.value)} inputMode="numeric" autoFocus />
          </label>
          <label>Cliente
            <input className={falta('cliente')} list="lista-clientes" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Escribí para buscar o agregar" />
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

        <div className={'fotos-sobre' + (faltan?.has('fotos') ? ' falta' : '')}>
          <b>Fotos del sobre</b>
          <p className="ayuda">Una foto puede mostrar todos los ítems juntos. Si querés, también podés sacarle una foto a cada ítem más abajo.</p>
          <div className="fotos-elegidas">
            {fotosSobre.map((fs, i) => (
              <FotoElegida key={fs.clave} src={fs.preview} alt={'Foto ' + (i + 1)} quitar={() => setFotosSobre((xs) => xs.filter((x) => x.clave !== fs.clave))} />
            ))}
            <label className="agregar-foto">
              <span>+ {fotosSobre.length ? 'Agregar otra foto' : 'Agregar foto'}</span>
              <input ref={inputSobre} type="file" accept="image/*" capture="environment" onChange={agregarFotosSobre} hidden />
            </label>
          </div>
        </div>

        <div className="items-ingreso">
          {items.map((it, i) => (
            <div key={it.clave} className="item-ingreso">
              <div className="item-cab">
                <b>Ítem {i + 1}</b>
                {items.length > 1 && <button type="button" className="btn-link" onClick={() => quitarItem(it.clave)} aria-label={'Quitar ítem ' + (i + 1)}>Quitar</button>}
              </div>
              <label>Nombre del ítem
                <input className={falta(it.clave + '-nombre')} value={it.nombre} onChange={(e) => cambiarItem(it.clave, { nombre: e.target.value })} placeholder="Ej.: Anillo con piedra" />
              </label>
              <label>Descripción del trabajo
                <textarea className={falta(it.clave + '-descripcion')} rows={2} value={it.descripcion} onChange={(e) => cambiarItem(it.clave, { descripcion: e.target.value })} placeholder="Ej.: soldar el aro" />
              </label>
              {tipo === 'presupuesto' && (
                <div className={(falta(it.clave + '-hechura') ? ' falta-hechura' : '') + (falta(it.clave + '-peso') ? ' falta-peso' : '')}>
                  <CamposPresupuesto v={it.pres} set={(pres) => cambiarItem(it.clave, { pres })} />
                </div>
              )}
              <div className="fila2">
                <label className={falta(it.clave + '-tallerista')}>Tallerista
                  <CampoTallerista id={'tall-ing-' + it.clave} valor={it.tallerista} onChange={(v) => cambiarItem(it.clave, { tallerista: v })} talleristas={listas.talleristas} placeholder="Quién va a hacer el trabajo" />
                </label>
                <div className="foto-item">
                  <span className="etiqueta">Foto del ítem (opcional)</span>
                  {it.preview
                    ? <FotoElegida src={it.preview} alt={'Ítem ' + (i + 1)} quitar={() => cambiarItem(it.clave, { foto: null, preview: null })} />
                    : (
                      <label className="agregar-foto chica">
                        <span>+ Foto</span>
                        <input type="file" accept="image/*" capture="environment" onChange={(e) => elegirFotoItem(it.clave, e)} hidden />
                      </label>
                    )}
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="btn agregar-item" onClick={() => setItems([...items, itemVacio()])}>+ Agregar otro ítem</button>
        </div>

        {msg?.error && <div className="error">{msg.error}</div>}
        <button className="btn primario" disabled={guardando}>{guardando ? 'Guardando…' : 'Ingresar sobre'}</button>
      </form>

      {preguntaFoto && (
        <div className="modal-fondo centrado" onClick={() => setPreguntaFoto(false)}>
          <div className="modal card confirmar" onClick={(e) => e.stopPropagation()}>
            <p>¿Subís el presupuesto con una sola foto o querés agregar otra?</p>
            <div className="botones">
              <button className="btn primario" onClick={guardar}>Subir con una foto</button>
              <button className="btn suave" onClick={() => { setPreguntaFoto(false); inputSobre.current?.click() }}>Agregar otra foto</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
