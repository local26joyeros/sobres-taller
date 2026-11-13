import { Fragment, useEffect, useState } from 'react'
import { sb, METALES, cargarListas, errorMsg, fecha, fechaCorta, gramos, hechura, plata } from '../lib'

const COLS = [['hechuras', 'Hechuras ($)', 'p'], ['dolares', 'Dólares', 'p'], ['oro_fino', 'Oro fino', 'g'], ['granalla', 'Granalla', 'g'], ['platino', 'Platino', 'g'], ['plata_fina', 'Plata fina', 'g']]
const valor = (tipo, v) => (!v ? '—' : tipo === 'g' ? gramos(v) : plata(v))

const hoy = () => new Date().toISOString().slice(0, 10)
const haceDias = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

export default function Facturados({ params }) {
  const facturaParam = params.get('factura') || ''
  const [facturas, setFacturas] = useState([])
  const [clientes, setClientes] = useState([])
  const [factura, setFactura] = useState(facturaParam)
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(hoy())
  const [cliente, setCliente] = useState('')
  const [moneda, setMoneda] = useState('')
  const [filas, setFilas] = useState([])
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [saldos, setSaldos] = useState([])

  useEffect(() => {
    sb.from('facturas').select('id,facturado_en').order('id', { ascending: false }).limit(100).then(({ data }) => setFacturas(data || []))
    cargarListas().then((l) => setClientes(l.clientes))
  }, [])
  useEffect(() => { setFactura(facturaParam) }, [facturaParam])

  useEffect(() => {
    (async () => {
      setCargando(true)
      let q = sb.from('factura_lineas')
        .select('*, facturas!inner(facturado_en), trabajos!inner(nro_sobre, cliente_id, clientes(nombre))')
        .order('factura_id').order('id')
      if (factura) q = q.eq('factura_id', Number(factura))
      else q = q.gte('facturas.facturado_en', desde + 'T00:00:00-03:00').lte('facturas.facturado_en', hasta + 'T23:59:59-03:00')
      if (cliente) q = q.eq('trabajos.cliente_id', Number(cliente))
      if (moneda) q = q.or(`moneda.eq.${moneda},devolucion.eq.true`)
      const { data: crudo, error } = await q
      if (error) setError(errorMsg(error))
      // Ordenado por factura y por número de sobre (de menor a mayor); devoluciones al final de cada sobre
      const data = (crudo || []).map((l) => ({ ...l, nro_sobre: l.trabajos?.nro_sobre, cliente_id: l.trabajos?.cliente_id, cliente: l.trabajos?.clientes?.nombre }))
        .sort((a, b) => String(a.cliente).localeCompare(String(b.cliente)) || a.factura_id - b.factura_id || String(a.nro_sobre).localeCompare(String(b.nro_sobre), 'es', { numeric: true }) || a.devolucion - b.devolucion || a.id - b.id)
      setFilas(data)
      // Saldos de cada cliente: lo facturado acá, el saldo anterior y el actualizado
      const ids = [...new Set(data.map((r) => r.trabajo_id))]
      const clis = [...new Set((data || []).map((r) => r.cliente_id))]
      if (ids.length) {
        const { data: movs } = await sb.from('movimientos_cuenta').select('*').in('cliente_id', clis).order('id')
        const res = clis.map((cid) => {
          const delCliente = (movs || []).filter((m) => m.cliente_id === cid)
          const facIds = [...new Set(data.map((r) => r.factura_id))]
          const fact = delCliente.filter((m) => m.tipo === 'facturacion' && ids.includes(m.trabajo_id) && (m.factura_id == null || facIds.includes(m.factura_id)))
          const primero = fact.length ? Math.min(...fact.map((m) => m.id)) : Infinity
          const suma = (lista) => Object.fromEntries(COLS.map(([k]) => [k, lista.reduce((s, m) => s + Number(m[k] || 0), 0)]))
          const facturado = suma(fact), anterior = suma(delCliente.filter((m) => m.id < primero && !fact.includes(m)))
          const actualizado = Object.fromEntries(COLS.map(([k]) => [k, anterior[k] + facturado[k]]))
          return { cid, nombre: (data || []).find((r) => r.cliente_id === cid)?.cliente, facturado, anterior, actualizado }
        })
        setSaldos(res)
      } else setSaldos([])
      setCargando(false)
    })()
  }, [factura, desde, hasta, cliente, moneda])

  const cobradas = filas.filter((r) => !r.devolucion)
  const nSobres = new Set(filas.map((r) => r.trabajo_id)).size
  const sum = (f) => cobradas.reduce((s, r) => s + (Number(f(r)) || 0), 0)
  const fac = facturas.find((f) => String(f.id) === String(factura))
  const nombresEnFilas = [...new Set(filas.map((r) => r.cliente))]
  const nombreCliente = clientes.find((c) => String(c.id) === String(cliente))?.nombre || (nombresEnFilas.length === 1 ? nombresEnFilas[0] : '')
  const variosClientes = !nombreCliente && nombresEnFilas.length > 1
  const Cab = ({ titulo, detalle, nombre }) => (
    <div className="hoja-cab factura-cab">
      <div className="fc-cliente">
        <span className="meta">Cliente</span>
        <b>{nombre || (variosClientes ? 'Varios clientes' : '—')}</b>
      </div>
      <div className="fc-datos">
        <div className="marca">Trabajos <span>Local 26</span></div>
        <b>{titulo}</b>
        <div className="meta">{detalle}</div>
      </div>
    </div>
  )
  const detalleFactura = (fac ? `Factura N.º ${fac.id} — ${fecha(fac.facturado_en)}` : `Del ${fechaCorta(desde + 'T12:00')} al ${fechaCorta(hasta + 'T12:00')}`) +
    (moneda ? ` · Hechura en ${moneda === 'ARS' ? 'pesos' : 'dólares'}` : '')

  return (
    <section>
      <h1 className="no-print">Trabajos facturados</h1>
      <div className="filtros no-print">
        <label>Factura
          <select value={factura} onChange={(e) => setFactura(e.target.value)}>
            <option value="">Por fechas</option>
            {facturas.map((f) => <option key={f.id} value={f.id}>N.º {f.id} — {fecha(f.facturado_en)}</option>)}
          </select>
        </label>
        {!factura && <>
          <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </>}
        <label>Cliente
          <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>Hechura en
          <select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="">Pesos y dólares</option>
            <option value="ARS">Solo pesos</option>
            <option value="USD">Solo dólares</option>
          </select>
        </label>
        <button className="btn primario" onClick={() => window.print()} disabled={!filas.length}>Imprimir</button>
      </div>

      <div className="hoja">
        <Cab titulo={fac ? 'Factura' : 'Trabajos facturados'} detalle={detalleFactura} nombre={nombreCliente} />
        {error && <div className="error">{error}</div>}
        {cargando ? <div className="vacio">Cargando…</div> : filas.length === 0 ? <div className="vacio">No hay trabajos facturados con estos filtros.</div> : (
          <div className="tabla-scroll">
            <table className="tabla impresion fact">
              <thead>
                <tr>
                  <th>N.º sobre</th>
                  <th>Ítem</th>
                  <th className="d">Peso oro 18k</th>
                  <th className="d">Oro fino</th>
                  <th className="d">Plata / platino fino</th>
                  <th className="d">Hechura</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r, i) => {
                  const mismoSobre = i > 0 && filas[i - 1].trabajo_id === r.trabajo_id && filas[i - 1].factura_id === r.factura_id
                  const nuevoCliente = variosClientes && (i === 0 || filas[i - 1].cliente_id !== r.cliente_id)
                  return (<Fragment key={r.id}>
                    {nuevoCliente && <tr className="fila-cliente"><td colSpan={6}>{r.cliente}</td></tr>}
                    <tr className={(r.devolucion ? 'fila-devolucion' : '') + (mismoSobre ? ' sigue-sobre' : '')}>
                      <td><b>{mismoSobre ? '' : r.nro_sobre}</b></td>
                      <td>{r.descripcion || '—'}</td>
                      {r.devolucion ? <td colSpan={4} className="d devolucion">Devolución</td> : <>
                        <td className="d">{r.metal === 'oro' ? gramos(r.peso) : '—'}</td>
                        <td className="d">{r.metal === 'oro' ? gramos(r.peso_fino) : '—'}</td>
                        <td className="d">{r.metal && r.metal !== 'oro' && r.peso_fino != null ? `${gramos(r.peso_fino)} ${METALES[r.metal].toLowerCase()}` : '—'}</td>
                        <td className="d">{hechura(r.hechura, r.moneda)}</td>
                      </>}
                    </tr>
                  </Fragment>)
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Totales ({nSobres} sobre{nSobres === 1 ? '' : 's'})</td>
                  <td className="d">{gramos(sum((r) => (r.metal === 'oro' ? r.peso : 0)))}</td>
                  <td className="d">{gramos(sum((r) => (r.metal === 'oro' ? r.peso_fino : 0)))}</td>
                  <td className="d">
                    {sum((r) => (r.metal === 'plata' ? r.peso_fino : 0)) > 0 && <div>{gramos(sum((r) => (r.metal === 'plata' ? r.peso_fino : 0)))} plata</div>}
                    {sum((r) => (r.metal === 'platino' ? r.peso_fino : 0)) > 0 && <div>{gramos(sum((r) => (r.metal === 'platino' ? r.peso_fino : 0)))} platino</div>}
                  </td>
                  <td className="d">
                    {moneda !== 'USD' && <div>$ {plata(sum((r) => (r.moneda === 'ARS' ? r.hechura : 0)))}</div>}
                    {moneda !== 'ARS' && <div>US$ {plata(sum((r) => (r.moneda === 'USD' ? r.hechura : 0)))}</div>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!cargando && saldos.map((c) => {
          const cols = COLS.filter(([k]) => c.anterior[k] || c.facturado[k] || c.actualizado[k])
          if (!cols.length) return null
          return (
            <div key={c.cid} className="saldo-cliente hoja-aparte">
              <Cab titulo="Saldo a la fecha" detalle={fecha(new Date().toISOString())} nombre={c.nombre} />
              <table className="tabla impresion fact">
                <thead><tr><th></th>{cols.map(([k, t]) => <th key={k} className="d">{t}</th>)}</tr></thead>
                <tbody>
                  <tr><td>Lo facturado ahora</td>{cols.map(([k, , tipo]) => <td key={k} className="d">{valor(tipo, c.facturado[k])}</td>)}</tr>
                  <tr><td>Saldo anterior</td>{cols.map(([k, , tipo]) => <td key={k} className="d">{valor(tipo, c.anterior[k])}</td>)}</tr>
                </tbody>
                <tfoot>
                  <tr><td>Saldo total actualizado</td>{cols.map(([k, , tipo]) => <td key={k} className="d">{valor(tipo, c.actualizado[k])}</td>)}</tr>
                </tfoot>
              </table>
            </div>
          )
        })}
      </div>
    </section>
  )
}
