import { useEffect, useState } from 'react'
import { sb, errorMsg } from '../lib'

export default function Talleristas() {
  const [lista, setLista] = useState([])
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState('')
  const [carga, setCarga] = useState({})

  async function cargar() {
    const [{ data }, { data: t }] = await Promise.all([
      sb.from('talleristas').select('*').order('nombre'),
      sb.from('trabajos').select('tallerista_id').eq('estado', 'taller'),
    ])
    setLista(data || [])
    const c = {}
    ;(t || []).forEach((r) => { if (r.tallerista_id) c[r.tallerista_id] = (c[r.tallerista_id] || 0) + 1 })
    setCarga(c)
  }
  useEffect(() => { cargar() }, [])

  async function agregar(e) {
    e.preventDefault()
    setError('')
    const { error } = await sb.from('talleristas').insert({ nombre: nombre.trim() })
    if (error) return setError(errorMsg(error))
    setNombre('')
    cargar()
  }

  async function alternar(t) {
    await sb.from('talleristas').update({ activo: !t.activo }).eq('id', t.id)
    cargar()
  }

  return (
    <section>
      <h1>Talleristas</h1>
      <form className="card mini-form" onSubmit={agregar}>
        <input placeholder="Nombre del tallerista" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        <button className="btn primario">Agregar</button>
      </form>
      {error && <div className="error">{error}</div>}
      <table className="tabla">
        <thead><tr><th>Tallerista</th><th className="d">Sobres en taller</th><th></th></tr></thead>
        <tbody>
          {lista.map((t) => (
            <tr key={t.id} className={t.activo ? '' : 'apagada'}>
              <td><b>{t.nombre}</b>{!t.activo && ' (inactivo)'}</td>
              <td className="d">{carga[t.id] ? <a href={'#/sobres?tab=taller'}>{carga[t.id]}</a> : '—'}</td>
              <td className="d"><button className="btn suave" onClick={() => alternar(t)}>{t.activo ? 'Desactivar' : 'Activar'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {lista.length === 0 && <div className="vacio">Todavía no cargaste talleristas.</div>}
    </section>
  )
}
