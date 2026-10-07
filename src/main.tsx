import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { DemoProvider } from './context/DemoContext.tsx'
import { NotificationProvider } from './context/NotificationContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter><DemoProvider><NotificationProvider><App /></NotificationProvider></DemoProvider></BrowserRouter>
  </StrictMode>,
)
