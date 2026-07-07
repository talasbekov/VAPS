// TW v3-путь: PostCSS-плагин (НЕ @tailwindcss/vite — тот v4-only, бан по FF100);
// autoprefixer читает .browserslistrc (firefox >= 100)
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
