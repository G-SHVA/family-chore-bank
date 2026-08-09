import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Family Chore Bank design tokens
        bg: '#181818',
        surface: '#1E1E1E',
        card: '#242424',
        gold: '#E6B800',
        green: '#42B883',
        danger: '#E05252',
        text: {
          DEFAULT: '#FFFFFF',
          muted: '#A0A0A0',
        },
      },
      borderRadius: {
        card: '12px',
        input: '8px',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      minHeight: {
        touch: '64px',
      },
      minWidth: {
        touch: '64px',
      },
      fontSize: {
        balance: ['56px', { lineHeight: '1', fontWeight: '700' }],
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-8px)' },
          '40%, 80%': { transform: 'translateX(8px)' },
        },
        'green-flash': {
          '0%': { backgroundColor: 'rgba(66, 184, 131, 0)' },
          '50%': { backgroundColor: 'rgba(66, 184, 131, 0.25)' },
          '100%': { backgroundColor: 'rgba(66, 184, 131, 0)' },
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
