import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { sb, errorMsg } from './lib'
import Ingreso from './pages/Ingreso'
import Sobres from './pages/Sobres'
import Facturacion from './pages/Facturacion'
import Facturados from './pages/Facturados'
import Clientes from './pages/Clientes'
import Talleristas from './pages/Talleristas'

const PAGINAS = [
  ['sobres', 'Sobres'],
  ['ingreso', 'Nuevo ingreso'],
  ['facturacion', 'Facturación'],
  ['facturados', 'Facturados'],
  ['clientes', 'Clientes'],
  ['talleristas', 'Talleristas'],
]

// Al abrir la app siempre se arranca en Inicio
if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)

function leerHash() {
  const [p, q] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { pagina: PAGINAS.some(([k]) => k === p) ? p : 'sobres', params: new URLSearchParams(q || '') }
}

// Barra común a los tres sistemas. Si Sobres se abre en su propia dirección, los enlaces van a la dirección común.
const HUB = /^sobres-taller/.test(window.location.hostname) ? 'https://local26.vercel.app' : ''
function Sistemas() {
  return (
    <nav className="sistemas no-print" aria-label="Sistemas">
      <a className="sis-marca" href={HUB + '/'}><i /><span>Local 26</span></a>
      <a className="sis-tab" href={HUB + '/movimientos'}>Movimientos</a>
      <a className="sis-tab activo" href={HUB + '/sobres/'}>Sobres</a>
      <a className="sis-tab" href={HUB + '/pagos/'}>Vencimientos y pagos</a>
    </nav>
  )
}

// Login único: la sesión es la de Taller - Movimientos (local26.vercel.app). Sobres la usa para entrar solo.
const hub = createBrowserClient('https://rcrbdlrrswkvljkzprpp.supabase.co', 'sb_publishable_vmM9ijMMy7hmNMOW6m5oXA_wYokmmlL')

async function entrarConMovimientos() {
  const { data } = await hub.auth.getSession()
  const token = data.session?.access_token
  if (!token) { window.location.href = '/login?volver=/sobres/'; return 'sin-sesion' }
  const { data: r, error } = await sb.functions.invoke('entrar-con-movimientos', { body: { token } })
  if (error || !r?.token_hash) throw new Error(r?.error || error?.message || 'No pude entrar')
  const v = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' })
  if (v.error) throw v.error
  return 'ok'
}

async function salir() {
  await Promise.allSettled([sb.auth.signOut(), hub.auth.signOut()])
  window.location.href = '/login'
}

function Entrando({ error, reintentar }) {
  return (
    <>
      <Sistemas />
      <div className="login">
        <div className="card login-card">
          <div className="marca grande">Sobres</div>
          {error
            ? <><div className="error">{error}</div><button className="btn primario" onClick={reintentar}>Reintentar</button></>
            : <p className="meta">Entrando…</p>}
        </div>
      </div>
    </>
  )
}

export default function App() {
  const [sesion, setSesion] = useState(undefined)
  const [ruta, setRuta] = useState(leerHash())
  const [menu, setMenu] = useState(false)

  const [errorSso, setErrorSso] = useState('')

  async function conectar() {
    setErrorSso('')
    try {
      // Siempre se sigue a la sesión de Movimientos: si allá es otra persona o no hay sesión, se rehace
      const [{ data: h }, { data: s }] = await Promise.all([hub.auth.getSession(), sb.auth.getSession()])
      if (!h.session) { await sb.auth.signOut(); window.location.href = '/login?volver=/sobres/'; return }
      if (s.session && s.session.user.email?.toLowerCase() === h.session.user.email?.toLowerCase()) { setSesion(s.session); return }
      if (s.session) await sb.auth.signOut()
      await entrarConMovimientos()
    } catch (e) { setErrorSso(errorMsg(e)) }
  }

  useEffect(() => {
    // Abierto en su dirección propia: se pasa a la dirección común, donde está el login único
    if (HUB) { window.location.replace(HUB + '/sobres/' + window.location.hash); return }
    conectar()
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSesion(s))
    const onHash = () => { setRuta(leerHash()); setMenu(false); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => { data.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash) }
  }, [])

  if (!sesion) return <Entrando error={errorSso} reintentar={conectar} />

  const { pagina, params } = ruta
  return (
    <div className="app">
      <Sistemas />
      <header className="ui-barra no-print">
        <button className="ui-hamb" onClick={() => setMenu(true)} aria-label="Abrir menú" aria-expanded={menu}><span /><span /><span /></button>
        <a href="#/sobres" className="ui-titulo">Sobres</a>
      </header>
      <div className={'ui-cajon-fondo no-print' + (menu ? ' abierto' : '')} onClick={() => setMenu(false)} />
      <nav className={'ui-cajon no-print' + (menu ? ' abierto' : '')} aria-hidden={!menu}>
        <div className="ui-cajon-cab">
          <b>Sobres</b>
          <button className="ui-cajon-cerrar" onClick={() => setMenu(false)} aria-label="Cerrar menú">×</button>
        </div>
        <a href="#/sobres" className={pagina === 'sobres' && !params.get('tab') ? 'activo' : ''} onClick={() => setMenu(false)}>Inicio de Sobres</a>
        {PAGINAS.map(([k, t]) => (
          <a key={k} href={'#/' + k + (k === 'sobres' ? '?tab=todos' : '')} className={pagina === k && (k !== 'sobres' || params.get('tab') === 'todos') ? 'activo' : ''} onClick={() => setMenu(false)}>{t}</a>
        ))}
        <button className="ui-salir" onClick={salir}>Salir</button>
      </nav>
      <main>
        {pagina !== 'sobres' && (
          <a href="#/sobres" className="cerrar-pagina no-print" aria-label="Cerrar y volver a Sobres" title="Cerrar">×</a>
        )}
        {pagina === 'ingreso' && <Ingreso />}
        {pagina === 'sobres' && <Sobres params={params} />}
        {pagina === 'facturacion' && <Facturacion params={params} />}
        {pagina === 'facturados' && <Facturados params={params} />}
        {pagina === 'clientes' && <Clientes params={params} />}
        {pagina === 'talleristas' && <Talleristas />}
      </main>
    </div>
  )
}
