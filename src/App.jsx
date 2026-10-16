import { useEffect, useState } from 'react'
import { sb, errorMsg } from './lib'
import Ingreso from './pages/Ingreso'
import Sobres from './pages/Sobres'
import Facturacion from './pages/Facturacion'
import Facturados from './pages/Facturados'
import Clientes from './pages/Clientes'
import Talleristas from './pages/Talleristas'

const PAGINAS = [
  ['ingreso', 'Nuevo ingreso'],
  ['sobres', 'Sobres'],
  ['facturacion', 'Facturación'],
  ['facturados', 'Facturados'],
  ['clientes', 'Clientes'],
  ['talleristas', 'Talleristas'],
]

function leerHash() {
  const [p, q] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { pagina: PAGINAS.some(([k]) => k === p) ? p : 'sobres', params: new URLSearchParams(q || '') }
}

function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [cargando, setCargando] = useState(false)
  async function entrar(e) {
    e.preventDefault()
    setCargando(true)
    setErr('')
    const { error } = await sb.auth.signInWithPassword({ email, password: pass })
    if (error) setErr(errorMsg(error))
    setCargando(false)
  }
  return (
    <div className="login">
      <form onSubmit={entrar} className="card login-card">
        <div className="marca grande">Sobres<span>·</span>Taller</div>
        <label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Contraseña<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} required /></label>
        {err && <div className="error">{err}</div>}
        <button className="btn primario" disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}

export default function App() {
  const [sesion, setSesion] = useState(undefined)
  const [ruta, setRuta] = useState(leerHash())
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSesion(s))
    const onHash = () => { setRuta(leerHash()); setMenu(false); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => { data.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash) }
  }, [])

  if (sesion === undefined) return <div className="cargando">Cargando…</div>
  if (!sesion) return <Login />

  async function cambiarClave() {
    const nueva = window.prompt('Nueva contraseña (mínimo 8 caracteres):')
    if (!nueva) return
    if (nueva.length < 8) return window.alert('La contraseña tiene que tener al menos 8 caracteres.')
    const { error } = await sb.auth.updateUser({ password: nueva })
    window.alert(error ? 'No se pudo cambiar: ' + errorMsg(error) : 'Contraseña cambiada.')
  }

  const { pagina, params } = ruta
  return (
    <div className="app">
      <header className="barra no-print">
        <div className="marca">Sobres<span>·</span>Taller</div>
        <button className="hamburguesa" onClick={() => setMenu(!menu)} aria-label="Menú">☰</button>
        <nav className={menu ? 'abierto' : ''}>
          {PAGINAS.map(([k, t]) => (
            <a key={k} href={'#/' + k} className={pagina === k ? 'activo' : ''}>{t}</a>
          ))}
          <button className="salir" onClick={cambiarClave}>Contraseña</button>
          <button className="salir" style={{ marginLeft: 0 }} onClick={() => sb.auth.signOut()}>Salir</button>
        </nav>
      </header>
      <main>
        {pagina === 'ingreso' && <Ingreso />}
        {pagina === 'sobres' && <Sobres params={params} />}
        {pagina === 'facturacion' && <Facturacion />}
        {pagina === 'facturados' && <Facturados params={params} />}
        {pagina === 'clientes' && <Clientes params={params} />}
        {pagina === 'talleristas' && <Talleristas />}
      </main>
    </div>
  )
}
