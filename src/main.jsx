import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import WorldDomination from './WorldDomination.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WorldDomination />
  </StrictMode>,
)