import { METALES, etiquetaPeso, fino, gramos } from './lib'

// Campo de tallerista: se elige de la lista o se escribe un nombre nuevo.
export function CampoTallerista({ valor, onChange, talleristas, id = 'lista-talleristas', placeholder = 'Nombre del tallerista' }) {
  return (
    <>
      <input list={id} value={valor} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <datalist id={id}>
        {talleristas.filter((t) => t.activo).map((t) => <option key={t.id} value={t.nombre} />)}
      </datalist>
    </>
  )
}

// Hechura + moneda, metal y peso (presupuesto).
export function CamposPresupuesto({ v, set }) {
  const f = fino(v.metal, v.peso)
  return (
    <div className="grilla-pres">
      <label>Hechura
        <div className="con-moneda">
          <SelectorMoneda valor={v.moneda} onChange={(m) => set({ ...v, moneda: m })} />
          <input inputMode="decimal" value={v.hechura} onChange={(e) => set({ ...v, hechura: e.target.value })} />
        </div>
      </label>
      <label>Metal
        <select value={v.metal} onChange={(e) => set({ ...v, metal: e.target.value, peso: e.target.value ? v.peso : '' })}>
          <option value="">Sin metal</option>
          {Object.entries(METALES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </label>
      {v.metal ? (
        <label>{etiquetaPeso(v.metal)}
          <input inputMode="decimal" value={v.peso} onChange={(e) => set({ ...v, peso: e.target.value })} />
          {v.metal === 'oro' && f != null && !Number.isNaN(f) && <span className="ayuda">Oro fino: {gramos(f)}</span>}
        </label>
      ) : <div />}
    </div>
  )
}

// Pesos / Dólares como dos botones, a la izquierda del monto
export function SelectorMoneda({ valor, onChange }) {
  return (
    <div className="selector-moneda" role="group" aria-label="Moneda">
      <button type="button" className={valor === 'ARS' ? 'sel' : ''} onClick={() => onChange('ARS')}>$</button>
      <button type="button" className={valor === 'USD' ? 'sel' : ''} onClick={() => onChange('USD')}>US$</button>
    </div>
  )
}
