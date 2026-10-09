import { createContext, useContext } from 'react'

export type ToastApi = {
  error: (text: string) => void
  success: (text: string) => void
  info: (text: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast fuori da ToastProvider')
  return ctx
}
