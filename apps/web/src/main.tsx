import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { DemoProvider } from './context/DemoContext.tsx'
import { NotificationProvider } from './context/NotificationContext.tsx'
import { ApiDemoProvider } from './context/ApiDemoContext.tsx'
import { ApiNotificationProvider } from './context/ApiNotificationContext.tsx'
import { dataSource } from './config/dataSource.ts'

// API mode (default) and the explicit local prototype never share storage or providers.
const tree = dataSource === 'api'
  ? <ApiDemoProvider><ApiNotificationProvider><App /></ApiNotificationProvider></ApiDemoProvider>
  : <DemoProvider><NotificationProvider><App /></NotificationProvider></DemoProvider>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>{tree}</BrowserRouter>
  </StrictMode>,
)
