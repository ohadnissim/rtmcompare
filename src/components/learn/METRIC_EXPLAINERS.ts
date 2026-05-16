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
    proTip: 'LUFS-I is a gated measurement — it ignores segments below −70 LUFS and below −10 LU relative to ungated loudness, so very quiet intros and long silences do not drag the integrated value down. Alongside LUFS-I, use LUFS-S (short-term, 3-second window) to read the dynamic arc of the track — the LUFS-S difference between the quietest verse and the loudest chorus is a measure of macro-dynamics. Use LUFS-M (momentary, 400 ms window) to catch the peak loudness of individual hits — critical for broadcast compliance where LUFS-M above −18 triggers processors.',
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

  center_fill_ms: {
    metric: 'M/S',
    fullName: 'Center Fill M/S Ratio',
    oneLiner: 'Ratio of Mid (center) to Side energy — how much of the mix is center-anchored vs. spread.',
    why: 'The Mid/Side ratio determines how a mix behaves on mono playback. A mix with very high Side energy and low Mid energy will lose significant content when summed to mono — critical elements (kick, bass, lead vocal) may appear to thin out or disappear. Club PA systems, broadcast center fills, and phone speakers all sum to mono; a healthy center fill ensures the mix retains body and punch on these systems.',
    range: 'Typically 0.8–1.4 for pop/rock/hip-hop; jazz and orchestral may be lower (0.5–0.9). Avoid going below 0.4 on any commercially delivered mix.',
    tooHigh: 'The mix is very center-dominant (mono-ish). This is safe for translation but may sound narrow and unengaging on a good stereo system. Consider adding stereo wideners to instrument buses (guitars, pads, synths) — but never widen the bass or lead vocal.',
    tooLow: 'The mix is side-heavy. This will cause significant content loss in mono — problematic for Bluetooth speakers, club PA center fills, and broadcast. Use an M/S compressor to reduce Side channel gain, or use a stereo narrower on the master bus. Also check for phase-cancellation issues (correlation meter).',
    unit: 'ratio (M/S, 0–2+; >1 = center-dominant, <0.5 = side-heavy)',
    proTip: 'Sub-bass (below 80–120 Hz) should always be mono — any energy in the Side channel below this frequency causes mono compat problems and wastes woofer energy. Use M/S EQ on the master bus: cut the Side channel with a steep HPF at 80–120 Hz.',
  },

  noise_floor: {
    metric: 'NOISE',
    fullName: 'Noise Floor',
    oneLiner: 'The dBFS level of the audio during silent sections — reveals noise, hum, and residual signal.',
    why: 'The noise floor reveals everything that shouldn\'t be there: hum from ground loops, preamp noise, computer fan bleed, pedal board buzz, plugin-introduced noise. Heavy compression and limiting raise the noise floor significantly because they reduce the dynamic difference between signal and noise. A track that sounds clean in a loud mix may have an audible noise tail during fade-outs or between sections.',
    range: 'Recording: −85 dBFS or lower. Mix: −75 dBFS or lower. Mastered: −65 dBFS or lower (compression raises the floor). Broadcast/classical: −90 dBFS or lower required.',
    tooHigh: 'Noise floor is too high — audible hum, hiss, or residual signal. Find the source: single-track noise should be treated at the channel (noise gate, noise reduction plugin, or recording fix). Global noise from a plugin usually means a plugin is adding distortion or gain — check your mix bus chain. Hum at 50/60 Hz or harmonics indicates a ground loop in the signal path.',
    tooLow: 'No issue — a lower noise floor is always better. If you see a suspiciously low floor (−110 to −120 dBFS), confirm the silent sections are truly silent rather than the file being padded with digital black.',
    unit: 'dBFS (negative; lower is quieter; e.g., −90 dBFS is excellent, −60 dBFS is problematic)',
    proTip: 'Always check the noise floor of your EXPORTED file, not just the DAW session. Many plugins add a measurable noise tail during silence (amp sims, convolution reverbs, some saturators). Export a 10-second section of silence from your bounce and measure it separately.',
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

  dither_applied: {
    metric: 'DITHER',
    fullName: 'Dither Applied',
    oneLiner: 'Whether dithering was applied as the final step before 16-bit delivery — prevents quantisation distortion on fade-outs.',
    why: 'When reducing bit depth from 24-bit (mastering session) to 16-bit (CD/streaming delivery), the conversion truncates the lower 8 bits of each sample. Without dithering, this truncation causes quantisation distortion — a harsh, non-harmonic noise that is most audible at low signal levels: fade-outs, quiet passages, spaces between notes. Dithering adds a carefully designed low-level noise signal before truncation that randomises the quantisation error, converting the harsh distortion into a smooth, steady noise floor that is far less perceptually objectionable.',
    unit: 'boolean (applied / not applied)',
    range: 'Required when delivering 16-bit/44.1 kHz (CD, most streaming pre-encoders). Not required for 24-bit delivery or 32-bit float bounce.',
    tooHigh: '',
    tooLow: 'Dither was not detected or not confirmed. For 16-bit delivery, this risks audible quantisation distortion on fade-outs and quiet passages. Apply TPDF or noise-shaped dither (POW-R, UV22HR) as the absolute last step in the mastering chain — after the limiter, before export.',
    proTip: 'Dither type selection: TPDF (triangular probability density function) is the most accurate and correct for any use. Noise-shaped dither (POW-R Type 1/2/3, UV22HR) pushes dither energy into 14–16 kHz where human hearing is least sensitive, giving a slightly quieter perceived noise floor. Never apply dither more than once, and never apply processing after dithering — any gain change re-introduces quantisation error and makes the dither ineffective.',
  },

  transient_integrity: {
    metric: 'T-INTEG',
    fullName: 'Transient Integrity',
    oneLiner: 'How well attack transients (kick, snare, pluck) are preserved vs. smeared by over-compression.',
    why: 'Transients — the sharp initial attack of percussive and plucked instruments — create the sense of punch, presence, and clarity in a mix. Excessive compression with fast attack times (< 5 ms) flattens transients before the ear perceives them, making the mix sound dense but lifeless. Transient integrity measures the ratio of peak level to the following sustain envelope: a high ratio means attack transients are preserved; a low ratio means they have been compressed or limited flat.',
    unit: 'ratio (higher = more transient preserved; 1.0+ = healthy; < 0.5 = over-compressed)',
    range: 'Kick and snare: 1.2–2.0 transient ratio. Full-mix: 0.8–1.4 is typical for commercial masters depending on genre. EDM/club: can be 0.5–0.8 intentionally. Jazz/classical: 1.4–2.5.',
    tooHigh: 'Very high transient ratio means little or no dynamic processing — may sound uncontrolled or fatiguing at high levels. Consider gentle bus compression with a slow attack (30–50 ms) to add glue while preserving the initial crack.',
    tooLow: 'Transients are heavily flattened. Common causes: (1) compressor attack too fast (< 2 ms) on the mix bus; (2) limiter ceiling too low; (3) multiple stages of compression adding up. Raise attack time on bus compressor, increase limiter ceiling 1–2 dB and re-set gain staging.',
    proTip: 'Transient designers (Waves Trans-X, SPL Transient Designer, Eventide Physion) can restore transient integrity after the fact, but it is always better to fix at the compression/limiting stage. As a rule: if the kick does not visually "pop" above the waveform RMS on a sample-accurate peak meter, the transients have been compressed flat.',
  },

  visqol_mos: {
    metric: 'ViSQOL',
    fullName: 'Virtual Speech Quality Objective Listener (MOS-LQO)',
    oneLiner: 'Perceptual similarity score from 1–5 comparing how alike two files sound to a human ear.',
    why: 'Measurements like LUFS and dBTP describe what a file measures, not what it sounds like. ViSQOL fills that gap: it models the human auditory system (gammatone filterbank + neural similarity patches) to produce a Mean Opinion Score — the same scale used in telecommunications quality testing. A high ViSQOL score means a mastering engineer would be hard-pressed to distinguish the two files in a blind test.',
    range: '5.0 = files are perceptually identical · 4.5+ = transparent mastering · 3.5–4.5 = minor audible differences · below 3.5 = significant sonic gap',
    tooHigh: 'Not possible to be "too high" — 5.0 is the ceiling. A score near 5.0 means the processing was essentially transparent.',
    tooLow: 'The master sounds noticeably different from the reference to a trained ear. Possible causes: heavy limiting, phase shift from over-EQ, codec artifacts from lossy encode, or comparison between fundamentally different mixes. Use the tonal and masking panels to identify where the divergence is concentrated.',
    unit: 'MOS-LQO (1–5)',
    proTip: 'ViSQOL was designed for speech quality assessment (Google, 2021) but performs well on music. Unlike PEAQ (which uses a fixed model trained on speech), ViSQOL uses NSIM (neural structural similarity) on gammatone spectrograms, making it sensitive to harmonic distortion and time-frequency smearing — the two artifacts mastering limiters introduce most.',
  },

  generation_loss: {
    metric: 'Gen-Loss',
    fullName: 'Generation Loss Probability',
    oneLiner: 'Probability that this file was previously encoded as lossy audio (MP3/AAC) before re-saving.',
    why: 'Delivering a file that has already been through a lossy codec introduces "generation loss" — codec artifacts baked in permanently. The telltale signs are spectral shelf patterns (high-frequency content cut at 16–20 kHz), tonal smearing in the transient region, and characteristic inter-frame spectral ringing. Detecting this early prevents delivering a compromised master and avoids re-encoding with second-generation artifacts.',
    range: 'Below 0.3: likely lossless · 0.3–0.7: suspect (worth checking) · Above 0.7: likely prior lossy encode',
    tooHigh: 'The file shows strong evidence of prior lossy encoding. Request the original lossless WAV/AIFF from the mixer. If unavailable, note this in the delivery metadata — the master may not qualify for Apple Digital Masters or Tidal Masters.',
    tooLow: '',
    unit: 'probability (0–1)',
    proTip: 'The detector runs an ONNX neural network (ArtifactNet) trained on thousands of encode/decode cycles at different bitrates. It is most reliable above 128 kbps MP3 and AAC. At very high bitrates (320 kbps+), codec artifacts can be below the detection threshold — use the frequency rolloff in the spectrum view as a secondary check.',
  },

  limiter_artefacts: {
    metric: 'Limiter',
    fullName: 'Limiter Artefact Severity',
    oneLiner: 'Whether the master\'s limiter is creating audible pumping, ringing, or inter-sample distortion.',
    why: 'A limiter that is working too hard leaves measurable artifacts: gain-reduction pumping (loudness breathing on the mix bus), inter-sample peaks that exceed 0 dBFS after codec encoding, and high-frequency ringing from the limiter\'s look-ahead filter. These artifacts are often subtle in isolation but become audible after codec encoding — or on playback systems without headroom above 0 dBFS.',
    range: 'Clean: no artifacts · Advisory: minor pumping, no inter-sample overs · Warning: moderate pumping · Problem: audible pumping, multiple TP overs',
    tooHigh: 'The limiter is over-working. Reduce input gain by 1–2 dB, raise the limiter ceiling from −0.1 to −0.3 dBTP, or use a "brick wall" style limiter with a more transparent release character. Check if the mix needs a bus compressor to reduce gain variance before the limiter sees it.',
    tooLow: '',
    unit: 'severity (clean / advisory / warning / problem)',
    proTip: 'Pumping is primarily caused by the limiter\'s release time interacting with the kick drum pattern. Set release to "auto" or "program-dependent" in transparent limiters (Fabfilter Pro-L2, Waves L2, iZotope Ozone Maximizer). For dance music, try multi-band limiting so the sub-bass drives the gain reduction — not the kick transient — letting the midrange breathe more freely.',
  },

  crest_factor: {
    metric: 'Crest',
    fullName: 'Crest Factor (dB)',
    oneLiner: 'Ratio of peak level to RMS average level — a measure of transient headroom.',
    why: 'Crest factor directly measures how far the loudest peaks rise above the average energy in the mix. A high crest factor means the mix has dynamic peaks (punchy kick, sharp snare) that sit well above the average level; a low crest factor means peaks and RMS are close together — the waveform is dense and "bricked." This differs from LRA (which measures statistical loudness distribution) by focusing on the raw peak-to-average relationship.',
    range: '8–14 dB (natural recordings) · 6–10 dB (commercial pop/rock) · 4–8 dB (heavily limited EDM/pop) · below 4 dB = extremely limited',
    tooHigh: 'Very high crest factor (> 15 dB) can mean the mix is under-compressed and some passages may sound inconsistently quiet. Consider gentle bus compression with a slow attack to add cohesion.',
    tooLow: 'The waveform is heavily saturated. Transients have been compressed or limited flat. This can sound loud but fatiguing — especially on long listening sessions. Reduce limiting, increase the limiter ceiling, or use parallel compression.',
    unit: 'dB',
    proTip: 'Crest factor and PLR are related but different: PLR uses true peak (inter-sample), while crest factor uses sample-level peak. On a heavily limited master, PLR can be 0.5 dB lower than crest factor because the true peak limiter is just barely catching inter-sample peaks.',
  },

  plr_plausibility: {
    metric: 'PLR Check',
    fullName: 'Peak-to-Loudness Ratio Plausibility',
    oneLiner: 'Internal consistency check: does the true peak vs. LUFS-I relationship make physical sense?',
    why: 'PLR = True Peak − LUFS-I. For a well-mastered track, PLR should fall within a physical range (typically 0.5–14 LU). A very low PLR at a moderate LUFS level implies the master has been simultaneously loud (low LUFS) and peak-limited (low dBTP) in a way that suggests measurement error or extreme limiting. A very high PLR at a hot LUFS level implies an unusual signal that needs verification.',
    range: 'Typical: 6–14 LU · Compressed pop: 2–6 LU · Suspect if below 0 LU (impossible: true peak cannot be lower than LUFS-I in absolute terms)',
    tooHigh: 'PLR above 14 LU at hot LUFS levels may indicate a clipped or corrupted file where the peak detector is reading incorrectly.',
    tooLow: 'PLR near 0 or negative suggests the limiting is extreme enough to raise the average level very close to the peak ceiling. This is a hallmark of loudness maximization pushed to its limit.',
    unit: 'LU',
    proTip: 'This check is a calibration tool, not a delivery gate. Use it to catch measurement anomalies — e.g. if your sample-peak meter and true-peak meter disagree significantly, it may indicate the master has intersample overs that would cause codec distortion.',
  },

  broadband_gain: {
    metric: 'ΔBB',
    fullName: 'Broadband Gain Delta (dB)',
    oneLiner: 'How much louder or quieter File B is vs. File A across the full frequency range.',
    why: 'Mastering typically adds 2–6 dB of overall loudness via limiting and gain staging. This number captures that total gain change. It is the macro-level view: if the mix is at −16 LUFS and the master is at −14 LUFS, broadband gain is approximately +2 dB.',
    range: '2–6 dB is typical for commercial music mastering · 0 dB = no level change · > 8 dB = aggressive loudness maximization',
    tooHigh: 'More than 8–10 dB of broadband gain almost always means the master has been significantly limited and likely has audible artifacts. The extra loudness comes at the cost of crest factor, transient integrity, and PLR.',
    tooLow: 'Negative broadband gain (B quieter than A) is unusual for a mastering session. Verify the files are in the right order — or check if de-essing or heavy multi-band compression has reduced average loudness.',
    unit: 'dB',
    proTip: 'Broadband gain is only part of the mastering story. A 2 dB broadband gain with ±3 dB per-band EQ moves tells a richer story than the single number implies — use the per-band chart below to see the tonal shape change alongside the level change.',
  },

  lra_delta: {
    metric: 'ΔLRA',
    fullName: 'Loudness Range Delta (LU)',
    oneLiner: 'How much the dynamic range (LRA) changed between mix and master.',
    why: 'Mastering compression and limiting always reduce LRA — the question is by how much. A small LRA reduction (1–2 LU) means the mastering was dynamic-friendly; a large reduction (5+ LU) means heavy compression or limiting has significantly flattened the dynamic arc of the track.',
    range: 'Typical mastering: −1 to −3 LU (slight tightening) · Competitive loudness: −3 to −6 LU · Heavy maximization: > −6 LU',
    tooHigh: 'A positive ΔLRA would mean the master is MORE dynamic than the mix — which is unusual unless the mix had heavy compression that was removed in mastering.',
    tooLow: 'Very negative ΔLRA (> −6 LU) indicates the mastering significantly flattened dynamics. This is deliberate for EDM and pop, but may not be appropriate for jazz, folk, or classical.',
    unit: 'LU',
    proTip: 'ΔLRA is one of the best single metrics for quickly assessing "how hard was the limiter working?" Compare it to broadband gain: a +3 dB broadband gain with only −1 LU ΔLRA is a good mastering outcome — loud and dynamic. A +3 dB gain with −5 LU ΔLRA means loudness was bought at the cost of dynamics.',
  },

  streaming_platform: {
    metric: 'Platform',
    fullName: 'Streaming Platform Loudness Preview',
    oneLiner: 'What volume adjustment each platform will apply to your master before the listener hears it.',
    why: 'Every major streaming platform (Spotify, Apple Music, YouTube, Tidal, Amazon) normalizes playback loudness to a target level. If your master is louder than the target, the platform turns it down. If quieter, some platforms turn it up. This preview shows exactly how much gain adjustment your master will receive on each platform — so you know in advance whether your mix will lose its loudness advantage or whether there is room to be louder.',
    range: 'Spotify: −14 LUFS target · Apple Music: −16 LUFS target (−13 on Sound Check) · YouTube: −14 LUFS · Amazon Music: −14 LUFS · Tidal: −14 LUFS',
    tooHigh: 'Platform will turn the master DOWN. The delta shown is the gain reduction. This does not hurt the master — it just means the extra loudness was wasted. The listener hears it at the platform target level, same as a quieter master.',
    tooLow: 'Platform may turn the master UP (if platform allows boost — Apple Music and YouTube do not boost; Spotify may boost up to +5 dB for quiet tracks). Boosting can expose noise and make the master sound thinner.',
    unit: 'dB (positive = boosted, negative = attenuated)',
    proTip: 'Targeting −14 LUFS with −1.0 dBTP is the "universal pass": Spotify, YouTube, Apple Music, Tidal, and Amazon will all play it at essentially the same level with no normalization penalty. The only platform that targets differently is broadcast (−23 LUFS / EBU R128) — deliver a separate "broadcast" master for TV/film sync.',
  },

  eq_match_band: {
    metric: 'EQ Match',
    fullName: 'Parametric EQ Match Band',
    oneLiner: 'A single suggested EQ move to bring File B\'s tonal balance closer to File A.',
    why: 'The EQ match algorithm analyzes the per-band spectral difference between the two files and converts significant differences into parametric EQ band suggestions. Each band shows a center frequency (where to apply the EQ), a gain amount (how much to boost or cut), and a Q value (how wide or narrow the filter should be). These are starting-point suggestions — apply 50% of the suggestion, listen, and adjust.',
    range: 'Gain: ±0.5 to ±4 dB (50% of measured difference) · Q: 0.7 (broad shelf) to 3.0 (surgical)',
    tooHigh: 'A positive gain_db means File B needs a boost in this region to match File A — File A has more energy here.',
    tooLow: 'A negative gain_db means File B needs a cut in this region — it has excess energy compared to File A.',
    unit: 'dB at Hz, Q',
    proTip: 'Q (quality factor) determines filter width: Q=0.7 affects about 2 octaves (like a broad tilt), Q=1.4 affects about 1 octave (like a standard bell curve), Q=3.0 affects about 1/2 octave (surgical). Start with the broad, high-gain suggestions first — they are the biggest tonal differences. Narrow high-Q suggestions are often resonances or room artifacts rather than tonal balance issues.',
  },

}
