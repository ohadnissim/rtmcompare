/**
 * METRIC_EXPLAINERS — rich educational content for every metric shown in RTMcompare.
 *
 * Consumed by MetricExplainer.tsx when Learn Mode is active. Each entry maps a
 * metric key (snake_case) to a MetricExplainerContent object containing accurate
 * audio engineering knowledge suitable for students and working engineers alike.
 *
 * All numeric thresholds and target ranges are sourced from industry standards
 * (ITU-R BS.1770-4, AES, EBU R128, Apple/Spotify/YouTube delivery specs).
 */

export interface MetricExplainerContent {
  /** Short display name shown in the card header, e.g. "LUFS-I" */
  metric: string
  /** Full expanded name, e.g. "Integrated Loudness (LUFS)" */
  fullName: string
  /** ≤15 words describing what this metric measures */
  oneLiner: string
  /** 1–2 sentences explaining why it matters for mixing/mastering */
  why: string
  /** Typical or target range with context, e.g. "−14 to −16 LUFS for streaming" */
  range: string
  /** What a high reading means and what to do about it */
  tooHigh: string
  /** What a low reading means and what to do about it */
  tooLow: string
  /** Unit abbreviation, e.g. "LUFS", "dBTP", "LU", "%" */
  unit: string
  /** Relevant technical standard if one exists */
  standard?: string
  /** One advanced insight for experienced engineers */
  proTip?: string
}

