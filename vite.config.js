import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// LUMO_MOCK=1 swaps the real Supabase client for an in-memory stand-in (automated UI tests only).
export default defineConfig({
  resolve: process.env.LUMO_MOCK
    ? { alias: { '@supabase/supabase-js': fileURLToPath(new URL('./tests/supabase-mock.js', import.meta.url)) } }
    : {},
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
