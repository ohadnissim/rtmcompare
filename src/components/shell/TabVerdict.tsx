import React from 'react'
import type { AnalysisResult } from '../../types'
import PanelVerdict from './PanelVerdict'
import { isViolation } from '../../lib/metricSpecs'

/**
 * TabVerdict — wraps `<PanelVerdict />` with per-tab data extraction
 * so AnalysisView's seven main tabs can each insert a single line:
 *
 *   <TabVerdict tab="overview" results={results} isAtmos={isAtmos} />
 *
 * This component centralises the verdict-value mapping for v5.2 so
 * the heuristics don't have to live as IIFEs inside the giant
 * AnalysisView render tree. Each tab returns either a populated
 * `<PanelVerdict />` or `null` (when the underlying data isn't
 * present in the result, e.g. mastering_delta absent on a
 * non-mastered comparison).
 *
 * v5.3 follow-up: the captions are intentionally minimal here so
 * we don't fabricate domain claims. A future pass can route them
 * through engineer-tip content already in the result.
 */
type Tab = 'overview' | 'mastering' | 'delivery' | 'stereo' | 'match' | 'breakdown' | 'quality'

interface Props {
 tab: Tab
 results: AnalysisResult
 isAtmos: boolean
}

export default function TabVerdict({ tab, results, isAtmos }: Props) {
 // Shared extractions — same as buildMetricCells / AnalysisView's
 // CockpitRow. Source of truth: results.overall + results.headroom.
 const lufsA = results.overall?.lufs_a
 const lufsB =
 isAtmos && results.atmos_qc?.specs?.loudness_lufs != null
 ? results.atmos_qc.specs.loudness_lufs
 : results.overall?.lufs_b
 const tpB =
 isAtmos && results.atmos_qc?.specs?.true_peak_dbtp != null
 ? results.atmos_qc.specs.true_peak_dbtp
 : results.headroom?.true_peak_b
 const lraB = results.overall?.dynamics_b
 const lufsDelta = lufsA != null && lufsB != null ? lufsB - lufsA : null

 switch (tab) {
 case 'overview': {
 if (lufsB == null) return null
 const violation = lufsDelta != null && isViolation('lufs-i', lufsB, lufsDelta)
 return (
 <PanelVerdict
 eyebrow="Overall verdict"
 value={fmt(lufsB, 1)}
 caption={
 lufsDelta == null
 ? 'Integrated loudness of the file under review.'
 : `${describeDelta(lufsDelta)} the reference, integrated.`
 }
 size="lg"
 violation={violation}
 />
 )
 }

 case 'mastering': {
 // Use lufs delta as the master verdict; if mastering_delta has
 // a richer aggregate, surface the magnitude there. Otherwise
 // fall back to LUFS delta as the headline.
 if (lufsDelta == null) return null
 return (
 <PanelVerdict
 eyebrow="Mastering delta"
 value={signed(lufsDelta, 1)}
 caption={`B is ${describeDelta(lufsDelta)} A by integrated loudness.`}
 size="lg"
 violation={isViolation('lufs-i', lufsB ?? 0, lufsDelta)}
 />
 )
 }

 case 'delivery': {
 // Delivery surfaces TP compliance — the single most common
 // delivery-spec gate. Apple Music / Spotify ceiling: −0.3 dBTP.
 if (tpB == null) return null
 const passes = tpB <= -0.3
 return (
 <PanelVerdict
 eyebrow="Delivery"
 value={passes ? 'PASS' : 'BREACH'}
 caption={
 passes
 ? `True peak ${fmt(tpB, 1)} dBTP — within Apple/Spotify ceiling.`
 : `True peak ${fmt(tpB, 1)} dBTP exceeds the −0.3 dBTP delivery ceiling.`
 }
 size="sm"
 violation={!passes}
 />
 )
 }

 case 'stereo': {
 const monoRiskB = results.mono_compat
 ? ((results.mono_compat as { risk_b?: number; mono_loss_b_pct?: number }).risk_b ??
 results.mono_compat.mono_loss_b_pct)
 : null
 if (monoRiskB == null) return null
 const violation = monoRiskB > 12
 const word =
 monoRiskB <= 5
 ? 'Tight'
 : monoRiskB <= 12
 ? 'Balanced'
 : monoRiskB <= 25
 ? 'Wide'
 : 'Phase issue'
 return (
 <PanelVerdict
 eyebrow="Stereo balance"
 value={word}
 caption={`${Math.round(monoRiskB)} / 100 mono-compat risk.`}
 size="sm"
 violation={violation}
 />
 )
 }

 case 'match': {
 // EQ match — surface aggregate score if available. The result
 // shape varies; we read defensively.
 const matchScore = (results as { eq_match_score?: number }).eq_match_score
 if (matchScore == null) return null
 const passes = matchScore >= 70
 return (
 <PanelVerdict
 eyebrow="EQ match"
 value={`${Math.round(matchScore)}%`}
 caption={
 passes
 ? 'Tonal balance tracks the reference closely.'
 : 'Significant divergence from the reference EQ.'
 }
 size="sm"
 violation={!passes}
 />
 )
 }

 case 'breakdown': {
 if (lraB == null) return null
 const word = lraB < 4 ? 'Squashed' : lraB < 7 ? 'Tight' : lraB < 12 ? 'Open' : 'Dynamic'
 return (
 <PanelVerdict
 eyebrow="Dynamic range"
 value={fmt(lraB, 1)}
 caption={`LRA ${fmt(lraB, 1)} LU — ${word.toLowerCase()}.`}
 size="sm"
 />
 )
 }

 case 'quality': {
 // Quality aggregate — read defensively from the result.
 const score = (results as { quality_score?: number }).quality_score
 if (score == null) return null
 const word = score >= 90 ? 'Excellent' : score >= 75 ? 'Strong' : score >= 60 ? 'Acceptable' : 'Concerns'
 return (
 <PanelVerdict
 eyebrow="Quality"
 value={`${Math.round(score)}`}
 caption={`${word} — aggregate quality score across all checks.`}
 size="sm"
 violation={score < 60}
 />
 )
 }

 default:
 return null
 }
}

// helpers ────────────────────────────────────────────────────────
function fmt(n: number, digits: number): string {
 const s = n.toFixed(digits)
 return s.startsWith('-') ? `−${s.slice(1)}` : s
}

function signed(n: number, digits: number): string {
 if (Math.abs(n) < Math.pow(10, -digits) / 2) return `±${(0).toFixed(digits)}`
 if (n > 0) return `+${n.toFixed(digits)}`
 return `−${(-n).toFixed(digits)}`
}

function describeDelta(d: number): string {
 const ad = Math.abs(d)
 if (ad < 0.5) return 'matches'
 if (d > 0) return ad > 3 ? 'much louder than' : 'louder than'
 return ad > 3 ? 'much quieter than' : 'quieter than'
}
