import { useEffect, useRef } from 'react'
import { sb } from './lib'

// Vuelve a cargar los datos solo cuando cambia algo en la base (desde este u otro dispositivo),
// al volver a la pestaña y, por las dudas, cada minuto.
export function useTiempoReal(recargar, tablas = ['trabajos', 'items', 'traspasos_taller']) {
  const ref = useRef(recargar)
  ref.current = recargar
  useEffect(() => {
    let espera
    const pedir = () => { clearTimeout(espera); espera = setTimeout(() => ref.current(), 400) }
    const canal = sb.channel('cambios-' + Math.random().toString(36).slice(2))
    tablas.forEach((t) => canal.on('postgres_changes', { event: '*', schema: 'public', table: t }, pedir))
    canal.subscribe()
    const alVolver = () => { if (document.visibilityState === 'visible') pedir() }
    document.addEventListener('visibilitychange', alVolver)
    const cadaMinuto = setInterval(() => { if (document.visibilityState === 'visible') pedir() }, 60000)
    return () => {
      clearTimeout(espera); clearInterval(cadaMinuto)
      document.removeEventListener('visibilitychange', alVolver)
      sb.removeChannel(canal)
    }
  }, [tablas.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
}
