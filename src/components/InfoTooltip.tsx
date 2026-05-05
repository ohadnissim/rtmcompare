import React, { useState, useRef, useEffect } from 'react'

interface Props {
 text: string
}

export default function InfoTooltip({ text }: Props) {
 const [show, setShow] = useState(false)
 const [pos, setPos] = useState({ top: 0, left: 0 })
 const btnRef = useRef<HTMLSpanElement>(null)

 useEffect(() => {
 if (show && btnRef.current) {
 const rect = btnRef.current.getBoundingClientRect()
 setPos({
 top: rect.top - 8,
 left: rect.left + rect.width / 2,
 })
 }
 }, [show])

 return (
 <>
 <span
 ref={btnRef}
 className="inline-flex items-center"
 onMouseEnter={() => setShow(true)}
 onMouseLeave={() => setShow(false)}
 >
 <span
 className="w-4 h-4 rounded-full flex items-center justify-center cursor-help text-[9px] font-medium transition-colors"
 style={{
 backgroundColor: show ? 'rgba(224,122,79,0.2)' : 'rgba(87,83,78,0.3)',
 color: show ? '#e07a4f' : '#78716c',
 }}
 >
 ?
 </span>
 </span>
 {show && (
 <div
 className="fixed z-[9999] pointer-events-none"
 style={{
 top: pos.top,
 left: pos.left,
 transform: 'translate(-50%, -100%)',
 }}
 >
 <div
 className="px-3 py-2 rounded-lg text-[11px] leading-relaxed max-w-[260px] whitespace-normal text-center"
 style={{
 backgroundColor: '#272524',
 color: '#d6d3d1',
 border: '1px solid rgba(87,83,78,0.4)',
 boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
 }}
 >
 {text}
 </div>
 </div>
 )}
 </>
 )
}

// Copyable insight text
export function CopyableText({ text }: { text: string }) {
 const [copied, setCopied] = useState(false)

 const handleCopy = () => {
 navigator.clipboard.writeText(text).then(() => {
 setCopied(true)
 setTimeout(() => setCopied(false), 1500)
 })
 }

 return (
 <p
 className="text-sm leading-relaxed cursor-pointer transition-colors group"
 style={{ color: '#a8a29e' }}
 onClick={handleCopy}
 title="Click to copy"
 >
 {text}
 <span
 className="ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-[9px]"
 style={{ color: copied ? '#6ec577' : '#8d867b' }}
 >
 {copied ? 'Copied!' : '(click to copy)'}
 </span>
 </p>
 )
}
