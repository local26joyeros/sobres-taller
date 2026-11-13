import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Se sirve en /sobres/ (también dentro de Taller - Movimientos, en la misma dirección)
export default defineConfig({
  base: '/sobres/',
  plugins: [react()],
})
