import { useEffect, useState, useCallback } from 'react'
import { sb, TIPOS, METALES, cargarListas, errorMsg, fecha, fechaCorta, hechura, gramos, num, fotoUrl, ir, estadoTexto, resolverTallerista, hoyAR, etiquetaPeso } from '../lib'
import { subirFoto } from '../foto'
import { CampoTallerista, CamposPresupuesto } from '../components'

const PESTANAS = [
  ['pendientes', 'Pendientes', ['presupuesto', 'esperando_confirmacion']],
  ['taller', 'En taller', ['taller']],
  ['listos', 'Listos para facturar', ['listo_para_facturar']],
  ['entregar', 'Para entregar', ['facturado', 'rechazado']],
  ['entregados', 'Entregados', ['entregado']],
  ['todos', 'Todos', null],
]

export default function Sobres({ params }) {
  const tab = PESTANAS.find((p) => p[0] === params.get('tab')) || PESTANAS[0]
  const [trabajos, setTrabajos] = useState([])
  const [conteo, setConteo] = useState({})
  const [listas, setListas] = useState({ clientes: [], talleristas: [] })
  const [buscar, setBuscar] = useState('')
  const [filtroTall, setFiltroTall] = useState('')
  const [detalle, setDetalle] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    let q = sb.from('vista_trabajos').select('*').order('ingresado_en', { ascending: false })
    if (tab[2]) q = q.in('estado', tab[2])
    if (tab[0] === 'entregados' || tab[0] === 'todos') q = q.limit(300)
    const [{ data, error }, { data: est }] = await Promise.all([
      q, sb.from('trabajos').select('estado').neq('estado', 'entregado'),
    ])
    if (error) setError(errorMsg(error))
    setTrabajos(data || [])
    const c = {}
    ;(est || []).forEach((r) => { c[r.estado] = (c[r.estado] || 0) + 1 })
    setConteo(c)
    setCargando(false)
  }, [tab[0]]) // eslint-disable-line react-hooks/exhaustive-deps

  const recargarListas = () => cargarListas().then(setListas)
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { recargarListas() }, [])

  async function accion(fn) {
    setError('')
    try { await fn(); await cargar(); recargarListas() } catch (e) { setError(errorMsg(e)) }
  }

  const b = buscar.trim().toLowerCase()
  const visibles = trabajos.filter((t) =>
    (!b || t.nro_sobre.toLowerCase().includes(b) || t.cliente.toLowerCase().includes(b) || (t.descripcion || '').toLowerCase().includes(b)) &&
    (!filtroTall || String(t.tallerista_id) === filtroTall || (filtroTall === 'sin' && !t.tallerista_id)))

  const cuenta = (estados) => (estados ? estados.reduce((s, e) => s + (conteo[e] || 0), 0) : null)

  return (
    <section>
      <h1>Sobres</h1>
      <div className="pestanas">
        {PESTANAS.map(([k, t, est]) => {
          const n = k === 'entregados' || k === 'todos' ? null : cuenta(est)
          return (
            <a key={k} href={'#/sobres?tab=' + k} className={tab[0] === k ? 'activo' : ''}>
              {t}{n ? <span className="contador">{n}</span> : null}
            </a>
          )
        })}
      </div>
      <div className="filtros">
        <input placeholder="Buscar por sobre, cliente o descripción" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        {(tab[0] === 'taller' || tab[0] === 'todos') && (
          <select value={filtroTall} onChange={(e) => setFiltroTall(e.target.value)}>
            <option value="">Todos los talleristas</option>
            <option value="sin">Sin tallerista</option>
            {listas.talleristas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        )}
      </div>
      {tab[0] === 'listos' && visibles.length > 0 && (
        <div className="aviso">Estos sobres se facturan juntos en la pantalla <a href="#/facturacion">Facturación</a>.</div>
      )}
      {error && <div className="error">{error}</div>}
      {cargando ? <div className="vacio">Cargando…</div> : visibles.length === 0 ? <div className="vacio">No hay sobres acá.</div> : (
        <div className="lista">
          {visibles.map((t) => (
            <Tarjeta key={t.id} t={t} talleristas={listas.talleristas} accion={accion} abrir={() => setDetalle(t)} />
          ))}
        </div>
      )}
      {detalle && <Detalle t={detalle} cerrar={() => setDetalle(null)} recargar={cargar} />}
    </section>
  )
}

