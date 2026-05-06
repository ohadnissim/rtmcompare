import React from 'react'

/**
 * RTMcompare wordmark — Console Didone primitive.
 *
 * Renders the brand wordmark in `--font-display` (Instrument Serif)
 * at one of four scales. Pixel sizes come from CSS tokens defined
 * in v5.2-tokens.md and live in `src/styles.css`:
 *
 *   sm   → --text-wordmark-sm   (20px)  — header, dense layouts
 *   md   → --text-wordmark-md   (30px)  — header default
 *   lg   → --text-wordmark-lg   (48px)  — onboarding tour
 *   hero → --text-wordmark-hero (clamp 40-80px) — empty-state cover
 *
 * The wordmark is treated as a single typographic image, not as
 * announceable letters: `role="img"` + `aria-label="RTMcompare"`
 * so a screen reader announces the brand once instead of "R-T-M-
 * compare" letter-by-letter.
 *
 * Hard rule from `.rtm-design/v5.2-anti-ai-design.md`: text is
 * always left-to-right, never rotated, mirrored, or decorated. No
 * drop shadow on type. No glow.
 *
 * Use `as="h1"` ONLY for the document's primary heading (cover
 * empty state). Everywhere else, the default `span` is correct —
 * the wordmark is brand chrome, not document structure.
 */
type WordmarkSize = 'sm' | 'md' | 'lg' | 'hero'

interface Props {
 size?: WordmarkSize
 as?: 'span' | 'h1'
 className?: string
}

const SIZE_TOKEN: Record<WordmarkSize, string> = {
 sm: 'var(--text-wordmark-sm)',
 md: 'var(--text-wordmark-md)',
 lg: 'var(--text-wordmark-lg)',
 hero: 'var(--text-wordmark-hero)',
}

export default function Wordmark({ size = 'md', as = 'span', className }: Props) {
 const Tag = as
 return (
 <Tag
 role="img"
 aria-label="RTMcompare"
 className={className}
 style={{
 fontFamily: 'var(--font-display)',
 fontWeight: 400,
 fontSize: SIZE_TOKEN[size],
 lineHeight: 'var(--leading-wordmark)',
 letterSpacing: 'var(--tracking-wordmark)',
 color: 'var(--color-text-primary)',
 // Hard rule: no drop shadow, no glow, no decorative effects.
 // If a reviewer is tempted to add textShadow here, re-read
 // .rtm-design/v5.2-anti-ai-design.md rule #3.
 textShadow: 'none',
 // Tabular figures off — wordmark has no digits, but if someone
 // copy-pastes this style they shouldn't inherit tnum.
 fontVariantNumeric: 'normal',
 }}
 >
 RTMcompare
 </Tag>
 )
}
