import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In development the React app runs on :5173 and forwards API calls to FastAPI on :8000
    proxy: { '/api': 'http://localhost:8001' },
  },
})