function Tarjeta({ t, talleristas, accion, abrir }) {
  const [traspaso, setTraspaso] = useState(null) // { nombre, fecha }

  const upd = async (campos) => {
    const { error } = await sb.from('trabajos').update(campos).eq('id', t.id)
    if (error) throw error
  }

  const responder = (aceptado) => accion(async () => {
    const { error } = await sb.rpc('responder_presupuesto', { p_trabajo: t.id, p_aceptado: aceptado })
    if (error) throw error
  })

  const pasar = () => accion(async () => {
    const id = await resolverTallerista(traspaso.nombre, talleristas)
    if (!id) throw new Error('Escribí el nombre del tallerista.')
    const { error } = await sb.rpc('asignar_tallerista', { p_trabajo: t.id, p_tallerista: id, p_fecha: traspaso.fecha || null })
    if (error) throw error
    setTraspaso(null)
  })

  return (
    <div className={'card sobre est-' + t.estado}>
      <div className="sobre-cab" onClick={abrir} role="button">
        <div>
          <div className="nro">Sobre {t.nro_sobre}</div>
          <div className="cliente">{t.cliente}</div>
        </div>
        <span className={'chip est-' + t.estado}>{estadoTexto(t)}</span>
      </div>
      <div className="sobre-cuerpo" onClick={abrir} role="button">
        <div className="meta">{TIPOS[t.tipo]} · Ingresó {fecha(t.ingresado_en)}{t.estado !== 'taller' && t.tallerista ? ' · ' + t.tallerista : ''}</div>
        {t.descripcion && <div className="desc">{t.descripcion}</div>}
        {t.presupuesto_hechura != null && (
          <div className="meta">Presupuesto: {hechura(t.presupuesto_hechura, t.presupuesto_moneda)} · {METALES[t.presupuesto_metal] || '—'}
            {t.presupuesto_peso != null ? ' ' + gramos(t.presupuesto_peso) : ''}
            {t.presupuesto_respuesta ? ' · ' + (t.presupuesto_respuesta === 'aceptado' ? 'Aceptado' : 'Rechazado') : ''}</div>
        )}
        {t.estado === 'facturado' && (
          <div className="meta">Facturado {fecha(t.facturado_en)} · {hechura(t.hechura, t.hechura_moneda)} · {METALES[t.metal] || ''} {t.peso_fino != null ? gramos(t.peso_fino) + ' fino' : ''}</div>
        )}
        {t.foto_path && <div className="meta">📷 Tiene foto</div>}
      </div>

      <div className="acciones">
        {t.estado === 'esperando_confirmacion' && (
          <>
            <button className="btn ok" onClick={() => responder(true)}>Aceptado</button>
            <button className="btn peligro" onClick={() => window.confirm(`¿Marcar el presupuesto del sobre ${t.nro_sobre} como rechazado? Pasa a Listo para facturar.`) && responder(false)}>Rechazado</button>
          </>
        )}
        {t.estado === 'taller' && !traspaso && (
          <>
            <button className="btn primario" onClick={() => accion(() => upd({ estado: 'listo_para_facturar' }))}>Listo para facturar</button>
            <button className="btn" onClick={() => setTraspaso({ nombre: '', fecha: hoyAR() })}>{t.tallerista ? 'Cambiar de taller' : 'Asignar tallerista'}</button>
          </>
        )}
        {t.estado === 'taller' && traspaso && (
          <div className="mini-form">
            <CampoTallerista id={'tall-' + t.id} valor={traspaso.nombre} onChange={(v) => setTraspaso({ ...traspaso, nombre: v })} talleristas={talleristas} placeholder="Nuevo tallerista" />
            <input type="date" value={traspaso.fecha} onChange={(e) => setTraspaso({ ...traspaso, fecha: e.target.value })} />
            <button className="btn primario" onClick={pasar}>Pasar</button>
            <button className="btn suave" onClick={() => setTraspaso(null)}>Cancelar</button>
          </div>
        )}
        {t.estado === 'listo_para_facturar' && (
          <>
            <button className="btn primario" onClick={() => ir('facturacion')}>Ir a facturación</button>
            {t.presupuesto_respuesta !== 'rechazado' && <button className="btn suave" onClick={() => accion(() => upd({ estado: 'taller' }))}>Volver a taller</button>}
          </>
        )}
        {(t.estado === 'facturado' || t.estado === 'rechazado') && (
          <button className="btn primario" onClick={() => window.confirm(`¿Confirmás que entregaste el sobre ${t.nro_sobre}?`) && accion(() => upd({ estado: 'entregado' }))}>Entregado</button>
        )}
      </div>
    </div>
  )
}

const aTexto = (v) => (v == null ? '' : String(v).replace('.', ','))

