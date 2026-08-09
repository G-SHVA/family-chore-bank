// Generates PWA icons + favicon from public/logo.png using sharp (local, no external service).
// Run: node scripts/generate-icons.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const SRC = 'public/logo.png'
mkdirSync('public/icons', { recursive: true })

const targets = [
  { out: 'public/icons/icon-192.png', size: 192 },
  { out: 'public/icons/icon-512.png', size: 512 },
  { out: 'public/favicon.png', size: 64 },
]

for (const { out, size } of targets) {
  await sharp(SRC)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out)
  console.log(`wrote ${out} (${size}x${size})`)
}
console.log('done')
