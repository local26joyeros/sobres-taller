import { useEffect, useState } from 'react'
import { sb, METALES, MONEDAS, errorMsg, fecha, gramos, num, fino, ir } from '../lib'

export default function Facturacion() {
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [facturando, setFacturando] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data, error } = await sb.from('vista_trabajos').select('*').eq('estado', 'listo_para_facturar').order('nro_sobre')
    if (error) setError(errorMsg(error))
    setFilas((data || []).map((t) => ({
      t,
      sel: true,
      hechura: t.hechura != null ? String(t.hechura).replace('.', ',') : '',
      moneda: t.hechura_moneda || 'ARS',
      metal: t.metal || 'oro',
      peso: t.peso != null ? String(t.peso).replace('.', ',') : '',
    })))
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const cambiar = (i, campo, v) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [campo]: v } : f)))
  const elegidas = filas.filter((f) => f.sel)

  async function facturar() {
    setError('')
    const items = []
    for (const f of elegidas) {
      const h = num(f.hechura)
      const p = num(f.peso)
      if (h === null || Number.isNaN(h)) return setError(`Falta la hechura del sobre ${f.t.nro_sobre}.`)
      if (Number.isNaN(p)) return setError(`El peso del sobre ${f.t.nro_sobre} no es válido.`)
      items.push({ trabajo_id: f.t.id, hechura: h, hechura_moneda: f.moneda, metal: f.metal, peso: p })
    }
    if (!items.length) return setError('No elegiste ningún sobre.')
    if (!window.confirm(`¿Facturar ${items.length} sobre${items.length > 1 ? 's' : ''}? Se cargarán en la cuenta de cada cliente.`)) return
    setFacturando(true)
    const { data, error } = await sb.rpc('facturar_lote', { p_items: items })
    setFacturando(false)
    if (error) return setError(errorMsg(error))
    ir('facturados', { factura: data })
  }

  const tot = (metal) => elegidas.filter((f) => f.metal === metal).reduce((s, f) => s + (fino(f.metal, f.peso) || 0), 0)
  const totH = (m) => elegidas.filter((f) => f.moneda === m).reduce((s, f) => s + (num(f.hechura) || 0), 0)

  return (
    <section>
      <h1>Facturación</h1>
      <p className="ayuda">Acá aparecen todos los sobres en <b>Listo para facturar</b>. Completá o corregí hechura, metal y peso, y facturalos juntos. Para el oro cargá el peso en 18k: el oro fino se calcula solo (× 0,825). Para plata y platino el peso que cargás ya es fino.</p>
      {error && <div className="error">{error}</div>}
      {cargando ? <div className="vacio">Cargando…</div> : filas.length === 0 ? (
        <div className="vacio">No hay sobres listos para facturar.</div>
      ) : (
        <>
          <div className="tabla-scroll">
            <table className="tabla factura">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={elegidas.length === filas.length} onChange={(e) => setFilas(filas.map((f) => ({ ...f, sel: e.target.checked })))} /></th>
                  <th>Sobre</th><th>Cliente</th><th>Hechura</th><th>Moneda</th><th>Metal</th><th>Peso</th><th>Fino</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={f.t.id} className={f.sel ? '' : 'apagada'}>
                    <td><input type="checkbox" checked={f.sel} onChange={(e) => cambiar(i, 'sel', e.target.checked)} /></td>
                    <td data-l="Sobre"><b>{f.t.nro_sobre}</b><div className="meta">{f.t.descripcion}</div>{f.t.presupuesto_respuesta === 'aceptado' && <div className="meta">Con presupuesto aprobado</div>}{f.t.presupuesto_respuesta === 'rechazado' && <div className="meta rechazo">Presupuesto rechazado</div>}</td>
                    <td data-l="Cliente">{f.t.cliente}<div className="meta">{fecha(f.t.ingresado_en)}</div></td>
                    <td data-l="Hechura"><input className="num" inputMode="decimal" value={f.hechura} onChange={(e) => cambiar(i, 'hechura', e.target.value)} /></td>
                    <td data-l="Moneda">
                      <select value={f.moneda} onChange={(e) => cambiar(i, 'moneda', e.target.value)}>
                        {Object.entries(MONEDAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td data-l="Metal">
                      <select value={f.metal} onChange={(e) => cambiar(i, 'metal', e.target.value)}>
                        {Object.entries(METALES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td data-l={f.metal === 'oro' ? 'Peso 18k (g)' : 'Peso fino (g)'}>
                      <input className="num" inputMode="decimal" placeholder={f.metal === 'oro' ? 'g 18k' : 'g fino'} value={f.peso} onChange={(e) => cambiar(i, 'peso', e.target.value)} />
                    </td>
                    <td data-l="Fino" className="fino">{gramos(fino(f.metal, f.peso))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="totales card">
            <div><span>Sobres</span><b>{elegidas.length}</b></div>
            <div><span>Hechura $</span><b>{totH('ARS').toLocaleString('es-AR', { minimumFractionDigits: 2 })}</b></div>
            <div><span>Hechura US$</span><b>{totH('USD').toLocaleString('es-AR', { minimumFractionDigits: 2 })}</b></div>
            <div><span>Oro fino</span><b>{gramos(tot('oro'))}</b></div>
            <div><span>Plata fina</span><b>{gramos(tot('plata'))}</b></div>
            <div><span>Platino</span><b>{gramos(tot('platino'))}</b></div>
          </div>
          <button className="btn primario grande" onClick={facturar} disabled={facturando || !elegidas.length}>
            {facturando ? 'Facturando…' : `Facturar ${elegidas.length} sobre${elegidas.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </section>
  )
}
