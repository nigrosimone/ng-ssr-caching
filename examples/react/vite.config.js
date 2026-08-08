import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two builds out of one config: the browser bundle into dist/client, and the server render into
// dist/server. The express server below serves the first and imports the second, which is the shape
// this would have in production.
export default defineConfig({
  plugins: [react()],
  appType: 'custom',
  build: { outDir: 'dist/client' },
});
