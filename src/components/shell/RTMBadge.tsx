import React from 'react'

/**
 * RTMBadge — the corner monogram from the teaser image, made into a
 * shared component. Same vocabulary as the app icon: cream Didone
 * "RTM" stacked over a horizontal tick-rule with a single gold
 * diamond at its centre, then a tracked-caps subscript.
 *
 * Use as a quiet brand mark on cover screens, alongside the
 * Wordmark in headers, or wherever the suite identity needs to
 * register without consuming the focal point of the composition.
 *
 * Hard rule from `.rtm-design/v5.2-anti-ai-design.md`: the diamond
 * is the single chromatic gesture in this badge. Nothing else
 * carries gold. Don't add a glow or a fill.
 */
type BadgeSize = 'sm' | 'md' | 'lg' | 'hero'

const SIZES: Record<BadgeSize, {
 rtm: number
 sub: number
 ruleW: number
 ruleThickness: number
 diamond: number
 framePad: number
 frameOpacity: number
}> = {
 sm:   { rtm: 14, sub: 6.5, ruleW: 28, ruleThickness: 0.6, diamond: 3, framePad: 4,  frameOpacity: 0 },
 md:   { rtm: 24, sub: 8,   ruleW: 48, ruleThickness: 0.7, diamond: 4, framePad: 8,  frameOpacity: 0.10 },
 lg:   { rtm: 56, sub: 11,  ruleW: 96, ruleThickness: 0.9, diamond: 6, framePad: 16, frameOpacity: 0.12 },
 hero: { rtm: 96, sub: 14,  ruleW: 144, ruleThickness: 1.0, diamond: 8, framePad: 20, frameOpacity: 0.14 },
}

interface Props {
 subscript?: string                  // "AUDIO" | "COMPARE" | "PROFILE" | "SEND"
 size?: BadgeSize
 frame?: boolean                     // outer 1px frame on / off
 className?: string
}

export default function RTMBadge({
 subscript = 'AUDIO',
 size = 'md',
 frame = true,
 className,
}: Props) {
 const s = SIZES[size]
 const padX = s.framePad * 1.6
 const padY = s.framePad
 return (
 <div
 role="img"
 aria-label={`RTM ${subscript}`}
 className={className}
 style={{
 display: 'inline-flex',
 flexDirection: 'column',
 alignItems: 'center',
 gap: s.framePad * 0.4,
 padding: frame ? `${padY}px ${padX}px` : 0,
 border: frame
 ? `1px solid color-mix(in srgb, var(--color-text-secondary) ${Math.round(s.frameOpacity * 100)}%, transparent)`
 : 'none',
 borderRadius: 'var(--radius-card)',
 // Corner ticks would normally go here, but at badge scale they
 // fight the central mark. Frame alone is enough.
 }}
 >
 {/* RTM in Didone */}
 <span
 aria-hidden
 style={{
 fontFamily: 'var(--font-display)',
 fontWeight: 400,
 fontSize: s.rtm,
 lineHeight: 1,
 letterSpacing: '0.03em',
 color: 'var(--color-text-primary)',
 }}
 >
 RTM
 </span>

 {/* Tick rule with gold diamond */}
 <span
 aria-hidden
 style={{
 position: 'relative',
 width: s.ruleW,
 height: s.diamond * 2 + 2,
 marginTop: s.framePad * 0.2,
 }}
 >
 {/* left half of rule */}
 <span
 style={{
 position: 'absolute',
 top: '50%',
 left: 0,
 width: s.ruleW / 2 - s.diamond - 2,
 height: s.ruleThickness,
 transform: 'translateY(-50%)',
 backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 80%, transparent)',
 }}
 />
 {/* right half of rule */}
 <span
 style={{
 position: 'absolute',
 top: '50%',
 right: 0,
 width: s.ruleW / 2 - s.diamond - 2,
 height: s.ruleThickness,
 transform: 'translateY(-50%)',
 backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 80%, transparent)',
 }}
 />
 {/* gold diamond — the single chromatic gesture */}
 <span
 style={{
 position: 'absolute',
 top: '50%',
 left: '50%',
 width: s.diamond * 2,
 height: s.diamond * 2,
 transform: 'translate(-50%, -50%) rotate(45deg)',
 backgroundColor: 'var(--color-accent)',
 }}
 />
 </span>

 {/* Subscript */}
 <span
 aria-hidden
 style={{
 fontFamily: 'var(--font-sans)',
 fontWeight: 500,
 fontSize: s.sub,
 letterSpacing: '0.18em',
 textTransform: 'uppercase',
 color: 'var(--color-text-secondary)',
 marginTop: s.framePad * 0.2,
 }}
 >
 {subscript}
 </span>
 </div>
 )
}
