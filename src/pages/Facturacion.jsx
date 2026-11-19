import { useEffect, useState } from 'react'
import { sb, METALES, errorMsg, gramos, gramosFino, hechura as fmtHechura, num, fino, ir, colorCliente } from '../lib'
import { SelectorMoneda } from '../components'

// Facturación de UN cliente por vez. Cada ítem lleva su hechura, moneda, metal y peso,
// o el sobre se factura completo en un solo renglón. Los presupuestos rechazados van como "Devolución".

const txt = (v) => (v == null ? '' : String(Math.round(v * 1000) / 1000).replace('.', ','))
const porNumero = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true })
let claveNueva = 0
const lineaVacia = () => ({ clave: ++claveNueva, nombre: '', hechura: '', moneda: 'ARS', metal: '', peso: '' })

// Hechura (con $ / US$), metal y peso de un renglón
function CamposLinea({ v, set }) {
  const f = fino(v.metal, v.peso)
  return (
    <>
      <td data-l="Hechura">
        <div className="con-moneda">
          <SelectorMoneda valor={v.moneda} onChange={(m) => set({ ...v, moneda: m })} />
          <input className="num" inputMode="decimal" value={v.hechura} onChange={(e) => set({ ...v, hechura: e.target.value })} />
        </div>
      </td>
      <td data-l="Metal">
        <select value={v.metal} onChange={(e) => set({ ...v, metal: e.target.value, peso: e.target.value ? v.peso : '' })}>
          <option value="">Sin metal</option>
          {Object.entries(METALES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </td>
      <td data-l={v.metal === 'oro' ? 'Peso 18k (g)' : 'Peso fino (g)'}>
        {v.metal ? <input className="num" inputMode="decimal" placeholder={v.metal === 'oro' ? 'g 18k' : 'g fino'} value={v.peso} onChange={(e) => set({ ...v, peso: e.target.value })} /> : <span className="meta">—</span>}
      </td>
      <td data-l="Fino" className="fino">{v.metal ? (v.metal === 'oro' ? gramosFino(f) : gramos(f)) : '—'}</td>
    </>
  )
}

export default function Facturacion({ params }) {
  const elegidosInicio = (params?.get('sobres') || '').split(',').filter(Boolean)
  const [sobres, setSobres] = useState([]) // todos los listos para facturar
  const [clienteId, setClienteId] = useState(null)
  const [nuevos, setNuevos] = useState([]) // sobres nuevos (piezas fabricadas)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [facturando, setFacturando] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data, error } = await sb.from('vista_trabajos').select('*').eq('estado', 'listo_para_facturar')
    if (error) setError(errorMsg(error))
    const ids = (data || []).map((t) => t.id)
    const porSobre = {}
    if (ids.length) {
      const { data: its } = await sb.from('items').select('id,trabajo_id,numero,nombre,descripcion,estado,presupuesto_hechura,presupuesto_moneda,presupuesto_metal,presupuesto_peso,presupuesto_respuesta').in('trabajo_id', ids).order('numero')
      ;(its || []).forEach((i) => { (porSobre[i.trabajo_id] ||= []).push(i) })
    }
    const lista = (data || []).sort((a, b) => porNumero(a.nro_sobre, b.nro_sobre)).map((t) => {
      const items = porSobre[t.id] || []
      return {
        t,
        sel: elegidosInicio.length ? elegidosInicio.includes(String(t.id)) : true,
        completo: false,
        total: { hechura: '', moneda: 'ARS', metal: '', peso: '' },
        // Cada ítem trae lo que se presupuestó (si tenía)
        items: items.map((i) => ({
          i,
          devolucion: i.estado === 'rechazado',
          v: {
            hechura: txt(i.presupuesto_hechura), moneda: i.presupuesto_moneda || 'ARS',
            metal: i.presupuesto_metal || '', peso: txt(i.presupuesto_peso),
          },
        })),
      }
    })
    setSobres(lista)
    // Cliente: el de los sobres elegidos o, si hay uno solo con sobres listos, ese
    const deElegidos = lista.find((s) => elegidosInicio.includes(String(s.t.id)))
    const clientes = [...new Set(lista.map((s) => s.t.cliente_id))]
    setClienteId((c) => c ?? deElegidos?.t.cliente_id ?? (clientes.length === 1 ? clientes[0] : null))
    setCargando(false)
  }
  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Clientes con sobres para facturar
  const clientes = []
  sobres.forEach((s) => {
    const c = clientes.find((x) => x.id === s.t.cliente_id)
    if (c) c.n++
    else clientes.push({ id: s.t.cliente_id, nombre: s.t.cliente, n: 1 })
  })
  clientes.sort((a, b) => a.nombre.localeCompare(b.nombre))
  const [clientesTodos, setClientesTodos] = useState([])
  useEffect(() => { sb.from('clientes').select('id,nombre').order('nombre').then(({ data }) => setClientesTodos(data || [])) }, [])
  const cliente = clientes.find((c) => c.id === clienteId) || clientesTodos.find((c) => c.id === clienteId)

  const delCliente = sobres.filter((s) => s.t.cliente_id === clienteId)
  const cambiarSobre = (id, campos) => setSobres((xs) => xs.map((s) => (s.t.id === id ? { ...s, ...campos } : s)))
  const cambiarItem = (id, itemId, v) => setSobres((xs) => xs.map((s) => (s.t.id === id ? { ...s, items: s.items.map((x) => (x.i.id === itemId ? { ...x, v } : x)) } : s)))

  function elegirCliente(id) {
    setClienteId(id)
    setNuevos([])
    setError('')
  }

  // Renglones que se van a facturar (para totales y para enviar)
  function renglones() {
    const out = []
    delCliente.filter((s) => s.sel).forEach((s) => {
      if (s.completo) out.push({ sobre: s.t.nro_sobre, desc: 'Sobre completo', v: s.total })
      else s.items.filter((x) => !x.devolucion).forEach((x) => out.push({ sobre: s.t.nro_sobre, desc: x.i.nombre || x.i.descripcion || `Ítem ${x.i.numero}`, v: x.v, item_id: x.i.id, trabajo_id: s.t.id }))
    })
    nuevos.forEach((n) => n.lineas.forEach((l) => out.push({ sobre: n.nro || '(nuevo)', desc: l.nombre || 'Pieza nueva', v: l })))
    return out
  }
  const lineas = renglones()
  const totalH = (m) => lineas.filter((l) => l.v.moneda === m).reduce((s, l) => s + (num(l.v.hechura) || 0), 0)
  const totalMetal = (m) => lineas.filter((l) => l.v.metal === m).reduce((s, l) => s + (fino(l.v.metal, l.v.peso) || 0), 0)

  const aEnviar = (v) => {
    const h = num(v.hechura), p = v.metal ? num(v.peso) : null
    if (Number.isNaN(h) || Number.isNaN(p)) return null
    return { hechura: h, moneda: h === null ? null : v.moneda, metal: v.metal || null, peso: p }
  }

  async function facturar() {
    setError('')
    if (!clienteId) return setError('Elegí el cliente.')
    const sobresEnv = []
    for (const s of delCliente.filter((x) => x.sel)) {
      const ls = []
      if (s.completo) {
        const d = aEnviar(s.total)
        if (!d) return setError(`Revisá los números del sobre ${s.t.nro_sobre}.`)
        ls.push({ item_id: null, descripcion: 'Sobre completo', ...d })
      } else {
        for (const x of s.items.filter((y) => !y.devolucion)) {
          const d = aEnviar(x.v)
          if (!d) return setError(`Revisá los números del sobre ${s.t.nro_sobre} (${x.i.nombre || 'ítem ' + x.i.numero}).`)
          ls.push({ item_id: x.i.id, descripcion: x.i.nombre || x.i.descripcion, ...d })
        }
      }
      sobresEnv.push({ trabajo_id: s.t.id, lineas: ls })
    }
    const nuevosEnv = []
    for (const n of nuevos) {
      if (!n.nro.trim()) return setError('Falta el número del sobre nuevo.')
      const ls = []
      for (const l of n.lineas) {
        const d = aEnviar(l)
        if (!d) return setError(`Revisá los números del sobre nuevo ${n.nro}.`)
        if (!l.nombre.trim()) return setError(`Falta el nombre de una pieza del sobre nuevo ${n.nro}.`)
        ls.push({ nombre: l.nombre, ...d })
      }
      nuevosEnv.push({ nro_sobre: n.nro, lineas: ls })
    }
    const cant = sobresEnv.length + nuevosEnv.length
    if (!cant) return setError('No elegiste ningún sobre.')
    if (!window.confirm(`¿Facturar ${cant} sobre${cant > 1 ? 's' : ''} de ${cliente?.nombre}? Se cargarán en su cuenta.`)) return
    setFacturando(true)
    const { data, error } = await sb.rpc('facturar_cliente', { p: { cliente_id: clienteId, sobres: sobresEnv, nuevos: nuevosEnv } })
    setFacturando(false)
    if (error) return setError(errorMsg(error))
    ir('facturados', { factura: data })
  }

  if (cargando) return <section><h1>Facturación</h1><div className="vacio">Cargando…</div></section>

  return (
    <section>
      <h1>Facturación</h1>

      {/* Cliente que se está facturando */}
      {cliente ? (
        <div className="cliente-facturando" style={{ '--cliente': colorCliente(cliente.id) }}>
          <span className="punto-cliente" />
          <div><span className="meta">Facturando a</span><b>{cliente.nombre}</b></div>
          {(clientes.length > 1 || !clientes.some((c) => c.id === clienteId)) && <button className="btn suave" onClick={() => elegirCliente(null)}>Cambiar cliente</button>}
        </div>
      ) : (
        <div className="elegir-cliente card">
          <b>¿A qué cliente le facturás?</b>
          <p className="ayuda">Cada factura es de un solo cliente.</p>
          <div className="lista-clientes-fact">
            {clientes.map((c) => (
              <button key={c.id} className="btn chip-cliente" style={{ '--cliente': colorCliente(c.id) }} onClick={() => elegirCliente(c.id)}>
                <span className="punto-cliente" />{c.nombre} <span className="contador">{c.n}</span>
              </button>
            ))}
          </div>
          <label className="otro-cliente">Otro cliente (para un sobre nuevo)
            <select value="" onChange={(e) => e.target.value && elegirCliente(Number(e.target.value))}>
              <option value="">Elegir…</option>
              {clientesTodos.filter((c) => !clientes.some((x) => x.id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {cliente && (
        <>
          {delCliente.length === 0 && <div className="vacio">Este cliente no tiene sobres listos para facturar. Podés cargar un sobre nuevo abajo.</div>}

          {delCliente.map((s) => (
            <div key={s.t.id} className={'card sobre-fact' + (s.sel ? '' : ' apagada')}>
              <div className="sobre-fact-cab">
                <label className="check-sobre-fact">
                  <input type="checkbox" checked={s.sel} onChange={(e) => cambiarSobre(s.t.id, { sel: e.target.checked })} />
                  <span className="nro">Sobre {s.t.nro_sobre}</span>
                </label>
                <div className="modo-fact" role="group" aria-label="Cómo facturar">
                  <button className={!s.completo ? 'sel' : ''} onClick={() => cambiarSobre(s.t.id, { completo: false })}>Ítem por ítem</button>
                  <button className={s.completo ? 'sel' : ''} onClick={() => cambiarSobre(s.t.id, { completo: true })}>Sobre completo</button>
                </div>
              </div>
              <div className="tabla-scroll">
                <table className="tabla factura">
                  <thead><tr><th>Ítem</th><th>Hechura</th><th>Metal</th><th>Peso</th><th>Fino</th></tr></thead>
                  <tbody>
                    {s.completo ? (
                      <tr>
                        <td data-l="Ítem"><b>Sobre completo</b><div className="meta">{s.items.filter((x) => !x.devolucion).map((x) => x.i.nombre || x.i.descripcion || `Ítem ${x.i.numero}`).join(' · ')}</div></td>
                        <CamposLinea v={s.total} set={(v) => cambiarSobre(s.t.id, { total: v })} />
                      </tr>
                    ) : s.items.filter((x) => !x.devolucion).map((x) => (
                      <tr key={x.i.id}>
                        <td data-l="Ítem"><b>{x.i.nombre || `Ítem ${x.i.numero}`}</b>{x.i.descripcion && <div className="meta">{x.i.descripcion}</div>}</td>
                        <CamposLinea v={x.v} set={(v) => cambiarItem(s.t.id, x.i.id, v)} />
                      </tr>
                    ))}
                    {s.items.filter((x) => x.devolucion).map((x) => (
                      <tr key={x.i.id} className="fila-devolucion">
                        <td data-l="Ítem"><b>{x.i.nombre || `Ítem ${x.i.numero}`}</b></td>
                        <td colSpan={4} className="devolucion">Devolución (presupuesto no aprobado)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Sobres nuevos: piezas fabricadas, se facturan en el momento */}
          {nuevos.map((n) => (
            <div key={n.clave} className="card sobre-fact nuevo">
              <div className="sobre-fact-cab">
                <label className="nro-nuevo">Sobre nuevo N.º
                  <input inputMode="numeric" value={n.nro} onChange={(e) => setNuevos((xs) => xs.map((y) => (y.clave === n.clave ? { ...y, nro: e.target.value } : y)))} />
                </label>
                <button className="btn-link" onClick={() => setNuevos((xs) => xs.filter((y) => y.clave !== n.clave))}>Quitar</button>
              </div>
              <div className="tabla-scroll">
                <table className="tabla factura">
                  <thead><tr><th>Pieza</th><th>Hechura</th><th>Metal</th><th>Peso</th><th>Fino</th></tr></thead>
                  <tbody>
                    {n.lineas.map((l) => {
                      const set = (v) => setNuevos((xs) => xs.map((y) => (y.clave === n.clave ? { ...y, lineas: y.lineas.map((z) => (z.clave === l.clave ? { ...z, ...v } : z)) } : y)))
                      return (
                        <tr key={l.clave}>
                          <td data-l="Pieza"><input value={l.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej.: Anillo sello" /></td>
                          <CamposLinea v={l} set={set} />
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <button className="btn suave" onClick={() => setNuevos((xs) => xs.map((y) => (y.clave === n.clave ? { ...y, lineas: [...y.lineas, lineaVacia()] } : y)))}>+ Otra pieza en este sobre</button>
            </div>
          ))}
          <button className="btn agregar-item" onClick={() => setNuevos((xs) => [...xs, { clave: ++claveNueva, nro: '', lineas: [lineaVacia()] }])}>+ Sobre nuevo (pieza fabricada)</button>

          <div className="totales card">
            <div><span>Sobres</span><b>{delCliente.filter((s) => s.sel).length + nuevos.length}</b></div>
            <div><span>Hechura $</span><b>{fmtHechura(totalH('ARS'), 'ARS')}</b></div>
            <div><span>Hechura US$</span><b>{fmtHechura(totalH('USD'), 'USD')}</b></div>
            <div><span>Oro fino</span><b>{gramosFino(totalMetal('oro'))}</b></div>
            <div><span>Plata fina</span><b>{gramos(totalMetal('plata'))}</b></div>
            <div><span>Platino</span><b>{gramos(totalMetal('platino'))}</b></div>
          </div>
          <button className="btn primario grande" onClick={facturar} disabled={facturando || (!delCliente.some((s) => s.sel) && !nuevos.length)}>
            {facturando ? 'Facturando…' : `Facturar a ${cliente.nombre}`}
          </button>
        </>
      )}
      {!cliente && clientes.length === 0 && <div className="vacio">No hay sobres listos para facturar.</div>}
    </section>
  )
}
