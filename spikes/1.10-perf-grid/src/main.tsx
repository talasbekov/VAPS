import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// ВНИМАНИЕ: НЕ оборачиваем в <StrictMode>.
// StrictMode в dev двойным рендером исказил бы счётчик коммитов (инвариант «1 коммит / keystroke»).
// Замер делается на ПРОД-сборке (vite build), но дисциплина та же — без двойного рендера.
const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(<App />)
