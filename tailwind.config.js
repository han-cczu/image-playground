const token = (name) => `rgb(var(--ui-${name}) / <alpha-value>)`

const brandScale = {
  50: '#ecfdf5',
  100: '#d1fae5',
  200: '#a7f3d0',
  300: '#77e8b0',
  400: '#34d399',
  500: '#00a76f',
  600: '#008f64',
  700: '#007867',
  800: '#005b4b',
  900: '#064e3b',
  950: '#022c22',
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          muted: token('surface-muted'),
          raised: token('surface-raised'),
        },
        content: {
          DEFAULT: token('content'),
          muted: token('content-muted'),
          subtle: token('content-subtle'),
        },
        line: token('line'),
        brand: {
          ...brandScale,
          DEFAULT: token('brand'),
          hover: token('brand-hover'),
          soft: token('brand-soft'),
          ink: token('brand-ink'),
        },
        'on-brand': token('on-brand'),
        // 低频控件仍使用旧色阶，统一映射到同一套品牌色，避免弹层与新工作台各自一套主题。
        blue: brandScale,
        gray: {
          50: '#f9fafb',
          100: '#f4f6f8',
          200: '#dfe3e8',
          300: '#c4cdd5',
          400: '#919eab',
          500: '#637381',
          600: '#454f5b',
          700: '#34424f',
          800: '#28333f',
          900: '#1c252e',
          950: '#141a21',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui-sans)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: { card: 'var(--ui-shadow-card)', popover: 'var(--ui-shadow-popover)' },
    },
  },
  plugins: [],
}