function Detalle({ t, cerrar, recargar }) {
  const [url, setUrl] = useState(null)
  const [hist, setHist] = useState([])
  const [talleres, setTalleres] = useState([])
  const [desc, setDesc] = useState(t.descripcion || '')
  const [pres, setPres] = useState({ hechura: aTexto(t.presupuesto_hechura), moneda: t.presupuesto_moneda || 'ARS', metal: t.presupuesto_metal || 'oro', peso: aTexto(t.presupuesto_peso) })
  const [msg, setMsg] = useState('')
  const [subiendo, setSubiendo] = useState(false)

  useEffect(() => {
    fotoUrl(t.foto_path).then(setUrl)
    sb.from('historial_estados').select('*').eq('trabajo_id', t.id).order('cambiado_en').then(({ data }) => setHist(data || []))
    sb.from('traspasos_taller').select('id,fecha,talleristas(nombre)').eq('trabajo_id', t.id).order('fecha').order('id').then(({ data }) => setTalleres(data || []))
  }, [t.id, t.foto_path])

  async function guardarDesc() {
    const { error } = await sb.from('trabajos').update({ descripcion: desc.trim() || null }).eq('id', t.id)
    setMsg(error ? errorMsg(error) : 'Descripción guardada.')
    recargar()
  }

  async function guardarPres() {
    const h = num(pres.hechura), p = num(pres.peso)
    if (h === null || Number.isNaN(h) || Number.isNaN(p)) return setMsg('Revisá la hechura y el peso.')
    const { error } = await sb.from('trabajos').update({ presupuesto_hechura: h, presupuesto_moneda: pres.moneda, presupuesto_metal: pres.metal, presupuesto_peso: p }).eq('id', t.id)
    setMsg(error ? errorMsg(error) : 'Presupuesto actualizado.')
    recargar()
  }

  async function nuevaFoto(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setSubiendo(true)
    try {
      const p = await subirFoto(t.id, f)
      setUrl(await fotoUrl(p))
      setMsg('Foto actualizada.')
      recargar()
    } catch (er) { setMsg(errorMsg(er)) }
    setSubiendo(false)
  }

  // Estado con el nombre del tallerista al pasar a taller
  const ESTADO_H = { presupuesto: 'Presupuesto', esperando_confirmacion: 'Pendiente', rechazado: 'Rechazado', taller: 'En taller', listo_para_facturar: 'Listo para facturar', facturado: 'Facturado', entregado: 'Entregado' }

  return (
    <div className="modal-fondo" onClick={cerrar}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
        <h2>Sobre {t.nro_sobre}</h2>
        <div className="meta"><a href={'#/clientes?id=' + t.cliente_id}>{t.cliente}</a> · {TIPOS[t.tipo]} · <span className={'chip est-' + t.estado}>{estadoTexto(t)}</span></div>
        {url ? <img src={url} className="foto-grande" alt={'Sobre ' + t.nro_sobre} /> : <div className="sin-foto">Sin foto</div>}
        <label className="btn suave archivo">{subiendo ? 'Subiendo…' : url ? 'Cambiar foto' : 'Agregar foto'}
          <input type="file" accept="image/*" capture="environment" onChange={nuevaFoto} hidden />
        </label>
        <label>Descripción
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <button className="btn" onClick={guardarDesc}>Guardar descripción</button>

        {t.estado === 'esperando_confirmacion' && (
          <>
            <h3>Presupuesto</h3>
            <CamposPresupuesto v={pres} set={setPres} />
            <button className="btn" onClick={guardarPres}>Guardar presupuesto</button>
          </>
        )}
        {msg && <div className="ok">{msg}</div>}

        {talleres.length > 0 && (
          <>
            <h3>Talleres</h3>
            <table className="tabla compacta">
              <tbody>
                {talleres.map((x, i) => (
                  <tr key={x.id}><td>{fechaCorta(x.fecha + 'T12:00')}</td><td>{i === 0 ? 'Entró a ' : 'Pasó a '}<b>{x.talleristas?.nombre}</b></td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3>Historial</h3>
        <table className="tabla compacta">
          <tbody>
            {hist.map((h) => (
              <tr key={h.id}><td>{fecha(h.cambiado_en)}</td><td>{ESTADO_H[h.estado_nuevo]}</td></tr>
            ))}
          </tbody>
        </table>
        {t.metal && t.peso != null && <div className="meta">{etiquetaPeso(t.metal)}: {gramos(t.peso)}</div>}
      </div>
    </div>
  )
}
