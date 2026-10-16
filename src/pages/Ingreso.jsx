import { useEffect, useRef, useState } from 'react'
import { sb, TIPOS, cargarListas, errorMsg, ir, num, resolverTallerista } from '../lib'
import { subirFoto } from '../foto'
import { CampoTallerista, CamposPresupuesto } from '../components'

const presVacio = { hechura: '', moneda: 'ARS', metal: 'oro', peso: '' }

export default function Ingreso() {
  const [listas, setListas] = useState({ clientes: [], talleristas: [] })
  const [sobre, setSobre] = useState('')
  const [cliente, setCliente] = useState('')
  const [tipo, setTipo] = useState('taller')
  const [desc, setDesc] = useState('')
  const [tallerista, setTallerista] = useState('')
  const [pres, setPres] = useState(presVacio)
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

    let campos = {}
    if (tipo === 'presupuesto') {
      const h = num(pres.hechura)
      const p = num(pres.peso)
      if (h === null || Number.isNaN(h)) return setMsg({ error: 'Cargá la hechura del presupuesto.' })
      if (Number.isNaN(p)) return setMsg({ error: 'El peso no es un número válido.' })
      campos = { presupuesto_hechura: h, presupuesto_moneda: pres.moneda, presupuesto_metal: pres.metal, presupuesto_peso: p }
    }

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
      const tallId = await resolverTallerista(tallerista, listas.talleristas)
      const { data: t, error } = await sb
        .from('trabajos')
        .insert({
          nro_sobre: sobre.trim(),
          cliente_id: c.id,
          tipo,
          estado: tipo === 'presupuesto' ? 'esperando_confirmacion' : 'taller',
          descripcion: desc.trim() || null,
          tallerista_id: tallId,
          ...campos,
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
      setSobre(''); setCliente(''); setDesc(''); setTallerista(''); setPres(presVacio); setFoto(null); setPreview(null)
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
          {tipo === 'presupuesto' && <p className="ayuda">Queda en estado Pendiente hasta que el cliente acepte o rechace.</p>}
          {tipo === 'trabajo_nuevo' && <p className="ayuda">Pieza nueva que hay que fabricar para el cliente.</p>}
        </fieldset>

        <label>Descripción del trabajo
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>

        {tipo === 'presupuesto' && <CamposPresupuesto v={pres} set={setPres} />}

        <label>Tallerista
          <CampoTallerista valor={tallerista} onChange={setTallerista} talleristas={listas.talleristas} placeholder="Quién va a hacer el trabajo" />
        </label>

        <label>Foto de la pieza
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={elegirFoto} />
        </label>
        {preview && <img src={preview} className="foto-prev" alt="Vista previa" />}

        {msg?.error && <div className="error">{msg.error}</div>}
        {msg?.ok && <div className="ok">{msg.ok} <a href="#/sobres" onClick={(e) => { e.preventDefault(); ir('sobres') }}>Ver sobres</a></div>}

        <button className="btn primario" disabled={guardando}>{guardando ? 'Guardando…' : 'Ingresar sobre'}</button>
      </form>
    </section>
  )
}
