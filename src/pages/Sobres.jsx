import { useEffect, useState, useCallback } from 'react'
import { sb, TIPOS, METALES, cargarListas, errorMsg, fecha, fechaCorta, hechura, gramos, num, fotoUrl, ir, estadoTexto, resolverTallerista, colorCliente, colorTallerista } from '../lib'
import { useTiempoReal } from '../tiempoReal'
import { subirFotoItem, agregarFotoItem } from '../foto'
import { CamposPresupuesto, SelectorMoneda } from '../components'

// Pestañas: las de ítems (taller, pendientes) muestran el sobre si alguno de sus ítems está en ese estado
const PESTANAS = [
  ['todos', 'Sobres'],
  ['taller', 'En taller'],
  ['pendientes', 'Pendientes'],
  ['listos', 'Listos para facturar'],
  ['entregar', 'Para entregar'],
  ['entregados', 'Entregados'],
  ['talleristas', 'Talleristas'],
]
const ESTADOS_SOBRE = {
  taller: ['taller', 'esperando_confirmacion'],
  pendientes: ['taller', 'esperando_confirmacion'],
  listos: ['listo_para_facturar'],
  entregar: ['facturado', 'rechazado'],
  entregados: ['entregado'],
}
const ESTADO_ITEM_TAB = { taller: 'taller', pendientes: 'pendiente' }

const rpc = async (fn, args) => {
  const { error } = await sb.rpc(fn, args)
  if (error) throw error
}
const dma = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '')
const dm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '')
// "$ 15.000,00 + 2,5 g oro 18k"
const textoPago = (x) => [x.pago != null ? hechura(x.pago, x.pago_moneda) : null, x.pago_oro18 != null ? gramos(x.pago_oro18) + ' oro 18k' : null].filter(Boolean).join(' + ')
// "$ 20.000,00 · Oro 1,5 g" (lo que esté cargado)
const textoPresupuesto = (it) => [
  it.presupuesto_hechura != null ? hechura(it.presupuesto_hechura, it.presupuesto_moneda) : null,
  it.presupuesto_metal ? METALES[it.presupuesto_metal] + (it.presupuesto_peso != null ? ' ' + gramos(it.presupuesto_peso) : '') : null,
].filter(Boolean).join(' · ')
const nombreItem = (it, total) => it.nombre || (total > 1 ? `Ítem ${it.numero}` : 'Trabajo')

// Nombre del tallerista con su color
function ChipTall({ id, nombre }) {
  if (!nombre) return <span className="chip est-taller">Sin tallerista</span>
  return <span className="chip chip-tall" style={{ background: colorTallerista(id) }}>{nombre}</span>
}

