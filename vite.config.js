import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative paths so the build works both at root (GitHub Pages) and inside
  // an iframe on itch.io / GameMonetize (where assets are served under a sub-path)
  base: './',
})
