import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Tiny toast for one-off feedback ("Copied", "Saved", "Done").
 * One message at a time. Auto-dismisses after `durationMs`.
 *
 * Pattern matches the existing inline toast in EQExportButton/
 * ApplyBounceButton — extracted here so click-to-copy sites that
 * lack feedback (CategoryCard, HumPanel insight, future ones) can
 * adopt it without re-implementing the timer.
 */
export function useToast(durationMs = 3500) {
 const [message, setMessage] = useState<string | null>(null)
 const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

 const show = useCallback((text: string) => {
  if (timerRef.current) clearTimeout(timerRef.current)
  setMessage(text)
  timerRef.current = setTimeout(() => {
   setMessage(null)
   timerRef.current = null
  }, durationMs)
 }, [durationMs])

 useEffect(() => {
  return () => {
   if (timerRef.current) clearTimeout(timerRef.current)
  }
 }, [])

 return { message, show }
}