export default function Sobres({ params }) {
  const tab = PESTANAS.find((p) => p[0] === params.get('tab')) || PESTANAS[0]
  const [trabajos, setTrabajos] = useState([])
  const [conteo, setConteo] = useState({})
  const [listas, setListas] = useState({ clientes: [], talleristas: [] })
  const [buscar, setBuscar] = useState('')
  const [filtroTall, setFiltroTall] = useState('')
  const [detalleId, setDetalleId] = useState(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [marcados, setMarcados] = useState([])

  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setCargando(true)
    let q = sb.from('vista_trabajos').select('*').order('ingresado_en', { ascending: false })
    if (ESTADOS_SOBRE[tab[0]]) q = q.in('estado', ESTADOS_SOBRE[tab[0]])
    if (tab[0] === 'entregados' || tab[0] === 'todos') q = q.limit(300)
    const [{ data, error }, { data: itemsActivos }, { data: listos }] = await Promise.all([
      tab[0] === 'talleristas' ? Promise.resolve({ data: [] }) : q,
      sb.from('items').select('trabajo_id,estado').in('estado', ['taller', 'pendiente']),
      sb.from('trabajos').select('id').eq('estado', 'listo_para_facturar'),
    ])
    if (error) setError(errorMsg(error))
    const ids = (data || []).map((t) => t.id)
    const porTrabajo = {}
    if (ids.length) {
      const [{ data: its }, { data: tr }] = await Promise.all([
        sb.from('items').select('*, talleristas(nombre)').in('trabajo_id', ids).order('numero'),
        sb.from('traspasos_taller').select('id,item_id,tallerista_id,fecha,hasta,pago,pago_moneda,pago_oro18,talleristas(nombre)').in('trabajo_id', ids).order('fecha').order('id'),
      ])
      const rec = {}
      ;(tr || []).forEach((x) => { (rec[x.item_id] ||= []).push(x) })
      ;(its || []).forEach((it) => { (porTrabajo[it.trabajo_id] ||= []).push({ ...it, tallerista: it.talleristas?.nombre, talleres: rec[it.id] || [] }) })
    }
    setTrabajos((data || []).map((t) => ({ ...t, items: porTrabajo[t.id] || [] })))
    // Contadores de las pestañas
    const enTaller = new Set(), pend = new Set()
    ;(itemsActivos || []).forEach((i) => (i.estado === 'taller' ? enTaller : pend).add(i.trabajo_id))
    setConteo({ taller: enTaller.size, pendientes: pend.size, listos: (listos || []).length })
    setCargando(false)
  }, [tab[0]]) // eslint-disable-line react-hooks/exhaustive-deps

  const recargarListas = () => cargarListas().then(setListas)
  useEffect(() => { cargar(); setMarcados([]); setDetalleId(null) }, [cargar])
  // Se actualiza solo cuando cambia algo (sin recargar la página)
  const [version, setVersion] = useState(0)
  useTiempoReal(() => { cargar(true); setVersion((v) => v + 1) }, ['trabajos', 'items', 'traspasos_taller', 'talleristas'])
  useEffect(() => { recargarListas() }, [])

  async function accion(fn) {
    setError('')
    try { await fn(); await cargar(); recargarListas() } catch (e) { setError(errorMsg(e)) }
  }

  // Ventana de confirmación "Sí" / "No"
  const [confirmacion, setConfirmacion] = useState(null)
  const preguntar = (texto) => new Promise((resolve) => setConfirmacion({ texto, resolve }))
  const responderConf = (si) => { confirmacion.resolve(si); setConfirmacion(null) }

  // Cuánto se le pagó al tallerista (solo registro)
  const [pago, setPago] = useState(null)
  const preguntarPago = (texto) => new Promise((resolve) => setPago({ texto, resolve, monto: '', moneda: 'ARS', oro: '', error: '' }))
  function responderPago(ok) {
    if (!ok) { pago.resolve(null); setPago(null); return }
    const m = num(pago.monto), o = num(pago.oro)
    if (Number.isNaN(m) || Number.isNaN(o) || m < 0 || o < 0) return setPago({ ...pago, error: 'Revisá los números.' })
    if (m === null && o === null) return setPago({ ...pago, error: 'Cargá el monto, el oro 18k o los dos (pueden ser 0).' })
    pago.resolve({ monto: m, moneda: pago.moneda, oro: o }); setPago(null)
  }

  // Elegir tallerista de una lista
  const [eleccion, setEleccion] = useState(null)
  const elegirTallerista = (texto) => new Promise((resolve) => setEleccion({ texto, resolve }))
  const responderElec = (t) => { eleccion.resolve(t); setEleccion(null) }

  const estadoItemTab = ESTADO_ITEM_TAB[tab[0]]
  const b = tab[0] === 'todos' ? buscar.trim().toLowerCase() : ''
  const visibles = trabajos.filter((t) =>
    (!estadoItemTab || t.items.some((i) => i.estado === estadoItemTab)) &&
    (!b || t.nro_sobre.toLowerCase().includes(b) || t.cliente.toLowerCase().includes(b) || t.items.some((i) => (i.descripcion || '').toLowerCase().includes(b))) &&
    (!filtroTall || t.items.some((i) => String(i.tallerista_id) === filtroTall && (tab[0] !== 'taller' || i.estado === 'taller'))))
  if (tab[0] === 'todos' || tab[0] === 'taller') {
    // Desde cuándo está en lo de un tallerista (el ítem que hace más tiempo)
    const desde = (t) => {
      const f = t.items.filter((i) => i.estado === 'taller').map((i) => (i.talleres || []).at(-1)?.fecha || t.ingresado_en.slice(0, 10))
      return f.length ? f.sort()[0] : null
    }
    const grupo = (t) => (t.items.some((i) => i.estado === 'taller') ? 0
      : t.estado === 'esperando_confirmacion' ? 1
      : t.estado === 'listo_para_facturar' ? 2
      : t.estado === 'facturado' || t.estado === 'rechazado' ? 3 : 4)
    visibles.sort((a, b) => grupo(a) - grupo(b)
      || (grupo(a) === 0 ? desde(a).localeCompare(desde(b)) : 0)
      || b.ingresado_en.localeCompare(a.ingresado_en))
  }

  const activos = listas.talleristas.filter((x) => x.activo)
  const marcar = (id, si) => setMarcados((m) => (si ? [...m, id] : m.filter((x) => x !== id)))
  const textoElegidos = (n) => (n === 1 ? 'el sobre elegido' : `los ${n} sobres elegidos`)

  async function facturarMarcados() {
    if (!(await preguntar(`¿Estás seguro de facturar ${textoElegidos(marcados.length)}?`))) return
    ir('facturacion', { sobres: marcados.join(',') })
  }

  async function devolverMarcados() {
    const tall = await elegirTallerista(`¿A qué tallerista ${marcados.length === 1 ? 'vuelve el sobre elegido' : `vuelven los ${marcados.length} sobres elegidos`}?`)
    if (!tall) return
    if (!(await preguntar(`¿Estás seguro de devolver ${textoElegidos(marcados.length)} al taller de ${tall.nombre}?`))) return
    accion(async () => {
      for (const t of trabajos.filter((x) => marcados.includes(x.id))) {
        for (const it of t.items.filter((i) => i.estado === 'listo')) await rpc('devolver_item', { p_item: it.id, p_tallerista: tall.id })
      }
    })
  }

  const ctx = { talleristas: listas.talleristas, clientes: listas.clientes, accion, preguntar, preguntarPago, elegirTallerista, cerrarDetalle: () => setDetalleId(null) }
  const detalle = trabajos.find((t) => t.id === detalleId)

  return (
    <section>
      <div className="pestanas">
        {PESTANAS.map(([k, t]) => (
          <a key={k} href={'#/sobres?tab=' + k} className={tab[0] === k ? 'activo' : ''}>
            {t}{conteo[k] ? <span className="contador">{conteo[k]}</span> : null}
          </a>
        ))}
      </div>
      {tab[0] !== 'talleristas' && (
        <div className="filtros">
          {tab[0] === 'todos' && <input placeholder="Buscar por sobre, cliente o descripción" value={buscar} onChange={(e) => setBuscar(e.target.value)} />}
          {(tab[0] === 'taller' || tab[0] === 'todos') && (
            <select value={filtroTall} onChange={(e) => setFiltroTall(e.target.value)}>
              <option value="">Todos los talleristas</option>
              {listas.talleristas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          )}
        </div>
      )}
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
        <ResumenTalleristas abrir={(id) => setDetalleId(id)} talleristas={listas.talleristas} version={version} />
      ) : cargando ? <div className="vacio">Cargando…</div> : visibles.length === 0 ? <div className="vacio">No hay sobres acá.</div> : (
        <div className="lista">
          {visibles.map((t) => (
            <Tarjeta key={t.id} t={t} abrir={() => setDetalleId(t.id)}
              marcado={tab[0] === 'listos' ? marcados.includes(t.id) : null} marcar={(si) => marcar(t.id, si)} />
          ))}
        </div>
      )}
      {detalleId && <DetalleCargado id={detalleId} t={detalle} ctx={ctx} recargar={cargar} version={version} cerrar={() => setDetalleId(null)} />}

      {pago && (
        <div className="modal-fondo centrado" onClick={() => responderPago(false)}>
          <form className="modal card confirmar" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); responderPago(true) }}>
            <p>{pago.texto}</p>
            <div className="campos-pago">
              <label>Monto
                <div className="con-moneda">
                  <SelectorMoneda valor={pago.moneda} onChange={(m) => setPago({ ...pago, moneda: m })} />
                  <input inputMode="decimal" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value, error: '' })} autoFocus />
                </div>
              </label>
              <label>Oro 18k (g)
                <input inputMode="decimal" value={pago.oro} onChange={(e) => setPago({ ...pago, oro: e.target.value, error: '' })} />
              </label>
            </div>
            <p className="ayuda">Es solo un registro: no se usa para facturar.</p>
            {pago.error && <div className="error">{pago.error}</div>}
            <div className="botones">
              <button className="btn ok">Aceptar</button>
              <button type="button" className="btn suave" onClick={() => responderPago(false)}>Cancelar</button>
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
              <button className="btn primario" onClick={() => responderConf(true)} autoFocus>Sí</button>
              <button className="btn suave" onClick={() => responderConf(false)}>No</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------- Recorrido de talleres de un ítem: verde = está ahí ahora, gris = ya salió ----------
