import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pdfjsAssets } from './scripts/pdfjs-assets.ts';
export default defineConfig({ plugins: [react(), pdfjsAssets()], base: './' });
