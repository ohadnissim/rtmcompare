import React, { useState, useEffect } from 'react'

const shortcuts = [
 { keys: ['Space'], action: 'Play / Pause' },
 { keys: ['A'], action: 'Switch to File A (Reference)' },
 { keys: ['B'], action: 'Switch to File B (Compare)' },
 { keys: ['X'], action: 'Flip A / B' },
 { keys: ['←'], action: 'Scrub back 5 s · or step to previous song (solo transport)' },
 { keys: ['→'], action: 'Scrub forward 5 s · or step to next song (solo transport)' },
 { keys: ['Shift', '←'], action: 'Previous song (inside album batch)' },
 { keys: ['Shift', '→'], action: 'Next song (inside album batch)' },
 { keys: ['L'], action: 'Toggle loop / level match' },
 { keys: ['M'], action: 'Toggle mono listening' },
 { keys: ['Shift', 'B'], action: 'Blind A/B mode toggle' },
 { keys: ['1', '-', '9'], action: 'Jump to tab N (compare view)' },
 { keys: ['⌘', 'K'], action: 'Command palette (compare) · Song quick-switch (batch) · Focus search (cockpit)' },
 { keys: ['/'], action: 'Same as ⌘K when no input is focused' },
 { keys: ['⌘', 'E'], action: 'Export EQ (FFP)' },
 { keys: ['⌘', 'Shift', 'E'], action: 'Apply EQ & bounce corrected WAV' },
 { keys: ['['], action: 'Previous EQ chip' },
 { keys: [']'], action: 'Next EQ chip' },
 { keys: ['?'], action: 'Toggle this help' },
]

export default function ShortcutHelp() {
 const [show, setShow] = useState(false)

 useEffect(() => {
 const handler = (e: KeyboardEvent) => {
 if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
 if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
 e.preventDefault()
 setShow(s => !s)
 }
 if (e.key === 'Escape') setShow(false)
 }
 window.addEventListener('keydown', handler)
 return () => window.removeEventListener('keydown', handler)
 }, [])

 if (!show) return null

 return (
 <div
 className="fixed inset-0 z-50 flex items-center justify-center"
 style={{ backgroundColor: 'rgba(20,19,19,0.8)', backdropFilter: 'blur(4px)' }}
 onClick={() => setShow(false)}
 >
 <div
 className="rounded-2xl p-8 space-y-6 max-w-sm w-full"
 style={{ backgroundColor: '#1e1d1c', border: '1px solid rgba(51,48,44,0.6)' }}
 onClick={e => e.stopPropagation()}
 >
 <div className="text-center space-y-1">
 <h2 className="text-lg font-semibold" style={{ color: '#f5f5f4' }}>Keyboard Shortcuts</h2>
 <p className="text-[11px]" style={{ color: '#57534e' }}>Press ? to toggle this overlay</p>
 </div>

 <div className="space-y-2.5">
 {shortcuts.map((s, i) => (
 <div key={i} className="flex items-center justify-between">
 <span className="text-xs" style={{ color: '#a8a29e' }}>{s.action}</span>
 <div className="flex items-center gap-1">
 {s.keys.map((key, j) => (
 <kbd
 key={j}
 className="px-2 py-1 rounded text-[10px] font-mono"
 style={{ backgroundColor: '#272524', color: '#e07a4f', border: '1px solid rgba(51,48,44,0.6)' }}
 >
 {key}
 </kbd>
 ))}
 </div>
 </div>
 ))}
 </div>

 <button
 onClick={() => setShow(false)}
 className="w-full py-2 rounded-lg text-xs"
 style={{ backgroundColor: 'rgba(87,83,78,0.2)', color: '#78716c' }}
 >
 Close (Esc)
 </button>
 </div>
 </div>
 )
}
