import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Family Chore Bank design tokens — see DESIGN_SYSTEM.md
        bg: '#1C1C1E', // --color-bg-primary
        deep: '#0D0D0F', // --color-bg-deep (recessed chrome: nav, rails, wells)
        surface: '#0D0D0F', // alias of deep, kept for existing call sites
        card: '#1C1C1E', // --color-bg-card (defined by its hairline, not by fill)
        wash: 'rgba(224,188,132,0.06)', // --color-bg-wash
        gold: '#E6B800', // --color-gold-primary — ONE per screen
        antique: '#E0BC84', // --color-gold-antique — all other gold
        green: '#4A9B6F',
        danger: '#E05252',
        line: 'rgba(224,188,132,0.15)', // --color-border
        spine: 'rgba(224,188,132,0.3)', // structural hairline under headers/nav
        text: {
          DEFAULT: '#D4D0C8', // --color-text-primary
          muted: '#8A8680', // --color-text-secondary
        },
      },
      borderRadius: {
        // Driven by CSS vars so parent views square (0px) and child views
        // soften (4px) without every component knowing which context it is in.
        card: 'var(--radius-card)',
        input: 'var(--radius-input)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
      minHeight: {
        touch: '64px',
      },
      minWidth: {
        touch: '64px',
      },
      fontSize: {
        balance: ['56px', { lineHeight: '1', fontWeight: '600' }],
      },
      letterSpacing: {
        label: '0.08em',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-8px)' },
          '40%, 80%': { transform: 'translateX(8px)' },
        },
        'green-flash': {
          '0%': { backgroundColor: 'rgba(74, 155, 111, 0)' },
          '50%': { backgroundColor: 'rgba(74, 155, 111, 0.25)' },
          '100%': { backgroundColor: 'rgba(74, 155, 111, 0)' },
        },
      },
      animation: {
        shake: 'shake 0.4s ease-in-out',
        'green-flash': 'green-flash 0.8s ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config
