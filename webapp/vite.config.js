import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  cacheDir: './.vite',
  // Telegram webviews on older Android/iOS lag behind modern Chrome/Safari.
  // Force transpilation of optional chaining/nullish coalescing so the app
  // does not render a blank screen there.
  build: { target: 'es2019' },
  esbuild: { target: 'es2019' },
  optimizeDeps: { esbuildOptions: { target: 'es2019' } },
})
