# Sobres · Taller

Sistema de sobres/trabajos y cuentas corrientes del taller de joyería.

- Frontend: Vite + React (`src/`), publicado en Vercel.
- Base de datos: Supabase (proyecto `sobres-taller`). Esquema en `supabase/migrations/`.

## Flujo de estados
- Presupuesto → (carga de monto) Esperando confirmación → Aceptado: Taller / Rechazado: Rechazado – para devolver → Entregado
- Taller / Trabajo nuevo → Taller (tallerista) → Listo para facturar → Facturado (en lote) → Entregado

Oro: se carga peso 18k; oro fino = 18k × 0,825. Plata y platino: el peso cargado ya es fino.
Cuenta corriente: positivo = el cliente debe.

## Desarrollo
```
npm install
npm run dev
```
