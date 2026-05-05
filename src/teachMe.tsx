import React from 'react'
import InfoTooltip from './components/InfoTooltip'

/**
 * Plain-language glossary for the jargon RTM exposes — LUFS, TP, LRA,
 * dBTP, dither, crest factor, mid/side, and friends. "
 *
 * Usage:
 * <TeachTerm term="lufs">LUFS</TeachTerm>
 * // renders the word LUFS with an inline (?) that pops a readable
 * // definition on hover.
 *
 * Definitions are deliberately short — one sentence of what it measures,
 * one sentence of why you care. Links and full specs belong in docs,
 * not tooltips.
 */

export const GLOSSARY: Record<string, { title: string; body: string }> = {
 lufs: {
 title: 'LUFS — Loudness Units Full Scale',
 body: "How loud a track feels to a human ear, not just how hot the waveform is. Spotify normalises everyone to −14 LUFS; Apple to −16. A lower (more negative) number = quieter.",
 },
 lufsI: {
 title: 'Integrated LUFS',
 body: 'Average loudness over the whole track. This is the number streaming platforms use to decide how to attenuate or boost your master.',
 },
 lufsS: {
 title: 'Short-term LUFS',
 body: "Loudness measured over 3-second windows. Catches choruses and drops that sit much louder than the track's average.",
 },
 tp: {
 title: 'True Peak (dBTP)',
 body: 'The highest level the audio will actually hit after digital-to-analogue conversion — including inter-sample peaks a regular peak meter misses. Apple rejects anything over −1 dBTP.',
 },
 dbtp: {
 title: 'dBTP — decibels True Peak',
 body: 'Decibels relative to full scale, measured with oversampling so inter-sample peaks count. Always ≤ 0 dBTP for clean files.',
 },
 lra: {
 title: 'LRA — Loudness Range',
 body: "The spread between the quietest and loudest parts of the track (in LU). Higher = more dynamic. Broadcast caps it at 20 LU; film at 15.",
 },
 crest: {
 title: 'Crest factor',
 body: 'The ratio between peak level and RMS (average) level. Higher = more dynamic transients (drums punch through). Lower = more compressed / louder / flatter.',
 },
 dither: {
 title: 'Dither',
 body: 'A tiny amount of noise added when converting to 16-bit so the quantisation error sounds like a soft hiss instead of distortion. Turn it on any time you export 16-bit WAV.',
 },
 tpdf: {
 title: 'TPDF dither',
 body: 'Triangular probability density dither — the industry-standard shape for 16-bit delivery. Quieter than rectangular dither and decorrelates quantisation error from the signal.',
 },
 monoCompat: {
 title: 'Mono compatibility',
 body: 'How much the stereo mix survives when collapsed to mono (phone speakers, Bluetooth, club PAs). High mono-compat loss means important elements disappear when listeners play you on one speaker.',
 },
 midSide: {
 title: 'Mid / Side',
 body: "The 'centre' of the stereo image (Mid = L+R) versus the 'width' (Side = L−R). Vocals and kicks usually live in Mid; reverbs and wide synths in Side.",
 },
 hpf: {
 title: 'HPF — High-pass filter',
 body: "Removes everything below a chosen frequency. A gentle HPF at 30 Hz cleans sub-rumble that phone speakers can't play anyway but your limiter has to fight.",
 },
 isrc: {
 title: 'ISRC — International Standard Recording Code',
 body: "A unique per-recording identifier. Your distributor needs it for royalty tracking. Format: 12 characters like USRC12345678.",
 },
 bext: {
 title: 'BEXT — Broadcast Wave metadata',
 body: 'Extended metadata embedded in WAV files by broadcast / post workflows: originator name, date, UMID, coding history. Optional for streaming delivery, required by broadcast.',
 },
 q: {
 title: 'Q — Filter quality / bandwidth',
 body: 'How narrow an EQ band is. Higher Q = narrower and more surgical (useful for notching a specific resonance). Lower Q = wider and more tonal (useful for shaping overall character).',
 },
 ebur128: {
 title: 'EBU R128',
 body: 'European broadcast loudness standard. Targets −23 LUFS integrated, LRA ≤ 20 LU, true-peak ≤ −1 dBTP. BBC, ARD, and most European broadcasters require it.',
 },
 calm: {
 title: 'CALM Act (ATSC A/85)',
 body: 'US law (2012) requiring TV broadcasts to be loudness-controlled. Targets −24 LKFS integrated with tight dialog normalisation. Specifically aimed at ad-break volume jumps.',
 },
 dialogGate: {
 title: 'Dialog-gated LUFS',
 body: 'Loudness measured on speech only (music and sfx excluded). Netflix anchors its −27 LKFS spec here — a music-heavy mix can be quiet overall and still fail QC if dialog is too hot.',
 },
 compressor: {
 title: 'Compressor',
 body: "Reduces the loudest parts so the quiet parts sit louder on average — 'glue' for a mix. Configured by threshold (where it starts acting), ratio (how hard it acts), attack / release (how fast it reacts), knee (how gently it kicks in), and makeup (how much level to add back after reduction).",
 },
 kneeDb: {
 title: 'Soft knee',
 body: "How gradually a compressor transitions from 'off' to 'fully acting' around the threshold. 0 dB knee = a hard corner (punchy, obvious). 6 dB knee = a smooth bend (transparent, musical). Mastering comps typically run 3-12 dB.",
 },
 makeupGain: {
 title: 'Makeup gain',
 body: "Level added back after a compressor has reduced peaks. 'Auto' makeup matches the compressed output's RMS back to the input so bypass A/B is level-matched (you hear tone changes, not loudness changes).",
 },
 attackRelease: {
 title: 'Attack / Release',
 body: 'Attack = how quickly the compressor reacts once the signal crosses threshold (fast catches transients; slow lets them through). Release = how quickly it lets go after the signal drops below (fast pumps; slow breathes).',
 },
 riaa: {
 title: 'RIAA pre-emphasis',
 body: "The curve cutting lathes apply when pressing vinyl (highs boosted, lows cut). Playback cartridges apply the inverse so the record plays flat. For cut masters you bake the record-side curve in; for streaming you don't.",
 },
 tpLimiter: {
 title: 'True-peak limiter',
 body: "A brick-wall limiter that oversamples 4× to catch inter-sample peaks a regular peak limiter would miss. Streaming DSPs run one of these on ingest — if your master hits >−1 dBTP, theirs will engage and audibly squash it.",
 },
 ddex: {
 title: 'DDEX ERN',
 body: "The XML manifest format every major distributor (FUGA, Symphonic, Orchard) uses to describe a release. Round-tripping DDEX means RTM parses the label's manifest, reconciles against audio, and re-emits corrected XML — no format conversion step.",
 },
 sha256: {
 title: 'SHA-256 sidecar',
 body: 'A hex fingerprint of the exported PDF, written to a <file>.sha256 alongside. Lets the distributor verify the receipt wasn\'t hand-edited post-export.',
 },
 ara: {
 title: 'ARA2',
 body: "An extension on top of VST3 / AU that lets a plugin see the host's full arrangement — clips, regions, markers, sample data — instead of just the audio flowing through the insert. RTM Send uses ARA2 to send exactly 'Track 3 from this Wavelab montage' without live playback.",
 },
 pumping: {
 title: 'Pumping (limiter)',
 body: "The audible 'breathing' sound when a compressor or limiter reduces the whole mix on every kick hit. Flags a too-fast-attack + too-long-release combination, or a too-aggressive ceiling.",
 },
 interSample: {
 title: 'Inter-sample over',
 body: "A peak that lives between samples — invisible to a standard peak meter but audible as harsh clipping on the DAC. True-peak meters (4× oversampled) catch these; regular peak meters miss them.",
 },
 dialogAnchor: {
 title: 'Dialog-anchored LUFS',
 body: "Integrated loudness measured on dialog only — Netflix's −27 LKFS spec is anchored here. A film can be −27 LUFS overall and still fail QC because the dialog sits at −20, so Netflix QC requires the dialog gate specifically.",
 },
}

export function TeachTerm({ term, children }: { term: keyof typeof GLOSSARY | string; children: React.ReactNode }) {
 const entry = GLOSSARY[term as string]
 if (!entry) return <>{children}</>
 return (
 <span className="inline-flex items-center gap-1">
 {children}
 <InfoTooltip text={`${entry.title} — ${entry.body}`} />
 </span>
 )
}
