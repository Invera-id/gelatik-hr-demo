import { CheckCircle2, Info, X, XCircle, AlertTriangle } from 'lucide-react'
import { useNotifications } from '../context/NotificationContext'
import type { NotificationSeverity } from '../lib/notifications/types'

const ICONS: Record<NotificationSeverity, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

export function Toaster() {
  const { toasts, dismissToast } = useNotifications()
  if (toasts.length === 0) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.severity]
        return (
          <div key={toast.id} className={`toast ${toast.severity}`}>
            <Icon size={18} />
            <div><strong>{toast.title}</strong><p>{toast.message}</p></div>
            <button className="toast-close" aria-label="Tutup" onClick={() => dismissToast(toast.id)}><X size={15} /></button>
          </div>
        )
      })}
    </div>
  )
}
