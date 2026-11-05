import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme-light.css'
import App from './App.jsx'
import "@fontsource/inter";
import { installAuthInterceptor } from './lib/auth'
import { installDateOnlyFix } from './lib/dateOnly'

installAuthInterceptor();
installDateOnlyFix();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
