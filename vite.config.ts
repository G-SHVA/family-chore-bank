import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // SECURITY — do not remove. `vite build` must never inline the kiosk
  // auto-login credentials.
  //
  // Under Netlify this was safe by accident: CI had no .env.local, so the
  // vars were simply absent. `wrangler deploy` builds on the developer's
  // machine, where .env.local IS present — without this, a deploy would
  // publish the kiosk password in dist/assets/*.js for anyone to read.
  //
  // Auto-login is a local-dev convenience only (`npm run dev`, which is
  // `command === 'serve'` and unaffected). In production every device,
  // including the wall tablet, signs in once via the Login screen and
  // rides the persisted refresh token from there.
  define:
    command === 'build'
      ? {
          'import.meta.env.VITE_KIOSK_LOGIN_EMAIL': '""',
          'import.meta.env.VITE_KIOSK_LOGIN_PASSWORD': '""',
        }
      : {},
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Family Chore Bank',
        short_name: 'ChoreBank',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#1C1C1E',
        background_color: '#1C1C1E',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // cache-first for static assets, network-first for Supabase API calls
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
}))