function Recorrido({ it, siempre }) {
  const lista = it.talleres || []
  const enTaller = it.estado === 'taller'
  if (!lista.length || (!siempre && enTaller && lista.length === 1)) return null
  return (
    <div className="recorrido">
      {lista.map((x, i) => {
        const actual = enTaller && i === lista.length - 1
        return (
          <span key={x.id} className="paso-envoltura">
            {i > 0 && <span className="flecha">→</span>}
            <span className={'paso ' + (actual ? 'actual' : 'pasado')} style={actual ? { background: colorTallerista(x.tallerista_id) } : undefined}>{x.talleristas?.nombre} <small>{dm(x.fecha)}</small></span>
          </span>
        )
      })}
    </div>
  )
}

// ---------- Chip de estado del sobre ----------
function ChipSobre({ t }) {
  const its = t.items || []
  if (t.estado === 'taller' || t.estado === 'esperando_confirmacion') {
    const nT = its.filter((i) => i.estado === 'taller').length
    const nP = its.filter((i) => i.estado === 'pendiente').length
    if (its.length === 1 && nT === 1) return <ChipTall id={its[0].tallerista_id} nombre={its[0].tallerista} />
    if (its.length > 1) {
      return (
        <span className="chips">
          {nT > 0 && <span className="chip est-taller">{nT} en taller</span>}
          {nP > 0 && <span className="chip est-esperando_confirmacion">{nP} pendiente{nP > 1 ? 's' : ''}</span>}
        </span>
      )
    }
  }
  return <span className={'chip est-' + t.estado}>{estadoTexto(t)}</span>
}

// ---------- Tarjeta de un sobre: solo número, quién lo tiene y desde cuándo (color del cliente) ----------
function Tarjeta({ t, abrir, marcado, marcar }) {
  // Un renglón por tallerista que tiene ítems del sobre ahora
  const enTaller = {}
  t.items.filter((i) => i.estado === 'taller').forEach((i) => {
    const k = i.tallerista_id || 0
    const desde = (i.talleres || []).at(-1)?.fecha || t.ingresado_en.slice(0, 10)
    if (!enTaller[k] || desde < enTaller[k].desde) enTaller[k] = { id: i.tallerista_id, nombre: i.tallerista || 'Sin tallerista', desde }
  })
  const lineas = Object.values(enTaller).sort((a, b) => a.desde.localeCompare(b.desde))
  const pendientes = t.items.filter((i) => i.estado === 'pendiente').length
  const otro = { listo_para_facturar: 'Listo para facturar', facturado: 'Facturado', entregado: 'Entregado', rechazado: 'Rechazado – para devolver' }[t.estado]

  return (
    <div className={'card sobre tile' + (marcado ? ' marcado' : '')} style={{ '--cliente': colorCliente(t.cliente_id) }} onClick={abrir} role="button" title={t.cliente}>
      <div className="tile-cab">
        {marcado !== null && marcado !== undefined && (
          <input type="checkbox" className="check-sobre" checked={marcado} onClick={(e) => e.stopPropagation()} onChange={(e) => marcar(e.target.checked)} aria-label={'Elegir sobre ' + t.nro_sobre} />
        )}
        <div className="nro">Sobre {t.nro_sobre}</div>
      </div>
      <div className="tile-cuerpo">
        {lineas.map((l) => (
          <div key={l.id || 0} className="tile-linea">
            <b>{l.nombre}</b><span>desde {dma(l.desde)}</span>
          </div>
        ))}
        {pendientes > 0 && <div className="tile-linea"><b>Presupuesto pendiente</b>{pendientes > 1 && <span>{pendientes} ítems</span>}</div>}
        {!lineas.length && !pendientes && otro && <div className="tile-linea"><b>{otro}</b></div>}
      </div>
    </div>
  )
}

