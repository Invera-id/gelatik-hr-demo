import { XCircle } from 'lucide-react'

/** Inline error for a failed server action (message + field errors are pre-joined). */
export function ActionError({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return <div className="alert error" role="alert"><XCircle /><div><strong>Perubahan tidak tersimpan</strong><p>{message}</p></div></div>
}
