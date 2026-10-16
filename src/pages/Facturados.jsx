import { useEffect, useState } from 'react'
import { sb, METALES, cargarListas, errorMsg, fecha, fechaCorta, gramos, hechura, plata } from '../lib'

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

  useEffect(() => {
    sb.from('facturas').select('id,facturado_en').order('id', { ascending: false }).limit(100).then(({ data }) => setFacturas(data || []))
    cargarListas().then((l) => setClientes(l.clientes))
  }, [])
  useEffect(() => { setFactura(facturaParam) }, [facturaParam])

  useEffect(() => {
    (async () => {
      setCargando(true)
      let q = sb.from('vista_trabajos').select('*').not('factura_id', 'is', null).order('facturado_en').order('nro_sobre')
      if (factura) q = q.eq('factura_id', Number(factura))
      else {
        q = q.gte('facturado_en', desde + 'T00:00:00-03:00').lte('facturado_en', hasta + 'T23:59:59-03:00')
      }
      if (cliente) q = q.eq('cliente_id', Number(cliente))
      if (moneda) q = q.eq('hechura_moneda', moneda)
      const { data, error } = await q
      if (error) setError(errorMsg(error))
      setFilas(data || [])
      setCargando(false)
    })()
  }, [factura, desde, hasta, cliente, moneda])

  const sum = (f) => filas.reduce((s, r) => s + (Number(f(r)) || 0), 0)
  const fac = facturas.find((f) => String(f.id) === String(factura))
  const nombreCliente = clientes.find((c) => String(c.id) === String(cliente))?.nombre

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
        <div className="hoja-cab">
          <div className="marca">Trabajos <span>Local 26</span></div>
          <div>
            <b>Trabajos facturados</b>
            <div className="meta">
              {fac ? `Factura N.º ${fac.id} — ${fecha(fac.facturado_en)}` : `Del ${fechaCorta(desde + 'T12:00')} al ${fechaCorta(hasta + 'T12:00')}`}
              {nombreCliente ? ` · ${nombreCliente}` : ''}
              {moneda ? ` · Hechura en ${moneda === 'ARS' ? 'pesos' : 'dólares'}` : ''}
            </div>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {cargando ? <div className="vacio">Cargando…</div> : filas.length === 0 ? <div className="vacio">No hay trabajos facturados con estos filtros.</div> : (
          <div className="tabla-scroll">
            <table className="tabla impresion">
              <thead>
                <tr>
                  <th>N.º sobre</th>
                  {!cliente && <th>Cliente</th>}
                  <th className="d">Peso oro 18k</th>
                  <th className="d">Oro fino</th>
                  <th className="d">Plata / platino fino</th>
                  <th className="d">Hechura</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.nro_sobre}</b></td>
                    {!cliente && <td>{r.cliente}</td>}
                    <td className="d">{r.metal === 'oro' ? gramos(r.peso) : '—'}</td>
                    <td className="d">{r.metal === 'oro' ? gramos(r.peso_fino) : '—'}</td>
                    <td className="d">{r.metal !== 'oro' && r.peso_fino != null ? `${gramos(r.peso_fino)} ${METALES[r.metal].toLowerCase()}` : '—'}</td>
                    <td className="d">{hechura(r.hechura, r.hechura_moneda)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={cliente ? 1 : 2}>Totales ({filas.length} sobres)</td>
                  <td className="d">{gramos(sum((r) => (r.metal === 'oro' ? r.peso : 0)))}</td>
                  <td className="d">{gramos(sum((r) => (r.metal === 'oro' ? r.peso_fino : 0)))}</td>
                  <td className="d">
                    {sum((r) => (r.metal === 'plata' ? r.peso_fino : 0)) > 0 && <div>{gramos(sum((r) => (r.metal === 'plata' ? r.peso_fino : 0)))} plata</div>}
                    {sum((r) => (r.metal === 'platino' ? r.peso_fino : 0)) > 0 && <div>{gramos(sum((r) => (r.metal === 'platino' ? r.peso_fino : 0)))} platino</div>}
                  </td>
                  <td className="d">
                    {moneda !== 'USD' && <div>$ {plata(sum((r) => (r.hechura_moneda === 'ARS' ? r.hechura : 0)))}</div>}
                    {moneda !== 'ARS' && <div>US$ {plata(sum((r) => (r.hechura_moneda === 'USD' ? r.hechura : 0)))}</div>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
