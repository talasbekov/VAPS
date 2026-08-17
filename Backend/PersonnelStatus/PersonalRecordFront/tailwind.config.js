/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./entities/**/*.{ts,tsx}",
    "./widgets/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  // Гарантируем включение всех цветов статусов (динамические классы)
  safelist: [
    "bg-green-100", "text-green-800",
    "bg-yellow-100", "text-yellow-800",
    "bg-amber-100", "text-amber-800",
    "bg-red-100", "text-red-800",
    "bg-purple-100", "text-purple-800",
    "bg-indigo-100", "text-indigo-800",
    "bg-pink-100", "text-pink-800",
    "bg-orange-100", "text-orange-800",
    "bg-blue-100", "text-blue-800",
    "bg-cyan-100", "text-cyan-800",
    "bg-teal-100", "text-teal-800",
    "bg-emerald-100", "text-emerald-800",
    "bg-gray-100", "text-gray-800",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          // `ink` — тот же смысл, но цвет, пригодный ДЛЯ ТЕКСТА. Насыщенный
          // `--primary` даёт 3.46:1 на тёмном фоне и 1.69 на чипе
          // `bg-primary/10`: как заливка он хорош, как буквы — нечитаем.
          ink: "hsl(var(--primary-ink))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          // То же и для ошибок: `--destructive` не проходит 4.5:1 ни в одной
          // теме (3.76 на белом, 3.52 на тёмном), а им набраны все тексты
          // ошибок форм.
          ink: "hsl(var(--destructive-ink))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
