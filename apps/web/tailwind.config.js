/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg))',
        fg: 'hsl(var(--fg))',
        'muted-fg': 'hsl(var(--muted-fg))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          hover: 'hsl(var(--card-hover))',
        },
        border: 'hsl(var(--border))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          hover: 'hsl(var(--primary-hover))',
          fg: 'hsl(var(--primary-fg))',
        },
        accent: 'hsl(var(--accent))',
        danger: 'hsl(var(--danger))',
        focus: 'hsl(var(--focus))',
      },
    },
  },
  plugins: [],
};
