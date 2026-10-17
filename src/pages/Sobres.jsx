import { useEffect, useState, useCallback } from 'react'
import { sb, TIPOS, METALES, cargarListas, errorMsg, fecha, fechaCorta, hechura, gramos, num, fotoUrl, ir, estadoTexto, resolverTallerista, etiquetaPeso } from '../lib'
import { subirFoto, agregarFoto } from '../foto'
import { CamposPresupuesto } from '../components'

const PESTANAS = [
  ['todos', 'Todos', null],
  ['taller', 'En taller', ['taller']],
  ['pendientes', 'Pendientes', ['presupuesto', 'esperando_confirmacion']],
  ['listos', 'Listos para facturar', ['listo_para_facturar']],
  ['entregar', 'Para entregar', ['facturado', 'rechazado']],
  ['entregados', 'Entregados', ['entregado']],
  ['talleristas', 'Talleristas', ['taller']],
]

// Devuelve sobres de "Listo para facturar" a un taller (queda registrado con la fecha de hoy)
async function devolverATaller(ids, tallId) {
  for (const id of ids) {
    const { error } = await sb.from('trabajos').update({ estado: 'taller' }).eq('id', id)
    if (error) throw error
    const { error: e2 } = await sb.rpc('asignar_tallerista', { p_trabajo: id, p_tallerista: tallId })
    if (e2) throw e2
  }
}

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
  const [marcados, setMarcados] = useState([])

  const cargar = useCallback(async () => {
    setCargando(true)
    let q = sb.from('vista_trabajos').select('*').order('ingresado_en', { ascending: false })
    if (tab[2]) q = q.in('estado', tab[2])
    if (tab[0] === 'entregados' || tab[0] === 'todos') q = q.limit(300)
    const [{ data, error }, { data: est }] = await Promise.all([
      q, sb.from('trabajos').select('estado').neq('estado', 'entregado'),
    ])
    if (error) setError(errorMsg(error))
    // Recorrido de talleres de cada sobre
    const ids = (data || []).map((t) => t.id)
    const rec = {}
    if (ids.length) {
      const { data: tr } = await sb.from('traspasos_taller').select('id,trabajo_id,fecha,hasta,pago,pago_moneda,talleristas(nombre)').in('trabajo_id', ids).order('fecha').order('id')
      ;(tr || []).forEach((x) => { (rec[x.trabajo_id] ||= []).push(x) })
    }
    setTrabajos((data || []).map((t) => ({ ...t, talleres: rec[t.id] || [] })))
    const c = {}
    ;(est || []).forEach((r) => { c[r.estado] = (c[r.estado] || 0) + 1 })
    setConteo(c)
    setCargando(false)
  }, [tab[0]]) // eslint-disable-line react-hooks/exhaustive-deps

  const recargarListas = () => cargarListas().then(setListas)
  useEffect(() => { cargar(); setMarcados([]); setDetalle(null) }, [cargar])
  useEffect(() => { recargarListas() }, [])

  async function accion(fn) {
    setError('')
    try { await fn(); await cargar(); recargarListas() } catch (e) { setError(errorMsg(e)) }
  }

  // Ventana de confirmación con "Sí" / "No"
  const [confirmacion, setConfirmacion] = useState(null)
  const preguntar = (texto) => new Promise((resolve) => setConfirmacion({ texto, resolve }))
  const responderConf = (si) => { confirmacion.resolve(si); setConfirmacion(null) }

  // Cuánto se le pagó al tallerista
  const [pago, setPago] = useState(null)
  const preguntarPago = (texto) => new Promise((resolve) => setPago({ texto, resolve, monto: '', moneda: 'ARS', error: '' }))
  function responderPago(ok) {
    if (!ok) { pago.resolve(null); setPago(null); return }
    const m = num(pago.monto)
    if (m === null || Number.isNaN(m) || m < 0) return setPago({ ...pago, error: 'Escribí el monto (puede ser 0).' })
    pago.resolve({ monto: m, moneda: pago.moneda }); setPago(null)
  }

  // Lista para elegir a qué tallerista vuelve un sobre
  const [eleccion, setEleccion] = useState(null)
  const elegirTallerista = (texto) => new Promise((resolve) => setEleccion({ texto, resolve }))
  const responderElec = (t) => { eleccion.resolve(t); setEleccion(null) }

  const b = tab[0] === 'todos' ? buscar.trim().toLowerCase() : ''
  const visibles = trabajos.filter((t) =>
    (!b || t.nro_sobre.toLowerCase().includes(b) || t.cliente.toLowerCase().includes(b) || (t.descripcion || '').toLowerCase().includes(b)) &&
    (!filtroTall || String(t.tallerista_id) === filtroTall || (filtroTall === 'sin' && !t.tallerista_id)))

  const activos = listas.talleristas.filter((x) => x.activo)
  const marcar = (id, si) => setMarcados((m) => (si ? [...m, id] : m.filter((x) => x !== id)))

  async function facturarMarcados() {
    if (!(await preguntar(`¿Estás seguro de facturar ${marcados.length === 1 ? 'el sobre elegido' : `los ${marcados.length} sobres elegidos`}?`))) return
    ir('facturacion', { sobres: marcados.join(',') })
  }

  async function devolverMarcados() {
    const tall = await elegirTallerista(`¿A qué tallerista ${marcados.length === 1 ? 'vuelve el sobre elegido' : `vuelven los ${marcados.length} sobres elegidos`}?`)
    if (!tall) return
    if (!(await preguntar(`¿Estás seguro de devolver ${marcados.length === 1 ? 'el sobre elegido' : `los ${marcados.length} sobres elegidos`} al taller de ${tall.nombre}?`))) return
    accion(() => devolverATaller(marcados, tall.id))
  }

  const cuenta = (estados) => (estados ? estados.reduce((s, e) => s + (conteo[e] || 0), 0) : null)

  return (
    <section>
      <div className="pestanas">
        {PESTANAS.map(([k, t, est]) => {
          const n = k === 'entregados' || k === 'todos' || k === 'talleristas' ? null : cuenta(est)
          return (
            <a key={k} href={'#/sobres?tab=' + k} className={tab[0] === k ? 'activo' : ''}>
              {t}{n ? <span className="contador">{n}</span> : null}
            </a>
          )
        })}
      </div>
      <div className="filtros">
        {tab[0] === 'todos' && <input placeholder="Buscar por sobre, cliente o descripción" value={buscar} onChange={(e) => setBuscar(e.target.value)} />}
        {(tab[0] === 'taller' || tab[0] === 'todos') && (
          <select value={filtroTall} onChange={(e) => setFiltroTall(e.target.value)}>
            <option value="">Todos los talleristas</option>
            <option value="sin">Sin tallerista</option>
            {listas.talleristas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        )}
      </div>
      {tab[0] === 'listos' && visibles.length > 0 && (
        <div className="barra-lote card">
          <label className="todos-check">
            <input type="checkbox" checked={marcados.length === visibles.length} onChange={(e) => setMarcados(e.target.checked ? visibles.map((t) => t.id) : [])} />
            {marcados.length ? `${marcados.length} elegido${marcados.length > 1 ? 's' : ''}` : 'Elegir todos'}
          </label>
          <button className="btn ok" disabled={!marcados.length} onClick={facturarMarcados}>Facturar</button>
          <button className="btn" disabled={!marcados.length} onClick={devolverMarcados}>Devolver a taller</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {tab[0] === 'talleristas' ? (
        <ResumenTalleristas abrir={(id) => setDetalle(trabajos.find((t) => t.id === id) || null)} />
      ) : cargando ? <div className="vacio">Cargando…</div> : visibles.length === 0 ? <div className="vacio">No hay sobres acá.</div> : (
        <div className="lista">
          {visibles.map((t) => (
            <Tarjeta key={t.id} t={t} talleristas={listas.talleristas} accion={accion} preguntar={preguntar} preguntarPago={preguntarPago} abrir={() => setDetalle(t)}
              marcado={tab[0] === 'listos' ? marcados.includes(t.id) : null} marcar={(si) => marcar(t.id, si)} />
          ))}
        </div>
      )}
      {detalle && <Detalle t={detalle} cerrar={() => setDetalle(null)} recargar={cargar} preguntar={preguntar} elegirTallerista={elegirTallerista}
        accion={async (fn) => { await accion(fn); setDetalle(null) }} />}
      {pago && (
        <div className="modal-fondo centrado" onClick={() => responderPago(false)}>
          <form className="modal card confirmar" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); responderPago(true) }}>
            <p>{pago.texto}</p>
            <div className="con-moneda monto-pago">
              <input inputMode="decimal" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value, error: '' })} placeholder="Monto" autoFocus />
              <select value={pago.moneda} onChange={(e) => setPago({ ...pago, moneda: e.target.value })}>
                <option value="ARS">Pesos</option>
                <option value="USD">Dólares</option>
              </select>
            </div>
            {pago.error && <div className="error">{pago.error}</div>}
            <div className="botones">
              <button type="button" className="btn suave" onClick={() => responderPago(false)}>Cancelar</button>
              <button className="btn ok">Aceptar</button>
            </div>
          </form>
        </div>
      )}
      {eleccion && (
        <div className="modal-fondo centrado" onClick={() => responderElec(null)}>
          <div className="modal card confirmar" onClick={(e) => e.stopPropagation()}>
            <p>{eleccion.texto}</p>
            <div className="lista-talleristas">
              {activos.map((x) => <button key={x.id} className="btn" onClick={() => responderElec(x)}>{x.nombre}</button>)}
              {activos.length === 0 && <div className="meta">No hay talleristas cargados.</div>}
            </div>
            <button className="btn suave" onClick={() => responderElec(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {confirmacion && (
        <div className="modal-fondo centrado" onClick={() => responderConf(false)}>
          <div className="modal card confirmar" onClick={(e) => e.stopPropagation()}>
            <p>{confirmacion.texto}</p>
            <div className="botones">
              <button className="btn suave" onClick={() => responderConf(false)}>No</button>
              <button className="btn primario" onClick={() => responderConf(true)} autoFocus>Sí</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Recorrido({ t }) {
  const lista = t.talleres || []
  const enTaller = t.estado === 'taller'
  // En taller con un solo tallerista: el nombre ya está arriba
  if (!lista.length || (enTaller && lista.length === 1)) return null
  return (
    <div className="recorrido">
      {lista.map((x, i) => {
        const actual = enTaller && i === lista.length - 1
        return (
          <span key={x.id} className="paso-envoltura">
            {i > 0 && <span className="flecha">→</span>}
            <span className={'paso ' + (actual ? 'actual' : 'pasado')}>
              {x.talleristas?.nombre} <small>{x.fecha.slice(8, 10)}/{x.fecha.slice(5, 7)}</small>
            </span>
          </span>
        )
      })}
    </div>
  )
}

const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '')
const montoPago = (v, m) => (v == null ? '—' : hechura(v, m))

function ResumenTalleristas({ abrir }) {
  const [filas, setFilas] = useState(null)
  const [abierto, setAbierto] = useState({})

  useEffect(() => {
    sb.from('traspasos_taller')
      .select('id,fecha,hasta,pago,pago_moneda,tallerista_id,talleristas(nombre),trabajos(id,nro_sobre,descripcion,estado,clientes(nombre))')
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(1000)
      .then(({ data }) => setFilas(data || []))
  }, [])

  if (!filas) return <div className="vacio">Cargando…</div>
  if (!filas.length) return <div className="vacio">Todavía no hay sobres entregados a talleristas.</div>

  const grupos = {}
  filas.forEach((x) => { const n = x.talleristas?.nombre || '—'; (grupos[n] ||= []).push(x) })
  const nombres = Object.keys(grupos).sort((a, b) => a.localeCompare(b))

  return (
    <div className="resumen-talleristas">
      {nombres.map((n) => {
        const actuales = grupos[n].filter((x) => !x.hasta && x.trabajos?.estado === 'taller')
        const terminados = grupos[n].filter((x) => x.hasta)
        const total = (m) => terminados.filter((x) => x.pago != null && x.pago_moneda === m).reduce((s, x) => s + Number(x.pago), 0)
        const verTodos = abierto[n]
        return (
          <div key={n} className="card grupo-tallerista">
            <div className="grupo-cab"><b>{n}</b><span className="meta">{actuales.length} en su taller</span></div>

            {actuales.length > 0 && (
              <table className="tabla compacta">
                <thead><tr><th>Sobre</th><th>Cliente</th><th>Trabajo</th><th className="d">Entregado</th></tr></thead>
                <tbody>
                  {actuales.map((x) => (
                    <tr key={x.id} className="clic" onClick={() => abrir(x.trabajos.id)}>
                      <td><b>{x.trabajos.nro_sobre}</b></td><td>{x.trabajos.clientes?.nombre}</td><td className="meta">{x.trabajos.descripcion}</td><td className="d">{dma(x.fecha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {terminados.length > 0 && (
              <>
                <h4 className="sub">Trabajos que ya salieron</h4>
                <table className="tabla compacta">
                  <thead><tr><th>Sobre</th><th className="d">Entregado</th><th className="d">Salió</th><th className="d">Pagado</th></tr></thead>
                  <tbody>
                    {(verTodos ? terminados : terminados.slice(0, 8)).map((x) => (
                      <tr key={x.id}>
                        <td><b>{x.trabajos?.nro_sobre}</b> <span className="meta">{x.trabajos?.clientes?.nombre}</span></td>
                        <td className="d">{dma(x.fecha)}</td><td className="d">{dma(x.hasta)}</td>
                        <td className="d">{x.pago == null ? <span className="meta">Pasó a otro taller</span> : montoPago(x.pago, x.pago_moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td colSpan={3}>Total pagado</td><td className="d">
                      {total('ARS') > 0 && <div>{hechura(total('ARS'), 'ARS')}</div>}
                      {total('USD') > 0 && <div>{hechura(total('USD'), 'USD')}</div>}
                      {!total('ARS') && !total('USD') && '—'}
                    </td></tr>
                  </tfoot>
                </table>
                {terminados.length > 8 && (
                  <button className="btn suave" onClick={() => setAbierto({ ...abierto, [n]: !verTodos })}>{verTodos ? 'Ver menos' : `Ver los ${terminados.length}`}</button>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Tarjeta({ t, talleristas, accion, preguntar, preguntarPago, abrir, marcado, marcar }) {
  const opciones = talleristas.filter((x) => x.activo && x.id !== t.tallerista_id)
  const [cambiando, setCambiando] = useState(false)
  const [destino, setDestino] = useState('')
  const [otro, setOtro] = useState('')
  const elegido = destino || (opciones[0] ? String(opciones[0].id) : 'otro')

  const upd = async (campos) => {
    const { error } = await sb.from('trabajos').update(campos).eq('id', t.id)
    if (error) throw error
  }

  const responder = (aceptado) => accion(async () => {
    const { error } = await sb.rpc('responder_presupuesto', { p_trabajo: t.id, p_aceptado: aceptado })
    if (error) throw error
  })

  async function cambiarTaller() {
    const nombre = elegido === 'otro' ? otro.trim() : opciones.find((x) => String(x.id) === elegido)?.nombre
    if (!nombre) return accion(async () => { throw new Error('Escribí el nombre del tallerista.') })
    const texto = t.tallerista
      ? `¿Estás seguro de pasar el sobre ${t.nro_sobre} de ${t.tallerista} a ${nombre}?`
      : `¿Estás seguro de pasar el sobre ${t.nro_sobre} a ${nombre}?`
    if (!(await preguntar(texto))) return
    accion(async () => {
      const id = elegido === 'otro' ? await resolverTallerista(nombre, talleristas) : Number(elegido)
      const { error } = await sb.rpc('asignar_tallerista', { p_trabajo: t.id, p_tallerista: id })
      if (error) throw error
      setDestino(''); setOtro(''); setCambiando(false)
    })
  }

  async function listo() {
    const p = await preguntarPago(`Sobre ${t.nro_sobre} listo para facturar. ¿Cuánto le pagaste${t.tallerista ? ' a ' + t.tallerista : ''} por este trabajo?`)
    if (!p) return
    accion(async () => {
      const { error } = await sb.rpc('marcar_listo', { p_trabajo: t.id, p_pago: p.monto, p_moneda: p.moneda })
      if (error) throw error
    })
  }
  const ultimo = (t.talleres || []).at(-1)

  return (
    <div className={'card sobre est-' + t.estado + (marcado ? ' marcado' : '')}>
      <div className="sobre-cab" onClick={abrir} role="button">
        {marcado !== null && marcado !== undefined && (
          <input type="checkbox" className="check-sobre" checked={marcado} onClick={(e) => e.stopPropagation()} onChange={(e) => marcar(e.target.checked)} aria-label={'Elegir sobre ' + t.nro_sobre} />
        )}
        <div className="sobre-titulo">
          <div className="nro">Sobre {t.nro_sobre}</div>
          <div className="cliente">{t.cliente}</div>
        </div>
        {t.estado === 'taller'
          ? (t.tallerista ? <span className="chip tallerista-actual">{t.tallerista}</span> : <span className="chip est-taller">Sin tallerista</span>)
          : <span className={'chip est-' + t.estado}>{estadoTexto(t)}</span>}
      </div>
      <div className="sobre-cuerpo" onClick={abrir} role="button">
        <div className="meta">{TIPOS[t.tipo]} · Ingresó {fecha(t.ingresado_en)}</div>
        <Recorrido t={t} />
        {t.descripcion && <div className="desc">{t.descripcion}</div>}
        {t.presupuesto_hechura != null && (
          <div className="meta">Presupuesto: {hechura(t.presupuesto_hechura, t.presupuesto_moneda)} · {METALES[t.presupuesto_metal] || '—'}
            {t.presupuesto_peso != null ? ' ' + gramos(t.presupuesto_peso) : ''}
            {t.presupuesto_respuesta ? ' · ' + (t.presupuesto_respuesta === 'aceptado' ? 'Aceptado' : 'Rechazado') : ''}</div>
        )}
        {t.estado === 'facturado' && (
          <div className="meta">Facturado {fecha(t.facturado_en)} · {hechura(t.hechura, t.hechura_moneda)} · {METALES[t.metal] || ''} {t.peso_fino != null ? gramos(t.peso_fino) + ' fino' : ''}</div>
        )}
        {t.estado === 'listo_para_facturar' && ultimo?.pago != null && (
          <div className="pagado">Pagado a {ultimo.talleristas?.nombre}: <b>{hechura(ultimo.pago, ultimo.pago_moneda)}</b></div>
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
        {t.estado === 'taller' && (
          <div className="acciones-taller">
            {!cambiando ? (
              <button className="btn" onClick={() => setCambiando(true)}>{t.tallerista ? 'Cambiar de taller' : 'Asignar tallerista'}</button>
            ) : (
              <div className="cambio-taller">
                <select value={elegido} onChange={(e) => setDestino(e.target.value)} aria-label="Tallerista" autoFocus>
                  {opciones.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  <option value="otro">Otro…</option>
                </select>
                {elegido === 'otro' && <input value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Nombre" autoFocus />}
                <button className="btn primario" onClick={cambiarTaller}>Aceptar</button>
                <button className="btn suave" onClick={() => { setCambiando(false); setDestino(''); setOtro('') }}>Cancelar</button>
              </div>
            )}
            <button className="btn ok" onClick={listo}>Listo para facturar</button>
          </div>
        )}
        {(t.estado === 'facturado' || t.estado === 'rechazado') && (
          <button className="btn primario" onClick={() => window.confirm(`¿Confirmás que entregaste el sobre ${t.nro_sobre}?`) && accion(() => upd({ estado: 'entregado' }))}>Entregado</button>
        )}
      </div>
    </div>
  )
}

const aTexto = (v) => (v == null ? '' : String(v).replace('.', ','))

function Detalle({ t, cerrar, recargar, preguntar, elegirTallerista, accion }) {
  async function devolver() {
    const tall = await elegirTallerista(`¿A qué tallerista vuelve el sobre ${t.nro_sobre}?`)
    if (!tall) return
    if (!(await preguntar(`¿Estás seguro de devolver el sobre ${t.nro_sobre} al taller de ${tall.nombre}?`))) return
    accion(() => devolverATaller([t.id], tall.id))
  }

  // Fotos: la principal (foto_path) + las agregadas
  const [principal, setPrincipal] = useState(t.foto_path)
  const [fotos, setFotos] = useState([]) // [{ key, url }]
  const [verFoto, setVerFoto] = useState(0)
  const [hist, setHist] = useState([])
  const [talleres, setTalleres] = useState([])
  const [desc, setDesc] = useState(t.descripcion || '')
  const [pres, setPres] = useState({ hechura: aTexto(t.presupuesto_hechura), moneda: t.presupuesto_moneda || 'ARS', metal: t.presupuesto_metal || 'oro', peso: aTexto(t.presupuesto_peso) })
  const [msg, setMsg] = useState('')
  const [subiendo, setSubiendo] = useState(false)

  const cargarFotos = useCallback(async (ppal) => {
    const { data } = await sb.from('trabajo_fotos').select('id,path').eq('trabajo_id', t.id).order('id')
    const paths = [ppal, ...(data || []).map((x) => x.path)].filter(Boolean)
    setFotos(await Promise.all(paths.map(async (p) => ({ key: p, url: await fotoUrl(p) }))))
  }, [t.id])

  useEffect(() => {
    cargarFotos(t.foto_path)
    sb.from('historial_estados').select('*').eq('trabajo_id', t.id).order('cambiado_en').then(({ data }) => setHist(data || []))
    sb.from('traspasos_taller').select('id,fecha,talleristas(nombre)').eq('trabajo_id', t.id).order('fecha').order('id').then(({ data }) => setTalleres(data || []))
  }, [t.id, t.foto_path, cargarFotos])

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

  // cambiar = reemplaza la foto principal · agregar = suma otra foto
  async function nuevaFoto(e, modo) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setSubiendo(true)
    try {
      if (modo === 'cambiar' || !principal) {
        const p = await subirFoto(t.id, f)
        setPrincipal(p)
        await cargarFotos(p)
        setVerFoto(0)
        setMsg(modo === 'cambiar' ? 'Foto cambiada.' : 'Foto agregada.')
      } else {
        await agregarFoto(t.id, f)
        await cargarFotos(principal)
        setVerFoto(fotos.length)
        setMsg('Foto agregada.')
      }
      recargar()
    } catch (er) { setMsg(errorMsg(er)) }
    setSubiendo(false)
  }
  const url = fotos[verFoto]?.url || fotos[0]?.url

  // Estado con el nombre del tallerista al pasar a taller
  const ESTADO_H = { presupuesto: 'Presupuesto', esperando_confirmacion: 'Pendiente', rechazado: 'Rechazado', taller: 'En taller', listo_para_facturar: 'Listo para facturar', facturado: 'Facturado', entregado: 'Entregado' }

  return (
    <div className="modal-fondo" onClick={cerrar}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
        <h2>Sobre {t.nro_sobre}</h2>
        <div className="meta"><a href={'#/clientes?id=' + t.cliente_id}>{t.cliente}</a> · {TIPOS[t.tipo]} · {t.estado === 'taller' && t.tallerista ? <span className="chip tallerista-actual">{t.tallerista}</span> : <span className={'chip est-' + t.estado}>{estadoTexto(t)}</span>}</div>
        {url ? <img src={url} className="foto-grande" alt={'Sobre ' + t.nro_sobre} /> : <div className="sin-foto">Sin foto</div>}
        {fotos.length > 1 && (
          <div className="miniaturas">
            {fotos.map((f, i) => (
              <button key={f.key} className={'miniatura' + (i === verFoto ? ' sel' : '')} onClick={() => setVerFoto(i)}>
                <img src={f.url} alt={'Foto ' + (i + 1)} />
              </button>
            ))}
          </div>
        )}
        <div className="botones-foto">
          {principal && (
            <label className="btn suave archivo">{subiendo ? 'Subiendo…' : 'Cambiar foto'}
              <input type="file" accept="image/*" capture="environment" onChange={(e) => nuevaFoto(e, 'cambiar')} hidden />
            </label>
          )}
          <label className="btn suave archivo">{subiendo ? 'Subiendo…' : 'Agregar foto'}
            <input type="file" accept="image/*" capture="environment" onChange={(e) => nuevaFoto(e, 'agregar')} hidden />
          </label>
        </div>
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

        {t.estado === 'listo_para_facturar' && (
          <div className="acciones-detalle">
            <button className="btn ok" onClick={() => ir('facturacion', { sobres: t.id })}>Enviar a facturación</button>
            <button className="btn" onClick={devolver}>Devolver a taller</button>
          </div>
        )}

        {talleres.length > 0 && (
          <>
            <h3>Talleres</h3>
            <table className="tabla compacta">
              <tbody>
                {talleres.map((x, i) => (
                  <tr key={x.id}><td>{fechaCorta(x.fecha + 'T12:00')}</td><td>{i === 0 ? 'Entró a ' : 'Pasó a '}<b className={t.estado === 'taller' && i === talleres.length - 1 ? 'nombre-actual' : 'nombre-pasado'}>{x.talleristas?.nombre}</b></td></tr>
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