// ---------- Botones de cada ítem (dentro del sobre abierto) ----------
function AccionesItem({ it, total, t, ctx }) {
  const opciones = ctx.talleristas.filter((x) => x.activo && x.id !== it.tallerista_id)
  const [cambiando, setCambiando] = useState(false)
  const [destino, setDestino] = useState('')
  const [otro, setOtro] = useState('')
  const elegido = destino || (opciones[0] ? String(opciones[0].id) : 'otro')
  const quien = total > 1 ? `el ítem ${it.numero} del sobre ${t.nro_sobre}` : `el sobre ${t.nro_sobre}`
  async function cambiarTaller() {
    const nombre = elegido === 'otro' ? otro.trim() : opciones.find((x) => String(x.id) === elegido)?.nombre
    if (!nombre) return ctx.accion(async () => { throw new Error('Escribí el nombre del tallerista.') })
    const texto = it.tallerista ? `¿Estás seguro de pasar ${quien} de ${it.tallerista} a ${nombre}?` : `¿Estás seguro de pasar ${quien} a ${nombre}?`
    if (!(await ctx.preguntar(texto))) return
    ctx.accion(async () => {
      const id = elegido === 'otro' ? await resolverTallerista(nombre, ctx.talleristas) : Number(elegido)
      await rpc('asignar_tallerista_item', { p_item: it.id, p_tallerista: id })
      setDestino(''); setOtro(''); setCambiando(false)
    })
  }

  async function listo() {
    const p = await ctx.preguntarPago(`${total > 1 ? `Ítem ${it.numero} del sobre ${t.nro_sobre}` : `Sobre ${t.nro_sobre}`} listo. ¿Cuánto le pagaste${it.tallerista ? ' a ' + it.tallerista : ''} por este trabajo?`)
    if (!p) return
    ctx.accion(() => rpc('marcar_item_listo', { p_item: it.id, p_pago: p.monto, p_moneda: p.moneda, p_oro18: p.oro }))
  }

  const responder = async (aceptado) => {
    const pres = textoPresupuesto(it)
    const texto = aceptado
      ? `¿El cliente aceptó el presupuesto de ${quien}${pres ? ` (${pres})` : ''}? Pasa al taller${it.tallerista ? ' de ' + it.tallerista : ''}.`
      : `¿El cliente rechazó el presupuesto de ${quien}?`
    if (!(await ctx.preguntar(texto))) return
    ctx.accion(() => rpc('responder_item', { p_item: it.id, p_aceptado: aceptado }))
  }

  return (
    <>
      {it.estado === 'pendiente' && (
        <div className="acciones">
          <button className="btn ok" onClick={() => responder(true)}>Aceptado</button>
          <button className="btn peligro" onClick={() => responder(false)}>Rechazado</button>
        </div>
      )}
      {it.estado === 'taller' && (
        <div className="acciones-taller">
          {!cambiando ? (
            <button className="btn" onClick={() => setCambiando(true)}>{it.tallerista ? 'Cambiar de taller' : 'Asignar tallerista'}</button>
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
    </>
  )
}

// ---------- Pestaña Talleristas: paneles con cuántos sobres tiene cada uno; al tocar uno, su detalle ----------
function ResumenTalleristas({ abrir, talleristas, version }) {
  const [filas, setFilas] = useState(null)
  const [elegido, setElegido] = useState(null)

  useEffect(() => {
    sb.from('traspasos_taller')
      .select('id,fecha,hasta,pago,pago_moneda,pago_oro18,tallerista_id,talleristas(nombre),items(numero,nombre,descripcion,estado),trabajos(id,nro_sobre,cliente_id,clientes(nombre))')
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(2000)
      .then(({ data }) => setFilas(data || []))
  }, [version])

  if (!filas) return <div className="vacio">Cargando…</div>

  const porTall = {}
  filas.forEach((x) => { (porTall[x.tallerista_id] ||= []).push(x) })
  const actualesDe = (id) => (porTall[id] || []).filter((x) => !x.hasta && x.items?.estado === 'taller')
  const sobresDe = (id) => new Set(actualesDe(id).map((x) => x.trabajos?.id)).size
  const lista = talleristas.filter((t) => t.activo || porTall[t.id]).sort((a, b) => sobresDe(b.id) - sobresDe(a.id) || a.nombre.localeCompare(b.nombre))

  if (elegido) {
    const t = talleristas.find((x) => x.id === elegido)
    return <DetalleTallerista t={t} filas={porTall[elegido] || []} abrir={abrir} volver={() => setElegido(null)} />
  }
  if (!lista.length) return <div className="vacio">Todavía no hay talleristas cargados.</div>
  return (
    <div className="paneles-tall">
      {lista.map((t) => {
        const n = sobresDe(t.id)
        return (
          <button key={t.id} className="panel-tall" style={{ '--tall': colorTallerista(t.id) }} onClick={() => setElegido(t.id)}>
            <span className="panel-nombre">{t.nombre}</span>
            <span className="panel-num">{n}</span>
            <span className="panel-txt">{n === 1 ? 'sobre en su taller' : 'sobres en su taller'}</span>
          </button>
        )
      })}
    </div>
  )
}

function DetalleTallerista({ t, filas, abrir, volver }) {
  const [verTodos, setVerTodos] = useState(false)
  const actuales = filas.filter((x) => !x.hasta && x.items?.estado === 'taller')
  const terminados = filas.filter((x) => x.hasta)
  const total = (m) => terminados.filter((x) => x.pago != null && x.pago_moneda === m).reduce((s, x) => s + Number(x.pago), 0)
  const totalOro = terminados.reduce((s, x) => s + Number(x.pago_oro18 || 0), 0)
  const trabajo = (x) => x.items?.nombre || x.items?.descripcion || ''
  const sobre = (x) => x.trabajos?.nro_sobre

  return (
    <div className="detalle-tall">
      <button className="btn suave volver-tall" onClick={volver}>← Todos los talleristas</button>
      <div className="card grupo-tallerista" style={{ borderTop: `5px solid ${colorTallerista(t?.id)}` }}>
        <div className="grupo-cab"><b style={{ color: colorTallerista(t?.id) }}>{t?.nombre}</b><span className="meta">{actuales.length} {actuales.length === 1 ? 'trabajo' : 'trabajos'} en su taller</span></div>

        <h4 className="sub">Tiene ahora</h4>
        {actuales.length ? (
          <table className="tabla compacta">
            <thead><tr><th>Sobre</th><th>Cliente</th><th>Trabajo</th><th className="d">Entregado</th></tr></thead>
            <tbody>
              {actuales.map((x) => (
                <tr key={x.id} className="clic" onClick={() => abrir(x.trabajos.id)}>
                  <td><b>{sobre(x)}</b></td>
                  <td><span className="punto-cliente" style={{ background: colorCliente(x.trabajos?.cliente_id) }} />{x.trabajos?.clientes?.nombre}</td>
                  <td className="meta">{trabajo(x)}</td><td className="d">{dma(x.fecha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="meta">No tiene trabajos en este momento.</div>}

        <h4 className="sub">Tuvo</h4>
        {terminados.length ? (
          <>
            <table className="tabla compacta">
              <thead><tr><th>Sobre</th><th>Trabajo</th><th className="d">Entregado</th><th className="d">Salió</th><th className="d">Pagado</th></tr></thead>
              <tbody>
                {(verTodos ? terminados : terminados.slice(0, 15)).map((x) => (
                  <tr key={x.id} className="clic" onClick={() => abrir(x.trabajos.id)}>
                    <td><b>{sobre(x)}</b> <span className="meta">{x.trabajos?.clientes?.nombre}</span></td>
                    <td className="meta">{trabajo(x)}</td>
                    <td className="d">{dma(x.fecha)}</td><td className="d">{dma(x.hasta)}</td>
                    <td className="d">{x.pago == null && x.pago_oro18 == null ? <span className="meta">Pasó a otro taller</span> : textoPago(x)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>Total pagado</td><td className="d">
                  {total('ARS') > 0 && <div>{hechura(total('ARS'), 'ARS')}</div>}
                  {total('USD') > 0 && <div>{hechura(total('USD'), 'USD')}</div>}
                  {totalOro > 0 && <div>{gramos(totalOro)} oro 18k</div>}
                  {!total('ARS') && !total('USD') && !totalOro && '—'}
                </td></tr>
              </tfoot>
            </table>
            {terminados.length > 15 && <button className="btn suave" onClick={() => setVerTodos(!verTodos)}>{verTodos ? 'Ver menos' : `Ver los ${terminados.length}`}</button>}
          </>
        ) : <div className="meta">Todavía no terminó ningún trabajo.</div>}
      </div>
    </div>
  )
}

// ---------- Detalle de un sobre (con sus ítems) ----------
// Si el sobre no está en la lista cargada (p. ej. desde Talleristas), lo trae.
function DetalleCargado({ id, t, ctx, recargar, version, cerrar }) {
  const [sobre, setSobre] = useState(t || null)
  const [items, setItems] = useState(t?.items || null)
  const cargar = useCallback(async () => {
    const [{ data: s }, { data: its }, { data: tr }] = await Promise.all([
      sb.from('vista_trabajos').select('*').eq('id', id).single(),
      sb.from('items').select('*, talleristas(nombre)').eq('trabajo_id', id).order('numero'),
      sb.from('traspasos_taller').select('id,item_id,tallerista_id,fecha,hasta,pago,pago_moneda,pago_oro18,talleristas(nombre)').eq('trabajo_id', id).order('fecha').order('id'),
    ])
    const rec = {}
    ;(tr || []).forEach((x) => { (rec[x.item_id] ||= []).push(x) })
    setSobre(s)
    setItems((its || []).map((it) => ({ ...it, tallerista: it.talleristas?.nombre, talleres: rec[it.id] || [] })))
  }, [id])
  useEffect(() => { cargar() }, [cargar, version])
  if (!sobre || !items) return null
  const refrescar = async () => { await cargar(); recargar() }
  return <Detalle t={sobre} items={items} ctx={{ ...ctx, accion: async (fn) => { await ctx.accion(fn); await cargar() } }} recargar={refrescar} cerrar={cerrar} />
}

function Detalle({ t, items, ctx, recargar, cerrar }) {
  const [hist, setHist] = useState([])
  const [nuevo, setNuevo] = useState(null)
  const editable = !['facturado', 'entregado'].includes(t.estado)

  useEffect(() => {
    sb.from('historial_estados').select('*').eq('trabajo_id', t.id).order('cambiado_en').then(({ data }) => setHist(data || []))
  }, [t.id, t.estado])

  // Cambiar el cliente del sobre
  const [cliente, setCliente] = useState(null) // { sel: id del cliente o 'nuevo', nuevo: nombre }
  async function guardarCliente() {
    let c = cliente.sel === 'nuevo' ? null : ctx.clientes.find((x) => String(x.id) === String(cliente.sel))
    const nombre = c ? c.nombre : cliente.nuevo.trim()
    if (!nombre) return
    if (!c) c = ctx.clientes.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase()) || null
    if (c?.id === t.cliente_id) return setCliente(null)
    if (!(await ctx.preguntar(`¿Estás seguro de pasar el sobre ${t.nro_sobre} de ${t.cliente} a ${nombre}?`))) return
    await ctx.accion(async () => {
      if (!c) {
        const { data, error } = await sb.from('clientes').insert({ nombre }).select('id,nombre').single()
        if (error) throw error
        c = data
      }
      await rpc('cambiar_cliente_sobre', { p_trabajo: t.id, p_cliente: c.id })
    })
    setCliente(null)
    ctx.cerrarDetalle()
  }

  // Eliminar el sobre
  async function eliminar() {
    const extra = ['facturado', 'entregado'].includes(t.estado) ? ' Ya está facturado: también se quita de la cuenta del cliente.' : ''
    if (!(await ctx.preguntar(`¿Estás seguro de eliminar el sobre ${t.nro_sobre} con todos sus ítems y fotos? No se puede deshacer.${extra}`))) return
    await ctx.accion(async () => {
      await rpc('eliminar_sobre', { p_trabajo: t.id })
      // Borrar las fotos guardadas del sobre
      const { data: archivos } = await sb.storage.from('fotos').list(String(t.id), { limit: 1000 })
      if (archivos?.length) await sb.storage.from('fotos').remove(archivos.map((a) => `${t.id}/${a.name}`))
    })
    ctx.cerrarDetalle()
  }

  const [faltan, setFaltan] = useState(false)
  async function agregarItem() {
    if (!nuevo.nombre.trim() || !nuevo.descripcion.trim() || !nuevo.tallerista.trim()) return setFaltan('Completá el nombre, la descripción y el tallerista.')
    const h = num(nuevo.pres.hechura), p = nuevo.pres.metal ? num(nuevo.pres.peso) : null
    if (Number.isNaN(h) || Number.isNaN(p)) return setFaltan('Revisá la hechura y el peso.')
    setFaltan(false)
    const tallId = await resolverTallerista(nuevo.tallerista, ctx.talleristas)
    const esPres = t.tipo === 'presupuesto'
    await ctx.accion(() => rpc('agregar_item_sobre', { p: {
      trabajo_id: t.id, nombre: nuevo.nombre, descripcion: nuevo.descripcion, tallerista_id: tallId,
      presupuesto_hechura: esPres ? h : null, presupuesto_moneda: esPres && h !== null ? nuevo.pres.moneda : null,
      presupuesto_metal: esPres ? nuevo.pres.metal || null : null, presupuesto_peso: esPres ? p : null,
    } }))
    setNuevo(null)
  }

  const ESTADO_H = { presupuesto: 'Presupuesto', esperando_confirmacion: 'Pendiente', rechazado: 'Rechazado', taller: 'En taller', listo_para_facturar: 'Listo para facturar', facturado: 'Facturado', entregado: 'Entregado' }

  return (
    <div className="modal-fondo" onClick={cerrar}>
      <div className="modal card detalle" onClick={(e) => e.stopPropagation()}>
        <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
        <h2>Sobre {t.nro_sobre}</h2>
        <div className="meta"><span className="punto-cliente" style={{ background: colorCliente(t.cliente_id) }} /><a href={'#/clientes?id=' + t.cliente_id}>{t.cliente}</a> · {TIPOS[t.tipo]} · <ChipSobre t={{ ...t, items }} /></div>
        {cliente === null ? (
          <button className="btn suave cambiar-cliente" onClick={() => setCliente({ sel: String(t.cliente_id), nuevo: '' })}>Cambiar cliente</button>
        ) : (
          <div className="cambio-cliente">
            <select value={cliente.sel} onChange={(e) => setCliente({ ...cliente, sel: e.target.value })} aria-label="Cliente" autoFocus>
              {ctx.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              <option value="nuevo">+ Cliente nuevo…</option>
            </select>
            {cliente.sel === 'nuevo' && <input value={cliente.nuevo} onChange={(e) => setCliente({ ...cliente, nuevo: e.target.value })} placeholder="Nombre del cliente nuevo" autoFocus />}
            <div className="botones-par">
              <button className="btn ok" onClick={guardarCliente}>Aceptar</button>
              <button className="btn suave" onClick={() => setCliente(null)}>Cancelar</button>
            </div>
          </div>
        )}

        {items.map((it) => (
          <ItemDetalle key={it.id} it={it} t={t} total={items.length} ctx={ctx} recargar={recargar} />
        ))}

        {editable && (nuevo ? (
          <div className="item-detalle nuevo">
            <b>Nuevo ítem</b>
            <label>Nombre<input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Ej.: Anillo con piedra" /></label>
            <label>Descripción<textarea rows={2} value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} /></label>
            <label>Tallerista
              <input list="tall-nuevo-item" value={nuevo.tallerista} onChange={(e) => setNuevo({ ...nuevo, tallerista: e.target.value })} placeholder="Quién va a hacer el trabajo" />
              <datalist id="tall-nuevo-item">{ctx.talleristas.filter((x) => x.activo).map((x) => <option key={x.id} value={x.nombre} />)}</datalist>
            </label>
            {t.tipo === 'presupuesto' && (
              <>
                <h4 className="sub">Presupuesto (queda pendiente hasta que el cliente lo acepte)</h4>
                <CamposPresupuesto v={nuevo.pres} set={(pres) => setNuevo({ ...nuevo, pres })} />
              </>
            )}
            {faltan && <div className="error">{faltan}</div>}
            <div className="botones-par">
              <button className="btn ok" onClick={agregarItem}>Agregar</button>
              <button className="btn suave" onClick={() => setNuevo(null)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="btn suave" onClick={() => setNuevo({ nombre: '', descripcion: '', tallerista: '', pres: { hechura: '', moneda: 'ARS', metal: '', peso: '' } })}>+ Agregar ítem a este sobre</button>
        ))}

        {(t.estado === 'facturado' || t.estado === 'rechazado') && (
          <div className="acciones-detalle">
            <button className="btn primario" onClick={async () => (await ctx.preguntar(`¿Confirmás que entregaste el sobre ${t.nro_sobre}?`)) && ctx.accion(async () => {
              const { error } = await sb.from('trabajos').update({ estado: 'entregado' }).eq('id', t.id)
              if (error) throw error
            })}>Entregado</button>
          </div>
        )}
        {t.estado === 'listo_para_facturar' && (
          <div className="acciones-detalle">
            <button className="btn ok" onClick={() => ir('facturacion', { sobres: t.id })}>Enviar a facturación</button>
          </div>
        )}

        <h3>Historial del sobre</h3>
        <table className="tabla compacta">
          <tbody>
            {hist.map((h) => (
              <tr key={h.id}><td>{fecha(h.cambiado_en)}</td><td>{ESTADO_H[h.estado_nuevo]}</td></tr>
            ))}
          </tbody>
        </table>
        <button className="btn peligro eliminar-sobre" onClick={eliminar}>Eliminar sobre</button>
        <div className="pie-detalle">
          <button className="btn primario" onClick={cerrar}>Listo</button>
        </div>
      </div>
    </div>
  )
}

const aTexto = (v) => (v == null ? '' : String(v).replace('.', ','))

function ItemDetalle({ it, t, total, ctx, recargar }) {
  const [principal, setPrincipal] = useState(it.foto_path)
  const [fotos, setFotos] = useState([])
  const [verFoto, setVerFoto] = useState(0)
  const [ampliada, setAmpliada] = useState(false)
  const [tallPend, setTallPend] = useState(it.tallerista_id ? String(it.tallerista_id) : '')
  const [desc, setDesc] = useState(it.descripcion || '')
  const [nombre, setNombre] = useState(it.nombre || '')
  const [pres, setPres] = useState({ hechura: aTexto(it.presupuesto_hechura), moneda: it.presupuesto_moneda || 'ARS', metal: it.presupuesto_metal || '', peso: aTexto(it.presupuesto_peso) })
  const [msg, setMsg] = useState('')
  const [subiendo, setSubiendo] = useState(false)

  const cargarFotos = useCallback(async (ppal) => {
    const { data } = await sb.from('trabajo_fotos').select('id,path').eq('item_id', it.id).order('id')
    const paths = [ppal, ...(data || []).map((x) => x.path)].filter(Boolean)
    setFotos(await Promise.all(paths.map(async (p) => ({ key: p, url: await fotoUrl(p) }))))
  }, [it.id])
  useEffect(() => { cargarFotos(it.foto_path) }, [it.foto_path, cargarFotos])

  async function guardarDesc() {
    const { error } = await sb.from('items').update({ nombre: nombre.trim() || null, descripcion: desc.trim() || null }).eq('id', it.id)
    setMsg(error ? errorMsg(error) : 'Guardado.')
    recargar()
  }

  async function guardarPres() {
    const h = num(pres.hechura), p = pres.metal ? num(pres.peso) : null
    if (Number.isNaN(h) || Number.isNaN(p)) return setMsg('Revisá la hechura y el peso.')
    const { error } = await sb.from('items').update({ presupuesto_hechura: h, presupuesto_moneda: h === null ? null : pres.moneda, presupuesto_metal: pres.metal || null, presupuesto_peso: p, tallerista_id: tallPend ? Number(tallPend) : null }).eq('id', it.id)
    setMsg(error ? errorMsg(error) : 'Presupuesto actualizado.')
    recargar()
  }

  // cambiar = reemplaza la foto principal · agregar = suma otra
  async function nuevaFoto(e, modo) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setSubiendo(true)
    try {
      if (modo === 'cambiar' || !principal) {
        const p = await subirFotoItem(it, f)
        setPrincipal(p); await cargarFotos(p); setVerFoto(0)
        setMsg(modo === 'cambiar' ? 'Foto cambiada.' : 'Foto agregada.')
      } else {
        await agregarFotoItem(it, f)
        await cargarFotos(principal); setVerFoto(fotos.length)
        setMsg('Foto agregada.')
      }
    } catch (er) { setMsg(errorMsg(er)) }
    setSubiendo(false)
  }

  async function devolver() {
    const quien = total > 1 ? `el ítem ${it.numero} del sobre ${t.nro_sobre}` : `el sobre ${t.nro_sobre}`
    const tall = await ctx.elegirTallerista(`¿A qué tallerista vuelve ${quien}?`)
    if (!tall) return
    if (!(await ctx.preguntar(`¿Estás seguro de devolver ${quien} al taller de ${tall.nombre}?`))) return
    ctx.accion(() => rpc('devolver_item', { p_item: it.id, p_tallerista: tall.id }))
  }

  const url = fotos[verFoto]?.url || fotos[0]?.url
  const ESTADO_I = { pendiente: 'Pendiente', taller: it.tallerista ? it.tallerista : 'En taller', listo: 'Listo', rechazado: 'Presupuesto rechazado' }

  return (
    <div className="item-detalle">
      <div className="item-cab">
        <b>{nombreItem(it, total)}</b>
        {it.estado === 'taller' && it.tallerista
          ? <ChipTall id={it.tallerista_id} nombre={it.tallerista} />
          : <span className={'chip est-' + { pendiente: 'esperando_confirmacion', taller: 'taller', listo: 'listo_para_facturar', rechazado: 'rechazado' }[it.estado]}>{ESTADO_I[it.estado]}</span>}
      </div>
      {['pendiente', 'taller'].includes(it.estado) && !['facturado', 'entregado'].includes(t.estado) && (
        <div className="acciones-item-detalle"><AccionesItem it={it} total={total} t={t} ctx={ctx} /></div>
      )}
      {it.presupuesto_hechura != null || it.presupuesto_metal ? <div className="meta">Presupuesto: {textoPresupuesto(it)}{it.presupuesto_respuesta ? ` · ${it.presupuesto_respuesta === 'aceptado' ? 'aceptado' : 'rechazado'}` : ''}</div> : null}
      {url ? <img src={url} className="foto-grande clic" alt={'Ítem ' + it.numero} onClick={() => setAmpliada(true)} title="Tocá para agrandar" /> : <div className="sin-foto">Sin foto</div>}
      {ampliada && url && (
        <div className="foto-ampliada" onClick={() => setAmpliada(false)}>
          <img src={url} alt={'Ítem ' + it.numero} />
          <button className="cerrar-foto" aria-label="Cerrar">×</button>
        </div>
      )}
      {fotos.length > 1 && (
        <div className="miniaturas">
          {fotos.map((f, i) => (
            <button key={f.key} className={'miniatura' + (i === verFoto ? ' sel' : '')} onClick={() => setVerFoto(i)}><img src={f.url} alt={'Foto ' + (i + 1)} /></button>
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
      <label>Nombre
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      <label>Descripción
        <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
      <button className="btn" onClick={guardarDesc}>Guardar nombre y descripción</button>

      {it.estado === 'pendiente' && (
        <>
          <h4 className="sub">Presupuesto</h4>
          <CamposPresupuesto v={pres} set={setPres} />
          <label>Tallerista (cuando el cliente lo acepte)
            <select value={tallPend} onChange={(e) => setTallPend(e.target.value)}>
              <option value="">Sin elegir</option>
              {ctx.talleristas.filter((x) => x.activo || x.id === it.tallerista_id).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </label>
          <button className="btn" onClick={guardarPres}>Guardar presupuesto y tallerista</button>
        </>
      )}
      {msg && <div className="ok">{msg}</div>}

      {it.talleres.length > 0 && (
        <>
          <h4 className="sub">Talleres</h4>
          <Recorrido it={it} siempre />
          <table className="tabla compacta">
            <tbody>
              {it.talleres.map((x, i) => (
                <tr key={x.id}>
                  <td>{fechaCorta(x.fecha + 'T12:00')}</td>
                  <td>{i === 0 ? 'Entró a ' : 'Pasó a '}<b style={{ color: it.estado === 'taller' && i === it.talleres.length - 1 ? colorTallerista(x.tallerista_id) : '#8a8379' }}>{x.talleristas?.nombre}</b></td>
                  <td className="d meta">{(x.pago != null || x.pago_oro18 != null) ? 'Pagado: ' + textoPago(x) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {it.estado === 'listo' && !['facturado', 'entregado'].includes(t.estado) && (
        <button className="btn" onClick={devolver}>Devolver a taller</button>
      )}
    </div>
  )
}
