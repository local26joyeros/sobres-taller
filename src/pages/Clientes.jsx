import { useEffect, useState, useCallback } from 'react'
import { sb, ESTADOS, errorMsg, fecha, fechaCorta, gramos, plata, num, ir } from '../lib'

const COLS = [
  ['hechuras', 'Hechuras ($)', 'p'],
  ['dolares', 'Dólares', 'p'],
  ['oro_fino', 'Oro fino', 'g'],
  ['granalla', 'Granalla', 'g'],
  ['platino', 'Platino', 'g'],
  ['plata_fina', 'Plata fina', 'g'],
]
const fmt = (tipo, v) => (tipo === 'g' ? gramos(v) : plata(v))
const TIPOS_MOV = {
  apertura: 'Saldo inicial',
  facturacion: 'Facturación',
  pago: 'Pago',
  entrega_metal: 'Entrega de metal',
  ajuste: 'Ajuste',
}

export default function Clientes({ params }) {
  const id = params.get('id')
  return id ? <Cuenta id={Number(id)} /> : <ListaClientes />
}

function ListaClientes() {
  const [filas, setFilas] = useState([])
  const [buscar, setBuscar] = useState('')
  const [nuevo, setNuevo] = useState({ nombre: '', telefono: '' })
  const [error, setError] = useState('')

  const cargar = () => sb.from('saldos_clientes').select('*').order('nombre').then(({ data, error }) => {
    if (error) setError(errorMsg(error))
    setFilas(data || [])
  })
  useEffect(() => { cargar() }, [])

  async function agregar(e) {
    e.preventDefault()
    setError('')
    const { error } = await sb.from('clientes').insert({ nombre: nuevo.nombre.trim(), telefono: nuevo.telefono.trim() || null })
    if (error) return setError(errorMsg(error))
    setNuevo({ nombre: '', telefono: '' })
    cargar()
  }

  const b = buscar.trim().toLowerCase()
  const visibles = filas.filter((f) => !b || f.nombre.toLowerCase().includes(b))

  return (
    <section>
      <h1>Clientes</h1>
      <form className="card mini-form" onSubmit={agregar}>
        <input placeholder="Nombre del cliente nuevo" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} required />
        <input placeholder="Teléfono (opcional)" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} />
        <button className="btn primario">Agregar cliente</button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="filtros no-print">
        <input placeholder="Buscar cliente" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <button className="btn" onClick={() => window.print()}>Imprimir saldos</button>
      </div>
      <p className="ayuda">Saldos: positivo = el cliente debe · negativo = a favor del cliente.</p>
      <div className="tabla-scroll">
        <table className="tabla impresion">
          <thead><tr><th>Cliente</th>{COLS.map(([k, t]) => <th key={k} className="d">{t}</th>)}</tr></thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.cliente_id} className="clic" onClick={() => ir('clientes', { id: f.cliente_id })}>
                <td><b>{f.nombre}</b></td>
                {COLS.map(([k, , t]) => <td key={k} className={'d' + (Number(f[k]) < 0 ? ' negativo' : '')}>{Number(f[k]) ? fmt(t, f[k]) : '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visibles.length === 0 && <div className="vacio">Todavía no hay clientes.</div>}
    </section>
  )
}

const vacio = { tipo: 'pago', hechuras: '', dolares: '', oro_fino: '', granalla: '', platino: '', plata_fina: '', nota: '', fecha: '' }

function Cuenta({ id }) {
  const [cli, setCli] = useState(null)
  const [saldo, setSaldo] = useState(null)
  const [movs, setMovs] = useState([])
  const [sobres, setSobres] = useState([])
  const [form, setForm] = useState(vacio)
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const cargar = useCallback(async () => {
    const [c, s, m, t] = await Promise.all([
      sb.from('clientes').select('*').eq('id', id).single(),
      sb.from('saldos_clientes').select('*').eq('cliente_id', id).single(),
      sb.from('movimientos_cuenta').select('*').eq('cliente_id', id).order('fecha').order('id'),
      sb.from('trabajos').select('id,nro_sobre,estado,ingresado_en,descripcion').eq('cliente_id', id).neq('estado', 'entregado').order('ingresado_en', { ascending: false }),
    ])
    if (c.error) setError(errorMsg(c.error))
    setCli(c.data); setSaldo(s.data); setMovs(m.data || []); setSobres(t.data || [])
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  const resta = form.tipo === 'pago' || form.tipo === 'entrega_metal'

  async function registrar(e) {
    e.preventDefault()
    setError(''); setOk('')
    const fila = { cliente_id: id, tipo: form.tipo, nota: form.nota.trim() || null }
    if (form.fecha) fila.fecha = form.fecha + 'T12:00:00-03:00'
    let alguno = false
    for (const [k] of COLS) {
      const v = num(form[k])
      if (Number.isNaN(v)) return setError('Hay un valor que no es un número.')
      const n = v === null ? 0 : (resta ? -Math.abs(v) : v)
      if (n) alguno = true
      fila[k] = n
    }
    if (!alguno) return setError('Cargá al menos un importe.')
    const { error } = await sb.from('movimientos_cuenta').insert(fila)
    if (error) return setError(errorMsg(error))
    setForm({ ...vacio, tipo: form.tipo })
    setOk('Movimiento registrado.')
    cargar()
  }

  async function borrarMov(m) {
    if (!window.confirm('¿Borrar este movimiento de la cuenta?')) return
    const { error } = await sb.from('movimientos_cuenta').delete().eq('id', m.id)
    if (error) return setError(errorMsg(error))
    cargar()
  }

  async function guardarCliente(e) {
    e.preventDefault()
    const { error } = await sb.from('clientes').update({ nombre: edit.nombre.trim(), telefono: edit.telefono?.trim() || null, notas: edit.notas?.trim() || null }).eq('id', id)
    if (error) return setError(errorMsg(error))
    setEdit(null); cargar()
  }

  if (!cli) return <section><a href="#/clientes" className="volver no-print">← Clientes</a>{error ? <div className="error">{error}</div> : <div className="vacio">Cargando…</div>}</section>

  let acum = Object.fromEntries(COLS.map(([k]) => [k, 0]))

  return (
    <section>
      <a href="#/clientes" className="volver no-print">← Clientes</a>
      <div className="hoja">
        <div className="hoja-cab">
          <div className="marca">Trabajos <span>Local 26</span></div>
          <div><b>Estado de cuenta</b><div className="meta">Emitido {fecha(new Date())}</div></div>
        </div>
        <div className="titulo-cliente">
          <h1>{cli.nombre}</h1>
          <div className="no-print">
            <button className="btn suave" onClick={() => setEdit({ ...cli })}>Editar datos</button>
            <button className="btn primario" onClick={() => window.print()}>Imprimir</button>
          </div>
        </div>
        {(cli.telefono || cli.notas) && <div className="meta">{cli.telefono}{cli.telefono && cli.notas ? ' · ' : ''}{cli.notas}</div>}

        {edit && (
          <form className="card mini-form no-print" onSubmit={guardarCliente}>
            <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} required />
            <input placeholder="Teléfono" value={edit.telefono || ''} onChange={(e) => setEdit({ ...edit, telefono: e.target.value })} />
            <input placeholder="Notas" value={edit.notas || ''} onChange={(e) => setEdit({ ...edit, notas: e.target.value })} />
            <button className="btn primario">Guardar</button>
            <button type="button" className="btn suave" onClick={() => setEdit(null)}>Cancelar</button>
          </form>
        )}

        <div className="saldos">
          {COLS.map(([k, t, tipo]) => (
            <div key={k} className={'saldo' + (Number(saldo?.[k]) < 0 ? ' negativo' : '')}>
              <span>{t}</span><b>{fmt(tipo, saldo?.[k] || 0)}</b>
            </div>
          ))}
        </div>
        <p className="ayuda">Positivo = el cliente debe · negativo = a favor del cliente.</p>

        <h2>Movimientos</h2>
        <div className="tabla-scroll">
          <table className="tabla impresion movs">
            <thead><tr><th>Fecha</th><th>Concepto</th>{COLS.map(([k, t]) => <th key={k} className="d">{t}</th>)}<th className="no-print"></th></tr></thead>
            <tbody>
              {movs.map((m) => {
                COLS.forEach(([k]) => { acum[k] += Number(m[k]) })
                return (
                  <tr key={m.id}>
                    <td>{fechaCorta(m.fecha)}</td>
                    <td>{TIPOS_MOV[m.tipo]}{m.nota ? <div className="meta">{m.nota}</div> : null}</td>
                    {COLS.map(([k, , t]) => <td key={k} className={'d' + (Number(m[k]) < 0 ? ' negativo' : '')}>{Number(m[k]) ? fmt(t, m[k]) : ''}</td>)}
                    <td className="no-print">{m.tipo !== 'facturacion' && <button className="btn-link" onClick={() => borrarMov(m)} title="Borrar">×</button>}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Saldo</td>{COLS.map(([k, , t]) => <td key={k} className="d">{fmt(t, acum[k])}</td>)}<td className="no-print"></td></tr>
            </tfoot>
          </table>
        </div>
        {movs.length === 0 && <div className="vacio">Sin movimientos. Si este cliente ya tenía saldo, cargalo abajo como “Saldo inicial”.</div>}
      </div>

      <form className="card form no-print" onSubmit={registrar}>
        <h2>Registrar movimiento</h2>
        <div className="opciones">
          {[['pago', 'Pago'], ['apertura', 'Saldo inicial'], ['ajuste', 'Ajuste']].map(([k, t]) => (
            <label key={k} className={'opcion' + (form.tipo === k ? ' sel' : '')}>
              <input type="radio" checked={form.tipo === k} onChange={() => setForm({ ...form, tipo: k })} />{t}
            </label>
          ))}
        </div>
        <p className="ayuda">
          {resta ? 'Cargá los importes en positivo: se descuentan del saldo del cliente.' : 'Cargá en positivo lo que el cliente debe, y en negativo (con “-”) lo que tiene a favor.'}
        </p>
        <div className="grilla6">
          {COLS.map(([k, t, tipo]) => (
            <label key={k}>{t}{tipo === 'g' ? ' (g)' : ''}
              <input inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="fila2">
          <label>Fecha (si no es hoy)<input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></label>
          <label>Nota<input value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} /></label>
        </div>
        {error && <div className="error">{error}</div>}
        {ok && <div className="ok">{ok}</div>}
        <button className="btn primario">Registrar</button>
      </form>

      {sobres.length > 0 && (
        <div className="no-print">
          <h2>Sobres en curso</h2>
          <table className="tabla">
            <tbody>
              {sobres.map((s) => (
                <tr key={s.id}><td><b>{s.nro_sobre}</b></td><td>{ESTADOS[s.estado]}</td><td className="meta">{s.descripcion}</td><td>{fechaCorta(s.ingresado_en)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
