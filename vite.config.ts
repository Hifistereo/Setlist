import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { alphaTab } from '@coderline/alphatab-vite'
import { copyFileSync } from 'node:fs'

/** GitHub Pages serves 404.html for unknown paths (e.g. the share target's /import before the service worker is installed). */
const spaFallback = (): Plugin => ({
  name: 'spa-404-fallback',
  apply: 'build',
  closeBundle() {
    copyFileSync('dist/index.html', 'dist/404.html')
  },
})

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    alphaTab(),
    spaFallback(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Setlist — band repertoire & stage',
        short_name: 'Setlist',
        description: 'Shared songs, setlists, chords and tabs for your band. Works offline.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        // Android: Share → Setlist on a chord page sends the selected text here.
        share_target: { action: 'import', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // App shell + alphaTab worker/worklet, Bravura font and SoundFont must work offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,woff,otf,sf2}'],
        globIgnores: ['**/Bravura.svg', '**/Bravura.otf', '**/Bravura.eot', '**/sonivox.sf3'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
