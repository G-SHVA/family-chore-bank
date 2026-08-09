// Generates PWA icons + favicon + apple-touch-icon from public/logo.png using
// sharp (local, no external service). The logo is centered on a solid #181818
// background (no transparency/white) so installed home-screen icons match the
// app's dark theme and work as maskable icons.
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'public/logo.png'
const BG = { r: 24, g: 24, b: 24, alpha: 1 } // #181818
mkdirSync('public/icons', { recursive: true })

// pad = logo size as a fraction of the canvas (leaves a maskable safe zone).
const targets = [
  { out: 'public/icons/icon-192.png', size: 192, pad: 0.72 },
  { out: 'public/icons/icon-512.png', size: 512, pad: 0.72 },
  { out: 'public/apple-touch-icon.png', size: 180, pad: 0.74 },
  { out: 'public/favicon.png', size: 64, pad: 0.82 },
]

for (const { out, size, pad } of targets) {
  const inner = Math.round(size * pad)
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(out)
  console.log(`wrote ${out} (${size}x${size}, #181818 bg)`)
}
console.log('done')
