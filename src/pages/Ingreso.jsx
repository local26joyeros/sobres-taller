import { useEffect, useRef, useState } from 'react'
import { sb, TIPOS, cargarListas, errorMsg, ir } from '../lib'
import { subirFoto } from '../foto'

export default function Ingreso() {
  const [listas, setListas] = useState({ clientes: [], talleristas: [] })
  const [sobre, setSobre] = useState('')
  const [cliente, setCliente] = useState('')
  const [tipo, setTipo] = useState('taller')
  const [desc, setDesc] = useState('')
  const [tallerista, setTallerista] = useState('')
  const [foto, setFoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const fileRef = useRef()

  useEffect(() => { cargarListas().then(setListas) }, [])

  function elegirFoto(e) {
    const f = e.target.files?.[0]
    setFoto(f || null)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function guardar(e) {
    e.preventDefault()
    setMsg(null)
    const nombre = cliente.trim()
    if (!nombre) return setMsg({ error: 'Elegí o escribí el cliente.' })
    setGuardando(true)
    try {
      let c = listas.clientes.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase())
      if (!c) {
        if (!window.confirm(`"${nombre}" no está registrado. ¿Lo agrego como cliente nuevo?`)) {
          setGuardando(false)
          return
        }
        const { data, error } = await sb.from('clientes').insert({ nombre }).select('id,nombre').single()
        if (error) throw error
        c = data
      }
      const { data: t, error } = await sb
        .from('trabajos')
        .insert({
          nro_sobre: sobre.trim(),
          cliente_id: c.id,
          tipo,
          estado: tipo === 'presupuesto' ? 'presupuesto' : 'taller',
          descripcion: desc.trim() || null,
          tallerista_id: tipo !== 'presupuesto' && tallerista ? Number(tallerista) : null,
        })
        .select('id,nro_sobre')
        .single()
      if (error) throw error
      if (foto) {
        try { await subirFoto(t.id, foto) } catch (e2) {
          setMsg({ error: `El sobre ${t.nro_sobre} se guardó, pero la foto no se pudo subir: ${errorMsg(e2)}` })
        }
      }
      setMsg((m) => m || { ok: `Sobre ${t.nro_sobre} ingresado para ${c.nombre}.` })
      setSobre(''); setCliente(''); setDesc(''); setTallerista(''); setFoto(null); setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
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
          <p className="ayuda">
            {tipo === 'presupuesto' && 'El cliente quiere un presupuesto antes de confirmar el trabajo.'}
            {tipo === 'taller' && 'Compostura sin confirmación previa: va directo al taller.'}
            {tipo === 'trabajo_nuevo' && 'Pieza nueva que hay que fabricar para el cliente. Va directo al taller.'}
          </p>
        </fieldset>

        <label>Descripción del trabajo
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>

        {tipo !== 'presupuesto' && (
          <label>Tallerista
            <select value={tallerista} onChange={(e) => setTallerista(e.target.value)}>
              <option value="">— Elegir después —</option>
              {listas.talleristas.filter((t) => t.activo).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            {listas.talleristas.length === 0 && <span className="ayuda">Todavía no cargaste talleristas. Podés hacerlo en <a href="#/talleristas">Talleristas</a>.</span>}
          </label>
        )}

        <label>Foto de la pieza
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={elegirFoto} />
        </label>
        {preview && <img src={preview} className="foto-prev" alt="Vista previa" />}

        {msg?.error && <div className="error">{msg.error}</div>}
        {msg?.ok && <div className="ok">{msg.ok} <a href="#/sobres" onClick={(e) => { e.preventDefault(); ir('sobres') }}>Ver sobres</a></div>}

        <button className="btn primario" disabled={guardando}>{guardando ? 'Guardando…' : 'Ingresar sobre'}</button>
        <p className="ayuda">La fecha y hora de ingreso se registran automáticamente.</p>
      </form>
    </section>
  )
}
