import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Recordings, screenshots and Playwright traces are outputs, not application entries.
  optimizeDeps: { entries: ['index.html'] },
  server: { watch: { ignored: ['**/.local/**', '**/test-results/**', '**/playwright-report/**'] } },
});
