import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'slate-blue': {
          50: '#f4f7fa',
          100: '#e4ecf4',
          200: '#cbdbeb',
          300: '#a8c3de',
          400: '#7fa3cc',
          500: '#6084b0',
          600: '#4b6c96',
          700: '#3c5678',
          800: '#344761',
          900: '#2c3b4f',
          950: '#1b2432',
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