export const METRIC_EXPLAINERS: Record<string, MetricExplainerContent> = {

  lufs_i: {
    metric: 'LUFS-I',
    fullName: 'Integrated Loudness (LUFS)',
    oneLiner: 'Average perceived loudness measured across the entire track.',
    why: 'Streaming platforms normalize playback to a target loudness, so masters louder than the platform target are turned down — wasting headroom — while quieter tracks may be turned up, revealing noise. Hitting the target precisely means your master plays at the exact intended level with no normalization penalty.',
    range: '−14 LUFS (Spotify/Apple Music) · −16 LUFS (podcast/broadcast) · −23 LUFS (broadcast EBU R128)',
    tooHigh: 'The platform normalizes your track down, which can make transients sound squashed and over-limited. Use less limiting or reduce overall gain before the limiter stage.',
    tooLow: 'The platform normalizes your track up, potentially exposing noise floor artifacts and making the master sound thin. Revisit your limiting stage or add gentle bus compression to raise the average level.',
    unit: 'LUFS',
    standard: 'ITU-R BS.1770-4 / EBU R128',
    proTip: 'LUFS-I is a gated measurement — it ignores segments below −70 LUFS and below −10 LU relative to ungated loudness, so very quiet intros and long silences do not drag the integrated value down.',
  },

  true_peak: {
    metric: 'True Peak',
    fullName: 'True Peak Level (dBTP)',
    oneLiner: 'Highest inter-sample peak level after digital-to-analogue reconstruction.',
    why: 'Standard sample-level peak meters miss inter-sample peaks — energy peaks that only become audible after the DAC reconstructs the signal. True Peak meters oversample 4× or more to catch these, preventing clipping in codecs (MP3, AAC, Ogg) that slightly raise peak levels during encoding.',
    range: '−1.0 dBTP (Apple/YouTube) · −1.0 dBTP (Spotify) · −1.0 dBTP (EBU R128)',
    tooHigh: 'Codecs may introduce audible distortion when encoding. Lower the limiter ceiling to −1.0 dBTP or use a true peak limiter that catches inter-sample peaks specifically.',
    tooLow: 'Not a problem per se, but values below −3 dBTP often indicate the master has unnecessary headroom that reduces perceptual loudness. Most finalized masters sit between −1.0 and −2.0 dBTP.',
    unit: 'dBTP',
    standard: 'ITU-R BS.1770-4',
    proTip: 'AAC encoding (iTunes, Spotify, Apple Music) can raise true peaks by up to 3 dB. Always check dBTP on the encode, not just the WAV, or use a codec-aware limiter for final delivery.',
  },

  lra: {
    metric: 'LRA',
    fullName: 'Loudness Range (LU)',
    oneLiner: 'Statistical spread between quiet and loud passages across the track.',
    why: 'LRA quantifies the dynamic shape of a mix: a high LRA indicates wide contrast between verses and choruses, while a low LRA signals heavy compression or limiting. Matching LRA to genre expectations ensures the track feels dynamically appropriate — not sounding flat in a folk context or lacking punch in EDM.',
    range: '4–8 LU (commercial pop/EDM) · 8–14 LU (rock/alternative) · 14+ LU (orchestral/classical)',
    tooHigh: 'The track may sound dramatically dynamic but risks listener fatigue on headphone mixes or sounding inconsistent on broadcast. Consider subtle bus compression to bring the loudest sections closer to the body of the track.',
    tooLow: 'Heavy limiting has flattened the mix dynamics, which can feel fatiguing and lifeless. Reduce the limiting depth, raise the limiter threshold, or apply parallel compression rather than series limiting.',
    unit: 'LU',
    standard: 'EBU Tech 3342',
    proTip: 'LRA uses a statistical percentile spread (10th to 95th percentile of loudness distribution), making it robust against single loud hits. It will not spike dramatically from a gunshot effect or single snare hit.',
  },

  dynamic_range: {
    metric: 'DR / PLR',
    fullName: 'Dynamic Range (DR / PSR / PLR)',
    oneLiner: 'Peak-to-average ratio indicating how squashed or open a mix is.',
    why: 'DR score (from the Pleasurize Music Foundation method) or PLR (Peak-to-Loudness Ratio per BS.1770) both capture how much crest factor remains after mastering. A higher number means the transients are still hitting well above the average loudness, giving the mix punch and space — a lower number means the waveform is "bricked."',
    range: 'DR 8–12 (commercial pop) · DR 12–16 (rock) · DR 14+ (jazz/classical) · PLR 6–12 LU typical',
    tooHigh: 'No action needed — this is generally positive. Very high DR (20+) may indicate the track is mastered at a low overall loudness, which could be appropriate for classical but unusual for commercial genres.',
    tooLow: 'Excessive limiting has eroded crest factor. Transients sound dulled, cymbals lose sparkle, and kick/snare can feel lacking impact. Reduce limiter gain reduction or use a clipper followed by a gentler limiter to recover some DR.',
    unit: 'LU',
    proTip: 'DR score and PLR measure different things: DR uses RMS/peak over blocks, while PLR (ITU-based) uses integrated LUFS vs. true peak. Both are useful — PLR aligns with streaming platform loudness math, DR is more useful for comparing mastering vintage.',
  },

  mono_compat: {
    metric: 'MONO',
    fullName: 'Mono Compatibility Loss (%)',
    oneLiner: 'Percentage of stereo signal lost or reduced when summed to mono.',
    why: 'Despite stereo streaming being standard, mono playback remains critical: Bluetooth speakers, earphones with one earbud, club PA systems with center fills, and phone speakers all sum to mono. A track that sounds full in stereo but loses low end, vocals, or entire instruments in mono has a fundamental mix problem.',
    range: '0–5% loss (excellent) · 5–15% loss (acceptable) · 15–30% (moderate concern) · 30%+ (serious phase issue)',
    tooHigh: 'Significant out-of-phase content is present — likely from excessively wide effects (stereo wideners, M/S processing, modulation on low frequencies). Check low-frequency phase correlation with a Goniometer/Vectorscope and high-pass any stereo widening below 250 Hz.',
    tooLow: 'Near-zero mono loss simply means the mix is largely mono-compatible, which is ideal. A loss of exactly 0% means the mix is fully mono — check that stereo effects are actually active.',
    unit: '%',
    proTip: 'Phase cancellation in mono is frequency-specific. Use a frequency-dependent correlation meter (e.g., SPAN+ or Correlation Meter in DMG Equilibrium) to pinpoint which frequency band causes the most cancellation rather than relying on a single broadband figure.',
  },

  mono_compat_pct: {
    metric: 'MONO',
    fullName: 'Mono Compatibility Loss (%)',
    oneLiner: 'Percentage of stereo signal lost or reduced when summed to mono.',
    why: 'Despite stereo streaming being standard, mono playback remains critical: Bluetooth speakers, earphones with one earbud, club PA systems with center fills, and phone speakers all sum to mono. A track that sounds full in stereo but loses low end, vocals, or entire instruments in mono has a fundamental mix problem.',
    range: '0–5% loss (excellent) · 5–15% loss (acceptable) · 15–30% (moderate concern) · 30%+ (serious phase issue)',
    tooHigh: 'Significant out-of-phase content is present — likely from excessively wide effects (stereo wideners, M/S processing, modulation on low frequencies). Check low-frequency phase correlation and high-pass any stereo widening below 250 Hz.',
    tooLow: 'Near-zero mono loss simply means the mix is largely mono-compatible, which is ideal. A loss of exactly 0% means the mix is fully mono — check that stereo effects are actually active.',
    unit: '%',
    proTip: 'Phase cancellation in mono is frequency-specific. Use a frequency-dependent correlation meter to pinpoint which frequency band causes the most cancellation.',
  },

  stereo_width: {
    metric: 'WIDTH',
    fullName: 'Stereo Width',
    oneLiner: 'Overall breadth of the stereo image from narrow to wide.',
    why: 'Stereo width shapes the listener\'s sense of space and separation. Too narrow and the mix feels claustrophobic; too wide and it loses mono compatibility, sounds artificial, and can confuse imaging on speaker systems. Mastering adjustments (M/S compression, stereo wideners) are often used to fine-tune width before delivery.',
    range: '0.0–0.3 (narrow / near-mono) · 0.3–0.6 (moderate) · 0.6–0.85 (wide, commercial pop/EDM) · 0.85–1.0 (very wide — check mono compat)',
    tooHigh: 'The stereo field is very wide, which risks phase issues in mono and may sound exaggerated on non-stereo playback. Apply M/S processing to reduce the Side channel, or use a correlation-aware stereo width plugin.',
    tooLow: 'The mix sounds narrow or almost mono, reducing the sense of space and envelopment. Add stereo widening selectively (Mid/Side processing, stereo chorus on pads, room reverb returns in stereo) rather than broadband widening.',
    unit: 'ratio (0–1)',
    proTip: 'Width alone does not capture image quality — a track can have high width but poor imaging if all elements are panned hard left/right with nothing in the center. Combine width with Vectorscope and correlation meter readings for a full picture.',
  },

  loudness_diff: {
    metric: 'ΔL',
    fullName: 'Loudness Difference (A vs. B)',
    oneLiner: 'Integrated loudness gap between the two compared files.',
    why: 'Level-matched comparison is the only valid A/B test. Even a 1 dB difference in playback level reliably makes the louder version sound "better" to listeners — it is perceived as more energetic and polished. When comparing a mix to a reference, align loudness first so any perceived differences are tonal, dynamic, or spatial rather than simply louder.',
    range: '±0.5 LU (negligible) · ±1 LU (perceptible) · ±2 LU (significant — level-match before critical comparison)',
    tooHigh: 'File A is significantly louder than File B. Normalize or gain-adjust one file before drawing qualitative conclusions about their sonic character.',
    tooLow: 'File B is louder than File A by this margin. The same principle applies — level-match before comparing.',
    unit: 'LU',
    proTip: 'Use the loudness-matched playback mode in RTMcompare (the ΔL = 0 normalization button) to automatically apply a gain offset during A/B playback, removing loudness bias from your critical listening session.',
  },

  masking_overlap: {
    metric: 'MASK',
    fullName: 'Frequency Masking Overlap',
    oneLiner: 'Spectral overlap between elements that causes one to hide another.',
    why: 'Auditory masking occurs when two sounds share the same frequency region at similar levels — the louder one makes the quieter one inaudible. In mixes, bass guitar masking kick drum sub frequencies, or snare masking upper vocals, reduces clarity and punch. Identifying masking regions guides EQ carving and panning decisions.',
    range: 'Low overlap (0–15%): clean separation · Moderate (15–35%): some competing elements · High (35%+): clarity will suffer',
    tooHigh: 'Multiple elements are competing heavily in the same frequency band. Use EQ cuts in the masking element to create room, or apply sidechain processing so the masking element ducks slightly when the masked element plays.',
    tooLow: 'Very low masking overlap is ideal — elements occupy distinct spectral spaces. Near-zero values indicate excellent frequency separation or sparse instrumentation.',
    unit: '%',
    proTip: 'Masking is asymmetric: a loud element at 200 Hz masks frequencies above it more than below it (upward masking effect). When carving EQ, cut in the upward direction from the masking frequency to recover presence in the masked element.',
  },

  distortion: {
    metric: 'DIST',
    fullName: 'Distortion / Clipping Severity',
    oneLiner: 'Degree of harmonic distortion and hard clipping artifacts in the audio.',
    why: 'Clipping and excessive harmonic distortion are irreversible in digital audio — once the waveform is flat-topped or saturated, no downstream processing can fully restore the transient detail. Detecting distortion early in the review process allows the engineer to go back to an earlier gain stage rather than trying to fix it at mastering.',
    range: 'None (clean) · Subtle (inaudible THD <0.1%) · Mild (audible on certain material) · Severe (audible clips, buzzy transients)',
    tooHigh: 'The audio contains hard clipping or severe harmonic distortion. If in a mix bus context, reduce gain before the clipper/limiter. If in a delivered master, the distortion is baked in — return to the mix session and reduce the gain driving the limiter, or use a softer knee/clipper approach.',
    tooLow: 'No distortion detected — this is the ideal outcome for material where clean reproduction is the goal. For intentionally distorted genres (metal, lo-fi) a low distortion score may indicate the saturation is not sitting prominently in the mix.',
    unit: 'severity',
    proTip: 'Soft clipping (gentle limiter with soft knee) produces mostly 2nd harmonic distortion, which is musically consonant. Hard clipping generates high-order odd harmonics (3rd, 5th, 7th) that are more perceptually harsh. The distortion analyzer distinguishes these two profiles.',
  },

  click_count: {
    metric: 'CLICKS',
    fullName: 'Click / Artifact Count',
    oneLiner: 'Number of detected transient clicks, pops, and digital artifacts.',
    why: 'Clicks and pops are distracting discontinuities caused by editing errors (un-crossfaded cuts), ADC/DAC errors, bit-depth issues, or sample rate conversion artifacts. A single audible click in a commercial release is a serious quality control failure — professional mastering includes a full artifact inspection pass.',
    range: '0 clicks (delivery-ready) · 1–3 (investigate and fix before release) · 4+ (systematic problem, likely upstream in the mix session)',
    tooHigh: 'Audible artifacts are present. Locate each click on the Click Timeline view, cross-reference the original session, and apply noise-reduction declicking or re-edit the offending region. Do not mask clicks with EQ or compression.',
    tooLow: 'Zero clicks detected — the track is clean from a transient artifact perspective. This is the expected baseline for any release-ready master.',
    unit: 'count',
    proTip: 'Not all detected events are audible clicks — some may be very-short-duration transients from percussion. Always listen at the flagged timestamp before processing. RTMcompare shows waveform context around each detection to help you judge.',
  },

  tonal_deviation: {
    metric: 'TONAL',
    fullName: 'Tonal Balance Deviation',
    oneLiner: 'How far the spectral balance deviates from a genre-matched target curve.',
    why: 'Tonal balance is the macro-level spectral distribution — whether the track has too much or too little energy in the lows, mids, or highs relative to commercially successful references in the same genre. An imbalanced tonal curve often indicates room acoustic issues at the mixing stage or excessive shelving EQ at mastering.',
    range: '±1.5 dB (within tolerance) · ±3 dB (noticeable tonal coloring) · ±6 dB+ (significant imbalance, may indicate acoustic problems)',
    tooHigh: 'The track has significantly more energy in one region than the target. Identify the offending band and apply corrective EQ. Pay special attention to low-mid buildup (200–500 Hz), excessive brightness (5–10 kHz air), or sub-bass bloat below 80 Hz.',
    tooLow: 'The tonal balance is very flat relative to the target, which may actually be desired for certain genres. If the score is near zero but the mix sounds thin or harsh, the issue may be dynamic rather than tonal — check the LRA and DR scores.',
    unit: 'dB',
    proTip: 'Tonal deviation is computed against a smoothed 1/3-octave target curve derived from your selected genre reference profile. Switching reference profiles (e.g., from "Pop" to "Electronic") will shift the target curve and change the deviation score — always check which profile is active.',
  },

  hum_severity: {
    metric: 'HUM',
    fullName: 'Electrical Hum Severity',
    oneLiner: 'Strength of 50/60 Hz mains-frequency hum and its harmonics.',
    why: 'Mains hum (50 Hz in Europe/Asia, 60 Hz in North America) and its harmonics (100, 150, 200 Hz / 120, 180, 240 Hz) are caused by ground loops, unbalanced cabling, or poorly shielded equipment. Even when inaudible under music, hum can become obvious during quiet passages, fade-outs, or after heavy compression raises the noise floor.',
    range: 'Negligible (< −80 dBFS hum floor) · Mild (−80 to −60 dBFS) · Moderate (−60 to −40 dBFS) · Severe (> −40 dBFS, clearly audible)',
    tooHigh: 'Audible hum is present. Apply a narrow notch EQ (Q ≈ 20–40) at the fundamental and each harmonic, or use a dedicated hum-removal tool. For systematic hum, trace the source in the signal chain — ground loop isolation transformers or re-cabling may be needed in the studio.',
    tooLow: 'No meaningful hum detected — the signal chain is clean or the recording environment is electrically quiet. This is the expected baseline for studio-grade recordings.',
    unit: 'dBFS',
    proTip: 'Hum harmonics diminish in amplitude but extend well into the midrange (10th harmonic of 60 Hz = 600 Hz). When applying hum removal, notch the 2nd and 3rd harmonics at minimum — many engineers notch through the 5th (300/250 Hz) to fully clean the fundamental family.',
  },

  dialog_gate: {
    metric: 'DIALOG',
    fullName: 'Dialog-Gated Loudness',
    oneLiner: 'Loudness measured only during dialog or lead vocal passages.',
    why: 'For content that will be broadcast or streamed in a context where intelligibility of speech is critical (podcasts, audiobooks, film/TV deliverables, video essays), the loudness of the dialog itself — not the overall integrated loudness — is what matters. EBU R128 S1 and ATSC A/85 both specify dialog-gated measurement as the normalization target for broadcast.',
    range: '−24 LUFS (ATSC A/85 broadcast) · −23 LUFS (EBU R128 broadcast) · −16 LUFS (podcast streaming)',
    tooHigh: 'The dialog is louder than the target, and the broadcast processor will turn the whole program down, making music beds and effects quieter than intended. Reduce dialog fader level or apply gentle downward compression to the dialog stem before mixing.',
    tooLow: 'Dialog is too quiet relative to the target. It will be turned up by the broadcast processor, potentially exposing noise and making music beds feel overpowering. Raise dialog faders, reduce music bed levels, or use upward compression on the dialog stem.',
    unit: 'LUFS',
    standard: 'ITU-R BS.1770-4 / EBU R128 S1',
    proTip: '⚠ Not applicable for music mixing — dialog-gated measurement only makes sense for content with speech (podcasts, film/TV, audiobooks). For pure music, ignore this metric or check if your DAW has a vocal-gate mode active that may be affecting loudness reads.',
  },

  plr: {
    metric: 'PLR',
    fullName: 'Peak-to-Loudness Ratio',
    oneLiner: 'Difference between true peak and integrated loudness — a crest factor proxy.',
    why: 'PLR directly expresses how much dynamic punch remains after mastering: a PLR of 10 LU means the peaks are 10 dB above the average loudness, which translates to audible snap on drums and transients. As limiting compresses the peak-to-average ratio, PLR drops — tracking this number across versions reveals precisely how much dynamics are being sacrificed to chase loudness.',
    range: '6–8 LU (heavily limited pop/EDM) · 8–12 LU (balanced commercial) · 12–16 LU (open, dynamic, jazz/classical)',
    tooHigh: 'Very high PLR with low LUFS-I suggests the track is mastered conservatively — plenty of headroom, excellent dynamics, but may be turned up more than intended by streaming normalization. Consider whether additional gain staging at the limiter is appropriate for the target platform.',
    tooLow: 'The master is over-limited. Peaks are barely above the average loudness, which robs the track of punch and transient impact. This is the classic "loudness war" artifact. Back off the limiter ceiling or use a clipper → transparent limiter chain to recover some PLR.',
    unit: 'LU',
    standard: 'ITU-R BS.1770-4 (derived)',
    proTip: 'PLR = dBTP − LUFS-I (approximately). You can compute it mentally from any meter. A PLR below 6 LU is the threshold many mastering engineers use as a hard warning sign that a master is over-processed.',
  },

  transient_density: {
    metric: 'TRANS',
    fullName: 'Transient Density',
    oneLiner: 'Number of significant transient events per second in the signal.',
    why: 'Transient density correlates with perceived energy, groove, and rhythmic information. A high transient density in a dense production (full drum kit + percussion) is expected, while high transient density in a sparse acoustic recording may indicate noise or artifacts. For mastering, extremely high transient density increases true peak risk, while very low density may indicate over-compression wiping the attack off drums and percussion.',
    range: '< 2/s (sparse, ambient/classical) · 2–8/s (moderate, typical rock/pop) · 8–20/s (dense, hip-hop/EDM full productions) · 20+/s (very high — check for artifacts)',
    tooHigh: 'Abnormally high transient count could indicate clicks, artifacts, or excessive high-frequency content creating false transient triggers. Cross-reference with the Click Count metric. If no artifacts are present, the dense rhythmic content is simply very active.',
    tooLow: 'Very few transients indicate a smooth, sustained signal (drone, pad, ambient) or that heavy limiting/compression has erased transient attack. If the genre calls for punchy drums, the latter is a mastering problem — reduce limiter gain reduction and check the attack times of any bus compression.',
    unit: '/s',
    proTip: 'Transient density is measured on the broadband signal but can be frequency-split in the full analysis view. Sub-80 Hz transients (kick sub punches) count separately from high-frequency transients (hi-hat, percussion), giving you insight into where the rhythmic energy actually lives spectrally.',
  },

}
