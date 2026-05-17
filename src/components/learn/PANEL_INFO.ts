/**
 * PANEL_INFO — Audience-specific descriptions for every major panel in RTMcompare.
 *
 * Used by PanelInfo.tsx to render a contextual info balloon whose copy adapts
 * to who is using the app:
 *   pro      — mastering engineer, assumes deep technical knowledge
 *   producer — release-ready creator, plain English, action-oriented
 *   student  — learning mode, linked to standards, explains "why"
 *   teacher  — instructor prompts, red flags, discussion hooks
 *
 * Keys map to the `panelId` prop on CollapsibleSection / PanelInfo.
 */

export type Audience = 'pro' | 'producer' | 'student' | 'teacher'

export interface PanelInfoContent {
  /** Displayed in the popover header */
  label: string
  pro: string
  producer: string
  student: string
  teacher: string
  /** Optional universal tip shown below the audience copy (same for all) */
  tip?: string
}

export const PANEL_INFO: Record<string, PanelInfoContent> = {

  // ─── OVERVIEW TAB ─────────────────────────────────────────────────────────

  overview: {
    label: 'Overall Summary',
    pro: 'Integrated loudness (LUFS-I), true peak (dBTP), LRA, PLR, stereo width, and mono compat for both files — side by side with delta. Level-match flag tells you if A/B were auto-gain-staged for fair comparison.',
    producer: 'The main scorecard: how loud is your master, how dynamic is it, and will it play the same on earbuds and speakers? Green rows mean you\'re on target. Red rows are things to fix before you release.',
    student: 'This panel applies the core ITU-R BS.1770-4 loudness chain: gated LUFS-I for programme loudness, true peak for inter-sample safety, and LRA for dynamic range. Start every analysis session here — the numbers tell you what to listen for before you press play.',
    teacher: 'Ask students to predict each number before revealing: "What do you expect the LRA to be for a heavily limited EDM track?" Then reveal the reading. Discrepancy between expectation and measurement reveals gaps in their mental model of mastering compression.',
    tip: 'Hover any metric label for a full engineering definition with target ranges and remediation guidance.',
  },

  waveform: {
    label: 'Waveform Comparison',
    pro: 'Sample-accurate waveform overlay. Peak envelope differences expose broad-band gain staging changes, clipper action, and limiter breath. Zoom in to compare transient structure frame-by-frame.',
    producer: 'Visual shape of both files on top of each other. A flat, brick-like shape means the master is heavily limited. More peaks and valleys means more dynamic range — which is usually what you want unless you\'re going for maximum loudness.',
    student: 'The waveform shows the amplitude envelope over time. Notice how the mastered version (B) is typically taller and more "full" than the mix (A) — this is the broadband gain added by the mastering limiter. Flat-topped regions indicate hard clipping.',
    teacher: 'Have students identify: (1) which file is the master and which is the mix, just from visual shape; (2) where the loudest and quietest sections are; (3) any suspect flat-top clipping regions. This builds the habit of looking before listening.',
    tip: 'The waveform uses the same peak envelope as your DAW — compare it with the LUFS timeline below to see where loudness and peak diverge.',
  },

  loudness_timeline: {
    label: 'Loudness Over Time',
    pro: 'Short-term LUFS (3-second window, EBU Tech 3341) plotted at ~10 Hz. Dashed platform lines show streaming normalization targets. Momentary LUFS (400 ms) overlaid when available — catches pumping events the short-term average smooths over.',
    producer: 'See how loud each section of your track is, moment by moment. The dashed lines show where streaming services target — anything above them gets turned down. Great for catching an over-compressed chorus or a quiet intro that breaks up the energy flow.',
    student: 'Short-term loudness uses a 3-second gate sliding window per EBU Tech 3341. This differs from LUFS-I (which gates the whole programme). A high short-term value in the chorus relative to the verse is your dynamic range in action — it\'s the difference between a flat master and an expressive one.',
    teacher: 'Great class exercise: show two versions of the same song — one with uniform short-term loudness, one with real dynamic arc. Ask which one is more tiring to listen to and why. Then discuss the loudness war and its perceptual consequences.',
    tip: 'Enable "Momentary" view for 400 ms resolution — essential for catching brief pumping events that the 3-second line smooths over.',
  },

  streaming_delivery: {
    label: 'Streaming Platform Delivery',
    pro: 'Per-platform gain offset, true peak after normalization, and TP breach flag for Spotify, Apple Music, YouTube, Tidal, Amazon, and Deezer. The ≋ button plays codec output at platform level through the AB player for in-context critical listening.',
    producer: 'Will Spotify turn your master down? This table answers it for every major platform. Hit play on any row to hear exactly what listeners will hear. A red TP flag means the platform\'s own codec will introduce brief distortion — fix it by lowering your limiter ceiling.',
    student: 'Each streaming platform normalizes playback loudness to a target (Spotify: −14 LUFS, Apple Music: −16 LUFS). This panel applies each platform\'s normalization math to your file and shows the resulting gain offset and playback level. You cannot "beat" normalization by making your master louder — louder masters just get turned down more.',
    teacher: 'Core misconception to address: "Louder is better." Show how a −7 LUFS master and a −14 LUFS master sound identical on Spotify (both played at −14 LUFS), but the −14 LUFS version preserved more dynamics and transient energy. This is the central argument against the loudness war.',
    tip: 'The codec preview (≋ button) processes through the actual AAC/Vorbis encoder for that platform — not just a gain offset. You\'ll hear encoder artifacts that only appear after lossy compression.',
  },

  metadata: {
    label: 'Embedded Metadata',
    pro: 'BEXT (Broadcast WAV), iXML, and LIST-INFO chunks parsed from the file header. ISRC, originator, scene/take for ADR workflows. UMID for broadcast archiving. Validates presence of delivery-required fields per Apple, Spotify, and Netflix specs.',
    producer: 'Tags baked into your audio file — title, artist, ISRC, and other info distributors use. Missing ISRC means the distributor has to guess which track this is. Missing or wrong metadata is one of the top reasons releases get held up at distribution.',
    student: 'WAV files support three metadata chunk formats: BEXT (EBU 3285), iXML (Production metadata), and LIST-INFO (ID3-adjacent). Each distributor expects different fields. An ISRC (International Standard Recording Code) is the primary track identifier in the global music catalog — without it, royalty matching fails.',
    teacher: 'Exercise: have students find the metadata for a track they know on an ISRC lookup database (CISAC, Soundcharts). Then check if the RTM reading matches. Good introduction to music rights infrastructure.',
  },

  // ─── BREAKDOWN TAB ────────────────────────────────────────────────────────

  per_element: {
    label: 'Per-Element Level Breakdown',
    pro: 'Stem-level level comparison when Deep Scan is active. Broadband and per-band level delta for kick, snare, bass, vocals, pads, guitars — identified via the neural instrument detector. Without Deep Scan, falls back to frequency-region energy comparison (kick ≈ 50–100 Hz, etc.).',
    producer: 'See which instruments changed the most between your mix and the reference. If the kick gained 2 dB but the vocals dropped 1 dB, your mastering EQ affected the balance. Great for catching unintended coloration from broad EQ moves.',
    student: 'The per-element analysis uses frequency-band segmentation to estimate the level of each instrument group across the spectrum. This approximates stem analysis without requiring actual stems. Each instrument has a characteristic frequency range — kick at 50–100 Hz, vocals at 300 Hz–8 kHz, hi-hats above 8 kHz. Deviations in those bands reflect level changes to those instruments.',
    teacher: 'Have students predict: "If the mastering engineer added 3 dB of low-shelf boost below 200 Hz, which instrument group do you expect to gain the most?" Then reveal the per-element result. Good for teaching frequency–instrument relationships.',
    tip: 'Run Deep Scan (Analysis menu → Deep Scan) for true stem-level analysis using neural source separation.',
  },

  masking: {
    label: 'Frequency Masking',
    pro: '1/3-octave energy competition analysis. High-masking pairs are identified by concurrent energy above the simultaneous masking threshold (Zwicker model). Flags frequency regions where two element groups compete — the perceptual louder element reduces audibility of the quieter.',
    producer: 'Shows where different instruments are fighting for the same frequency space. If bass and kick are both loud at 80 Hz, they mask each other — your kick loses punch, your bass sounds muddy. The fix is EQ carving: cut the bass where the kick lives, and vice versa.',
    student: 'Auditory masking is a psychoacoustic phenomenon: a louder sound at a given frequency temporarily elevates the threshold of hearing in nearby frequencies, making quieter simultaneous sounds inaudible. This is why frequency separation between instruments improves perceived clarity without making the mix louder.',
    teacher: 'Demonstrate with two pure tones at 100 Hz and 110 Hz played simultaneously — at similar levels, they are both audible. Raise one by 20 dB and the other disappears. Relate to the mix: which instruments are most commonly masking each other in student work? (Kick/bass and vocal/snare are the most frequent culprits.)',
    tip: 'High masking overlap is not always a problem — it depends on the genre. Heavy rock expects dense masking in the 2–5 kHz zone. Compare against your genre reference.',
  },

  transient_density: {
    label: 'Transient Density & Structure',
    pro: 'Per-second transient count with energy envelope. Auto-detected song sections (verse, chorus, bridge) using the transient flux and RMS envelope. Density timeline is useful for spotting over-compressed sections where drum transients have been flattened.',
    producer: 'How many hits and attacks happen per second, and where the energy builds and drops across your track. High density in a chorus is normal and good. A sudden drop in density mid-chorus might mean your limiter killed all the drum hits at the loudest moment.',
    student: 'Transient density is computed from onset detection — identifying the moment when signal energy rises sharply above the local noise floor. A higher transient rate correlates with percussive content and rhythmic complexity. Over-limiting (fast attack, high gain reduction) suppresses transients, reducing density.',
    teacher: 'Ask: "Why does a compressed master sometimes sound louder but feel less exciting?" Transient density is the answer — the absolute level went up but the punch went down. Show a high-DR and low-DR version of the same track and compare their transient timelines.',
    tip: 'The section labels (verse, chorus, bridge) are auto-detected from the energy arc — useful as navigation anchors but not always musically precise.',
  },

  tonal_issues: {
    label: 'Tonal Balance Issues',
    pro: 'Perceptual-model detector for classic mastering imbalances: harshness (2–5 kHz excess), boominess (100–300 Hz buildup), sibilance (5–9 kHz S/T energy), muddiness (200–500 Hz), boxiness (300–700 Hz), and thinness (sub-200 Hz deficit). Triage by perceptual priority, not dB magnitude.',
    producer: 'Points out the specific frequency problems that make mixes sound amateurish: too boomy, too harsh, too sibilant. Each issue is labeled in plain English so you know exactly what to fix. A "harshness" flag means your ears will hurt on a long listen — EQ cut in the 3–5 kHz range usually fixes it.',
    student: 'These issues are defined by regions of excess or deficit in the 1/3-octave spectrum compared to a genre-weighted target curve. Each label corresponds to a classic mastering feedback descriptor. Learning to hear these without looking at the screen is a core skill — listen first, then verify.',
    teacher: 'Have students write down one tonal adjective for each track before running analysis. Then compare their vocabulary with the detector\'s output. High agreement means good critical listening development. Common gap: students often say "muddy" when they mean "boomy" — the distinction is the frequency range (mud is 200–500 Hz, boom is 100–200 Hz).',
    tip: 'Issues are sorted by perceptual impact, not dB severity. A 3 dB excess at 3 kHz (harshness) is more audible than a 5 dB excess at 30 Hz — the detector weights accordingly.',
  },

  // ─── MASTERING TAB ────────────────────────────────────────────────────────

  mastering_delta: {
    label: 'Mastering Delta',
    pro: 'Broadband and per-band gain, compression character, LRA delta, PSR, PLR, crest trajectory, transient homogeneity, stereo width per band, and polarity check. The EQ match bands are the half-delta parametric suggestion set derived from the 31-band difference. Ozone chain push via RTMsend is live when Ozone Advanced is loaded.',
    producer: 'The full breakdown of what mastering did to your mix: how much louder, how much more compressed, what happened to the stereo image, and where EQ was added. The EQ bands are starting-point suggestions — try them in your DAW and adjust to taste.',
    student: 'The mastering delta quantifies every measurable change between mix and master. Key relationships to understand: broadband gain + LRA delta tells you compression character; per-band gain delta shows EQ coloration; stereo width change shows M/S processing decisions. All of these together describe the mastering signature.',
    teacher: 'Give students a mystery mastered track and have them predict the engineer\'s approach from the delta numbers alone: "Was this compressed heavily? Was there low-end EQ? Was M/S processing used?" Then reveal the engineer\'s notes or settings for cross-check.',
    tip: 'The "Send to Ozone" button pushes all suggested settings directly into Ozone Advanced as a loaded preset — no copy-paste needed. Requires RTMsend loaded in your DAW.',
  },

  // ─── STEREO & SPECTRUM TAB ────────────────────────────────────────────────

  spectrum_overlay: {
    label: 'Frequency Spectrum',
    pro: '31-band 1/3-octave spectrum comparison (ISO 532-1 / IEC 61672). Welch PSD with flat-top window for amplitude accuracy (±0.01 dB). Mid/Side split toggles expose M/S processing. The spectrum is the same 31-band vector used in all other tonal comparisons — consistent across panels.',
    producer: 'A side-by-side frequency balance comparison across 31 bands. Where the gold line (your file) is above the reference, your file has more energy in that range. Below = less. Use this to find exactly which EQ moves were made and how to replicate or reverse them.',
    student: 'The 1/3-octave spectrum divides the hearing range (20 Hz – 20 kHz) into 31 bands, each roughly 1/3 of an octave wide. This matches the resolution of the human auditory system\'s critical bands (Bark scale). A smoothed spectrum hides fine detail but reveals the broad tonal character — which is what matters most for mastering decisions.',
    teacher: 'Useful exercise: have students describe the spectral difference in words ("more low-end," "brighter highs") before switching on the numerical overlay. Builds the vocabulary connection between what they hear and what they see. Then ask them to predict which EQ moves would close the gap.',
    tip: 'Toggle Mid/Side to see if the tonal difference is primarily in the center (Mid) or the stereo field (Side). A brighter Side channel is typical of wide stereo wideners that add high-frequency divergence.',
  },

  spectrogram: {
    label: 'Spectrogram',
    pro: 'Mel-scale spectrogram (128 mel bins, 512 samples/frame) for both files. Time on X, frequency on Y, energy as brightness. Useful for catching sustained resonances, noise floors, codec artifacts (HF shelf cutoff at encode), and spectral holes from narrow cuts.',
    producer: 'A heat map of your audio over time — brighter = louder in that frequency range at that moment. Compare A and B to see if mastering added brightness (hot high-frequency patches), reduced low-end buildup, or introduced any strange sustained tones that weren\'t there before.',
    student: 'A spectrogram converts audio from time-domain (amplitude vs. time) to time-frequency (energy vs. time vs. frequency). The mel scale compresses high frequencies non-linearly to match hearing sensitivity. Codec artifacts often appear as a sharp horizontal cutoff line around 16–20 kHz — the encoder\'s high-frequency shelf.',
    teacher: 'Show a lossy MP3-converted file alongside a lossless original. The spectral shelf cutoff is immediately visible on the spectrogram — a practical demonstration of codec artifacts. Ask students what other artifacts they can identify (pre-echo, smearing, tonal pumping).',
    tip: 'Compare A and B spectrograms side by side to spot EQ changes as differential brightness — the mastered file is typically brighter above 8 kHz (air boost) and cleaner below 50 Hz (HP filter).',
  },

  mono_compat: {
    label: 'Mono Compatibility',
    pro: 'Per-band mono loss using the M−S cancellation formula: (L−R)/(L+R) per frequency bin, aggregated per 1/3-octave band. High-loss bands indicate out-of-phase stereo content at those frequencies — typically from stereo wideners, modulation effects, or un-encoded M/S content.',
    producer: 'How much of your audio disappears when both channels are summed to mono. Phone speakers, Bluetooth, club PA center fills — they all sum to mono. High loss in the bass range (below 200 Hz) is especially problematic: your low end vanishes on small speakers. The goal is under 10% loss across the spectrum.',
    student: 'Mono compatibility loss is calculated as 1 − correlation. A stereo signal where L and R are identical (ρ=1) has 0% mono loss. A signal where L and R are perfectly out of phase (ρ=−1) is 100% cancellation in mono. Real mixes fall between these extremes. The sub-bass should always be near-mono (loss < 5%) — any phase divergence below 100 Hz wastes speaker excursion.',
    teacher: 'Live demo: solo the Side channel in a real mix. Whatever you hear is what gets canceled when played in mono. Students are often surprised by how much reverb, stereo wideners, and delay returns live entirely in the Side — and disappear in mono playback.',
    tip: 'Bass below 100 Hz should always be mono. Any loss below that threshold indicates a mastering problem. Check by filtering the Side channel for sub content.',
  },

  phase_correlation: {
    label: 'Phase Correlation Over Time',
    pro: 'Pearson correlation coefficient of L and R channels plotted over the programme. Positive values: correlated (mono-compatible). Negative: anti-correlated (mono cancel). The timeline catches section-specific phase events the aggregate correlation number smooths over.',
    producer: 'The "neediness" of your stereo image over time. When the meter goes negative (below center), your left and right channels are fighting each other — sounds good on headphones but thin or empty on speakers summed to mono. Watch for sustained negative correlation that indicates a phase problem, not just a wide stereo moment.',
    student: 'Phase correlation is the normalized cross-correlation of the left and right channels. A value of +1 means the signals are identical (mono). 0 means uncorrelated. −1 means phase inverted — which creates complete cancellation when summed. Most commercial music sits between +0.3 and +0.9 depending on width.',
    teacher: 'Ask students: "What correlation value would you expect for a hard-panned ping-pong delay effect? What about a mono bass guitar?" Answers: the delay approaches 0 (uncorrelated L and R), the bass guitar approaches +1 (identical in both channels).',
    tip: 'Brief dips below zero are acceptable during wide stereo effects. Sustained periods below zero (more than 5–10 seconds) usually indicate a phase problem that should be fixed.',
  },

  phase_bands: {
    label: 'Phase Per Frequency Band',
    pro: 'Per-band phase correlation — same Pearson metric computed independently within each 1/3-octave band. Pinpoints frequency-specific phase issues that a broadband meter obscures. Critical for diagnosing M/S-encoded material, stereo-widened sub-bass, or phase-shifted mid-range from modulation effects.',
    producer: 'Phase health broken down by frequency range. Sub-bass should be fully correlated (mono). High frequencies can be wide and somewhat un-correlated — that\'s normal for reverb and stereo effects. A problem is when your low-mids or bass are showing negative phase — those frequencies need to be tightened up.',
    student: 'This view decomposes the broadband correlation into per-band readings. It reveals that stereo correlation is not uniform across the spectrum: low frequencies should be highly correlated for mono compatibility, while high frequencies can be less correlated due to reverb tails and stereo effects. This is why M/S processing (high-pass the Side channel) is standard practice in mastering.',
    teacher: 'Have students predict the phase profile of a mix before revealing the chart: "Where do you expect the highest correlation? The lowest?" Common correct answers: sub-bass is most correlated; 2–8 kHz (reverb and widened instruments) is least correlated. Surprising finding: vocals often have high correlation because they\'re center-panned.',
  },

  vectorscope: {
    label: 'Stereo Vectorscope',
    pro: 'Lissajous plot of L vs R rendered via Canvas 2D with phosphor-glow accumulation. Vertical axis = Mid energy (M = L+R), horizontal axis = Side energy (S = L−R). Confident tilt toward vertical = mono-compatible. "Bowtie" shape = full stereo image. "Butterfly" wings beyond ±45° = excessive side energy.',
    producer: 'The stereo shape of your audio, displayed as a glowing pattern. A tall, narrow shape means mostly mono content — vocals, bass, kick. A wide, open shape means big stereo — reverbs, synths, guitars. If the shape leans to one side, your mix has a balance problem. If it blows past the circle edges, check mono compatibility.',
    student: 'The vectorscope (also called a Lissajous display or goniometer) plots left channel on one diagonal axis and right channel on the other. The resulting shape reveals: orientation (mono content = vertical line), width (narrow = mono, wide = stereo), and balance (tilted left or right = panning asymmetry). The outer circle represents 0 dBFS on both channels simultaneously.',
    teacher: 'Useful exercise: have students describe the vectorscope shape in words ("tall," "wide," "tilted," "fuzzy") and then map those descriptions back to the mix elements they represent. This builds the critical skill of reading vector displays rather than just accepting them as abstract art.',
    tip: 'Press and hold on the vectorscope to freeze the frame for detailed inspection. The phosphor accumulation shows where energy concentrates most of the time.',
  },

  stereo_timeline: {
    label: 'Stereo Width Over Time',
    pro: 'Three synchronized timelines: stereo width (0–1), L/R correlation (−1 to +1), and L/R balance (dB). Windowed at 100 ms with 50 ms overlap. Useful for catching dynamic width changes from stereo wideners, section-specific balance shifts from automation, and correlation dips from modulation effects.',
    producer: 'Watch your stereo image change across the track. Does the chorus get wider than the verse? Does the bridge tighten up? Are there moments where the left or right channel dominates (balance)? These timelines show exactly when and where your stereo field changes — which is what mastering imaging tools respond to.',
    student: 'Stereo width is computed as (1 − ρ) / 2, where ρ is the L/R correlation coefficient. Width of 0 = perfectly correlated (mono); width of 1 = perfectly uncorrelated (maximum stereo, at risk of cancellation). Balance is simply L RMS − R RMS in decibels — a non-zero balance indicates stereo asymmetry.',
    teacher: 'Have students listen to the track first and annotate on paper when they expect the stereo to widen (often: chorus and bridge) and when it should tighten (often: intro and verse). Then reveal the timeline to compare their perception against the measurement.',
  },

  // ─── EQ MATCH TAB ─────────────────────────────────────────────────────────

  match_reference: {
    label: 'Reference EQ Match',
    pro: 'Half-delta parametric EQ bands derived from the 31-band spectrum difference between File A and File B. Bands are clustered per 1/2-octave to prevent over-specification. Live EQ preview via Web Audio API biquad chain. Export as Ozone XML, FabFilter FF preset, or REAPER RPP.',
    producer: 'Turns the tonal difference between your mix and the reference into actual EQ settings you can drop into your DAW. Toggle individual bands on/off to hear the effect live. Export the whole chain to Ozone or FabFilter when you\'re happy with the sound.',
    student: 'The EQ match algorithm computes the per-band spectrum difference, applies a half-delta reduction (50% of the difference prevents over-correction), and converts significant bands into parametric filter parameters (center freq, gain, Q). This is the same mathematical approach as Ozone\'s "Match EQ" feature.',
    teacher: 'Have students manually identify three EQ moves they would make from looking at the spectrum, then compare against the Reference EQ suggestions. Discussion: why did the algorithm suggest different moves than the student? (often: the algorithm is 1/3-octave resolution, the student may have identified narrow resonances).',
    tip: 'Use the Amount slider to scale all band gains simultaneously — start at 50% and work up. Full 100% is a mathematical match; real-world masters rarely need it.',
  },

  engineer_tips: {
    label: 'Engineer Tips',
    pro: 'Tonal, dynamics, and stereo tips derived from the loaded engineer profile\'s statistical model of their past masters. Each tip includes a quantified delta and an EQ band suggestion where applicable. The Tonal Curve chart shows your file vs. the profile\'s target with smoothed spectra (same Hann kernel as the Python backend).',
    producer: 'Get feedback styled like a specific mastering engineer would give it — what they would push, what they would pull back. The profile is built from their past masters, so the tips reflect their actual mastering signature. Try toggling the EQ bands to hear how close their sound is to what you\'re after.',
    student: 'Engineer profiles are built by analyzing a corpus of that engineer\'s past masters using the same 31-band pipeline. The resulting profile captures their tonal preferences (target frequency curve), dynamic character (compression aggressiveness), and stereo width habits. The tips show how your file diverges from their historical average.',
    teacher: 'Use this as a comparative study tool: load two different engineer profiles and compare their tonal signatures. Ask students: "What can you tell about this engineer\'s aesthetic from the target curve alone? Which genres would they be most suited to?" This builds critical evaluation of mastering styles.',
    tip: 'The "Hybrid" mode in the EQ Match tab combines Reference EQ moves (from your comparison) with Engineer EQ moves (from the profile) — taking the best of both and avoiding redundant overlapping bands.',
  },

  genre_analysis: {
    label: 'Genre Analysis',
    pro: 'Statistical genre target curve comparison using a corpus of commercial masters per genre (AllPurpose / Hip-Hop / Electronic / Rock / etc.). 1/3-octave delta with log-frequency Hann smoothing, TBC3 confidence bands, and a 7-axis radar (Sub, Bass, Low Mids, Mids, Upper Mids, Highs, Air). Score excludes sentinel bands (20–25 Hz, 20 kHz) to prevent centering artifacts.',
    producer: 'How does your master stack up against the typical sound of your genre? The radar shows 7 frequency regions and whether you\'re within the normal range for that genre. A "Needs work" score means your spectral balance is significantly different from successful releases in that genre.',
    student: 'The genre target curve is derived from the mean 1/3-octave spectrum of a corpus of commercial masters in that genre. Comparing your file against the genre mean tells you whether your tonal balance is genre-appropriate. Log-frequency smoothing is applied first to remove single-note resonances — you\'re comparing tonal character, not individual notes.',
    teacher: 'Useful discussion: "Why does genre matter for tonal balance?" Hip-Hop expects heavy sub and bass content; Classical expects flat, wide-range frequency response; EDM expects scooped mids and elevated highs. Have students predict the genre before loading the analysis — builds critical listening tied to genre conventions.',
    tip: 'Switch genres while looking at the same file — you\'ll see the score change dramatically. A mix that\'s "Good" for Hip-Hop may be "Needs work" for Pop because the genre targets are fundamentally different.',
  },

  master_assistant: {
    label: 'Master Assistant',
    pro: 'One-click mastering chain proposer: HPF → EQ → compressor → TP limiter → dither. Parameters derived from the comparison analysis and target platform. Renders offline through the Python pipeline (not Web Audio) for sample-accurate output. Provides bounce-ready WAV at any delivery spec.',
    producer: 'Choose a platform (Spotify, Apple, YouTube, etc.) and the Assistant builds a complete mastering chain for your file — gain staging, EQ, compression, limiting, all configured to hit that platform\'s target loudness. Preview the result in the player, adjust each stage, and render a delivery-ready WAV.',
    student: 'The mastering chain is a sequence of processors: HPF removes sub-sonic content; EQ shapes tonal balance; bus compression adds cohesion; limiting raises loudness to target; dither removes quantization noise. The Assistant derives each parameter from the measured difference between your file\'s current state and the delivery specification.',
    teacher: 'Use the chain preview as a teaching document: show students how much gain each stage adds, where the frequency response changes, and what the limiter gain reduction looks like. Ask: "If you removed the HPF, how would the limiter behave differently?" Answer: the sub-bass energy would drive more gain reduction, making the limiter work harder.',
    tip: 'Adjust the Amount slider for each stage — 100% applies the full algorithmic suggestion, 50% gives you a lighter touch to preserve your mix bus feel.',
  },

  reference_library: {
    label: 'Reference Library',
    pro: 'Persistent shelf of pre-analyzed reference tracks. Each record stores the full 31-band spectrum, LUFS-I, LRA, true peak, BPM, key, and user tags — loaded instantly for any comparison without re-scanning. Files analyzed in any session are auto-added to the library.',
    producer: 'Your personal collection of reference tracks, always ready. Any song you\'ve analyzed in RTMcompare is automatically saved here. Pick one as your reference (File A) and immediately get the EQ match and loudness comparison — no waiting for it to re-scan.',
    student: 'A reference library is a mastering engineer\'s most important tool. Building a curated set of well-mastered tracks in each genre you work on lets you compare your work against a known standard rather than working from memory. The spectrum data is pre-extracted so comparisons are instant.',
    teacher: 'Assign students to build a 5-track reference library in a given genre as homework — one track from each decade (70s through today, or 2000s through today). Then discuss how mastering conventions changed across the decades using the spectrum and LUFS comparisons.',
    tip: 'Click any reference card\'s "Use" button to instantly load it as File A — it becomes the reference for the current comparison without you needing to locate the file on disk.',
  },

  // ─── QUALITY TAB ──────────────────────────────────────────────────────────

  distortion: {
    label: 'Distortion & Clipping',
    pro: 'Hard clip detection (sample-level flattopping), THD estimation (harmonic analysis), inter-sample overs above 0 dBFS, and limiter over-processing flag (flat-peak percentage > threshold). Severity verdict aggregates all three with confidence weighting.',
    producer: 'Catches clipping, digital distortion, and over-limiting. Any red flag here means something in your signal chain drove too hard. If the master shows clipping but the mix doesn\'t, your mastering limiter ceiling is too high. If both show distortion, the problem is upstream in the mix.',
    student: 'Clipping occurs when a digital audio signal exceeds 0 dBFS. At the sample level, the waveform is "flat-topped" — the peaks are all equal rather than forming natural amplitude curves. This introduces hard harmonics at high odd multiples (3rd, 5th, 7th) that are perceived as a harsh buzzing. The true peak measurement (4× oversampled) catches inter-sample clipping that the sample-level peak meter misses.',
    teacher: 'Demonstration: take a 1 kHz sine wave, clip it to flat-top at various levels, and show the harmonic spectrum at each stage. Students will hear the buzzy change in timbre. Then discuss why soft clipping (gentle saturation) sounds more musical than hard clipping — it generates mostly even harmonics (2nd, 4th) which are musically consonant.',
    tip: 'Low-confidence warnings (THD only, no hard clips) are often intentional saturation — listen before acting. High-confidence warnings (clip runs, TP over 0 dBTP) need to be fixed before delivery.',
  },

  limiter_artefacts: {
    label: 'Limiter Artefacts',
    pro: 'Pumping detector via gain-reduction envelope analysis, inter-sample over counter (potential codec distortion), and HF ringing detector (look-ahead filter residual). Severity verdict: Clean / Advisory / Warning / Problem.',
    producer: 'Catches when your limiter is working too hard: audible breathing (pumping), high-frequency ringing after loud transients, and inter-sample peaks that will distort in AAC. If this flags "Warning" or "Problem," back off your limiter by 1–2 dB and re-bounce.',
    student: 'A transparent limiter should be inaudible. When it works too hard, it introduces three main artifacts: (1) pumping — the gain reduction modulates the programme level so the mix seems to breathe in and out; (2) inter-sample overs — peaks that exist between samples and will clip in digital-to-analogue or codec conversion; (3) HF ringing — the look-ahead filter\'s impulse response leaves a brief resonance after each large transient.',
    teacher: 'Play two versions of a heavy hip-hop beat: one with a transparent master (limiter at −0.3 dBTP ceiling, PLR 8 LU) and one pushed 6 dB harder (limiter at −0.1 dBTP, PLR 2 LU). Students should hear the pumping and loss of transient snap. Then show the artifact detector\'s verdict on both.',
    tip: 'The pumping score correlates with the periodic gain-reduction envelope. A pumping score above 0.6 is audible to most listeners on a system with good bass response.',
  },

  click_timeline: {
    label: 'Click & Artifact Timeline',
    pro: 'Time-domain transient artifact detector using adaptive threshold: identifies events where the signal energy rises sharply (> N σ above local RMS) and drops equally sharply — the signature of an edit error, ADC glitch, or bit-depth discontinuity. Click events sorted by severity and shown on the waveform timeline.',
    producer: 'Finds clicks, pops, and digital glitches anywhere in your file. A single audible click in a release is a quality failure. Click a timestamp to hear the exact moment. Zero clicks = delivery-ready. Anything higher = locate and fix in your DAW before bouncing.',
    student: 'Clicks and pops are caused by discontinuities in the audio signal — places where the waveform jumps discontinuously rather than following a smooth curve. Common causes: un-crossfaded edit points, sample-rate conversion errors, buffer dropouts during recording, and bit-depth conversion without dither. The human ear is extremely sensitive to these events — even a single 1 ms click in a 4-minute track is noticed.',
    teacher: 'Have students record 30 seconds of audio through a low-quality interface or without proper buffer settings to intentionally introduce buffer dropout clicks. Run through the detector. Good practical lesson in signal chain hygiene and the physical cause of digital artifacts.',
    tip: 'Not every detection is audible — very short, low-energy events may be sub-perceptual. Always listen at the flagged timestamp before deciding whether to fix it.',
  },

  hum: {
    label: 'Electrical Hum',
    pro: '50/60 Hz fundamental detector with harmonic analysis up to 5th harmonic. Notch preset auto-generated (center freq, Q ≈ 30). Severity classification: Negligible / Mild / Moderate / Severe. North America = 60 Hz mains, EU/Asia = 50 Hz.',
    producer: 'Finds AC mains noise baked into your recording — the 50 or 60 Hz hum from power cables, ground loops, or unbalanced gear. Usually inaudible under music but revealed during quiet passages and fade-outs. The notch preset gives you the exact EQ settings to remove it.',
    student: 'Mains hum enters recordings through electromagnetic induction from AC power cables and ground potential differences in connected equipment (ground loops). The fundamental frequency (50 or 60 Hz) and its harmonics (100, 150, 200 Hz... or 120, 180, 240 Hz...) are characteristic in both frequency and harmonic spacing — making them identifiable by the detector even at relatively low amplitudes.',
    teacher: 'Bring an unshielded single-coil electric guitar to class and demonstrate ground loop induction — touching a grounded metal object stops the hum, letting go starts it. This demonstrates the electrostatic source. Then have students locate similar issues in their own recordings using the detector.',
    tip: 'Apply the auto-generated notch preset to a duplicate track in your DAW. A/B it against the original during a quiet passage to assess audibility. If you can\'t hear it under music, it may not be worth treating.',
  },

  // ─── ATMOS TAB ────────────────────────────────────────────────────────────

  atmos_qc: {
    label: 'Dolby Atmos QC',
    pro: 'Hard-spec validation: loudness (−18 LUFS ±1 LU dialogue-gated), true peak (−1 dBTP), sample rate (48 kHz), bit depth (24-bit), channel count, and bed/object activity. Checks match Apple Music, Tidal, and Amazon Music Atmos delivery specs. HOLD = do not submit; WARN = submit at risk; READY = all checks pass.',
    producer: 'Will your Atmos mix be accepted by Apple Music and Tidal? This runs every technical check they require: loudness, peaks, sample rate, bit depth, and channel activity. One red HOLD flag means rejection — fix it before submitting.',
    student: 'Dolby Atmos music deliveries require precise technical compliance with the platform\'s ingest spec. Unlike stereo delivery (which is forgiving within a few dB), Atmos has hard requirements: −18 LUFS dialogue-gated loudness, −1.0 dBTP ceiling, 48 kHz sample rate, and 24-bit depth. These are not negotiable — non-compliant files are automatically rejected.',
    teacher: 'Compare the Atmos loudness requirement (−18 LUFS dialogue-gated) to stereo streaming (−14 LUFS integrated). Ask: why is Atmos louder in absolute dBFS but has a lower LUFS target? Because the Atmos master is intended for playback on high-headroom systems (home theater) where the gain structure allows more dynamic range without clipping.',
    tip: 'The HOLD/WARN/READY banner is the first thing a delivery engineer sees. HOLD means submission rejection. Fix all HOLD items before any other optimization.',
  },

  atmos_surround: {
    label: 'Atmos Surround Field',
    pro: 'Top-down energy map of the bed speaker layout (L, C, R, Ls, Rs, Lrs, Rrs, LFE, Ltf, Rtf, Ltm, Rtm, Ltr, Rtr). Circle area is proportional to RMS level per channel. Dashed outlines = height channels. Useful for identifying imbalanced bed mixes and silent channels occupying slots.',
    producer: 'A bird\'s-eye view of how your sound is spread across the speaker layout. Each circle represents a speaker — bigger circle = louder. Verify your mix has the right balance before delivery: center should carry the lead, left/right should be balanced, height channels should have some content, and LFE should have bass.',
    student: 'The Atmos bed is a standard multichannel audio format (typically 7.1.4 for music delivery). Each channel carries fixed speaker assignment. The energy map shows how the mix engineer distributed sound across the speaker array. Height channels (Ltf, Rtf, etc.) carry spatial reverb and overhead effects — they should not be empty in an Atmos mix.',
    teacher: 'Ask students to identify which speaker carries the most energy in a typical Atmos music mix (answer: usually C or L/R). Then ask why height channels have less energy than ear-level channels (they\'re usually reverb returns and spatial effects, not primary content). This connects the Atmos format to its perceptual purpose.',
    tip: 'Silent channels (near-zero energy) in the Atmos bed waste ADM slots and may indicate an incorrect routing in the mix session. Identify and fix before submission.',
  },

  atmos_objects: {
    label: 'Atmos Object Trajectories',
    pro: 'Per-object position data from the ADM binary metadata: azimuth, elevation, and distance over time. Trajectory visualization shows motion paths. Static objects (zero motion variance) and hot objects (RMS > −3 dBFS) are flagged — both are common delivery errors.',
    producer: 'Shows where each Atmos object moves in the 3D soundfield and how loud each one is. If an object shows as "static" (never moves), it\'s usually a mistake — most Atmos objects should have some automation. A "hot" object is too loud relative to the overall programme and may cause downstream clipping.',
    student: 'Dolby Atmos uses object-based audio metadata to describe the position of each sound element in 3D space at each moment. Unlike the bed (which has fixed speaker positions), objects are renderer-decoded in real-time based on the playback system\'s layout. Position data is stored in the ADM container as XYZ or azimuth/elevation/distance coordinates.',
    teacher: 'Have students listen to an Atmos mix with binaural playback while watching the trajectory visualization. They should hear positional changes correlating with object movement in the display. Builds the connection between ADM metadata and the perceptual 3D experience.',
    tip: 'The heatmap view aggregates all object positions over time — brighter areas indicate where spatial attention is concentrated most of the mix. Compare against the mix engineer\'s creative intent.',
  },

  atmos_channels: {
    label: 'Atmos Channel Energy',
    pro: 'Per-channel RMS measured from the rendered ADM audio. Channels classified as ear-level, height, or LFE. LFE-specific analysis: content above 120 Hz flags incorrect routing (LFE is a band-limited channel, not a general subwoofer signal). Active/silent classification per channel.',
    producer: 'A bar chart of how loud each speaker channel is. The LFE (subwoofer) channel gets special attention — if it has high-frequency content above 120 Hz, that\'s a routing mistake. Height channels should have content in them (otherwise, why submit as Atmos?). A completely silent height layer is a delivery QC problem.',
    student: 'The LFE (Low Frequency Effects) channel is band-limited to approximately 10–120 Hz by the Dolby specification. It is NOT a general subwoofer channel — it is for discrete low-frequency content specifically routed there by the mix engineer. Routing full-range audio to the LFE, or routing mix buses incorrectly, causes LFE high-frequency content that is technically non-compliant.',
    teacher: 'Common student mistake: "I\'ll just put all my bass in the LFE channel." Explain the LFE is monophonic, band-limited, and only reproduced on systems with a dedicated subwoofer (not all Atmos playback setups). The stereo bed L/R carry the broadband bass content. LFE is for discrete sub-bass elements only.',
    tip: 'Height channels with zero or near-zero energy are a waste of the Atmos format. Ensure your height layer has at least some ambient reverb or spatial content to justify the Atmos designation.',
  },

  atmos_downmix_qc: {
    label: 'Downmix QC',
    pro: 'QC checks applied specifically to the Atmos stereo downmix. Includes loudness, TP, correlation, and stereo width for the fold-down output — what listeners on non-Atmos systems (Spotify stereo, YouTube, etc.) will hear. A downmix that passes Atmos QC may still fail stereo delivery if the fold-down is incorrectly configured.',
    producer: 'Even if your Atmos mix passes all the Apple Music checks, your stereo downmix (what Spotify and YouTube listeners hear) might be wrong. This section checks that the fold-down to stereo also sounds right and meets stereo delivery specs.',
    student: 'All Atmos delivery systems also need to deliver a compliant stereo downmix, because Atmos listeners often switch between Atmos and stereo (e.g., iPhone without AirPods Max defaults to stereo). The downmix is generated by the Dolby renderer from the Atmos mix — but the mix engineer controls how the fold-down happens via the bed routing and object rendering parameters.',
    teacher: 'Ask: "What is the stereo downmix of an Atmos mix, and why does it matter?" Key points: (1) most listeners worldwide are on stereo systems; (2) the downmix is how most people will hear the Atmos mix; (3) a poor downmix can mean the Atmos release sounds worse to most listeners than the stereo native.',
  },

  downmix_delta: {
    label: 'Downmix Fidelity',
    pro: '31-band delta between the stereo mix (File A) and the Atmos downmix. Shows which frequency ranges changed in the fold-down — typically: low-mids shift from rear-object sum, highs shift from height-object fold-down, LFE re-routing changes sub content.',
    producer: 'A direct comparison of your stereo mix vs. what the Atmos fold-down produces. If there are big differences, your Atmos mix sounds different from the stereo version you delivered to Spotify. Usually not desirable — listeners expect the Atmos version to be a spatial upgrade, not a different mix.',
    student: 'When a Dolby Atmos mix is folded down to stereo, the renderer sums all bed channels and objects into a 2-channel output. This fold-down algorithm introduces tonal changes: height objects sum into the Mid channel (making the stereo brighter or louder), rear objects sum into Side (affecting stereo width), and the LFE is re-routed. The delta plot shows the net effect.',
    teacher: 'Play the stereo original and the Atmos downmix back-to-back and ask students to describe what changed. Then reveal the delta plot and see if their listening matched the measurement. Good exercise in training the ear to hear spectral changes.',
  },

  missing_elements: {
    label: 'Missing Elements in Downmix',
    pro: 'Per-element energy comparison between the stereo mix and Atmos downmix. Elements significantly quieter in the downmix (> 3 dB loss) or absent (> 12 dB loss) are flagged. Common cause: mix elements were routed only to objects or height channels that are not included in the stereo fold-down path.',
    producer: 'Detects mix elements that disappear or get much quieter when the Atmos fold-down runs. Common issue: a lead vocal or kick drum routed entirely to an Atmos object may be missing from the stereo downmix because that object wasn\'t assigned a bed-channel fallback. Fix in the session by verifying the bed routing.',
    student: 'Dolby Atmos object-based audio requires careful management of bed vs. object routing for stereo compatibility. An instrument routed only as an Atmos object (without a corresponding bed-channel assignment) may not appear in the stereo downmix — depending on the renderer settings. This is one of the most common Atmos mixing errors.',
    teacher: 'Practical exercise: in an Atmos session, route a lead vocal exclusively to an object without a bed assignment. Export the stereo downmix and check if the vocal is present. This demonstrates concretely why proper bed routing is essential. Then fix the routing and re-export to verify.',
    tip: 'If critical mix elements (kick, lead vocal, main synth) show as missing in the downmix, the issue is almost always a routing error in the Atmos session — not a problem with the exported file itself.',
  },

  atmos_downmix_spectrum: {
    label: 'Downmix Frequency Spectrum',
    pro: '31-band 1/3-octave comparison between the original stereo mix (A) and the Atmos stereo downmix (B). Identifies systematic tonal changes from the fold-down algorithm: height objects summing into Mid, LFE re-routing, and surround-to-Side fold.',
    producer: 'Shows exactly how the tonal balance changes when your Atmos mix folds down to stereo. Ideally the two spectra should be very close — the Atmos should be a spatial upgrade, not a tonally different product.',
    student: 'The fold-down EQ curve — comparing the original stereo master against the Atmos stereo downmix — reveals the net tonal change introduced by the Atmos rendering process. This is useful for diagnosing systematic routing issues and for verifying that the Atmos version has consistent tonal character with the stereo delivery.',
    teacher: 'Compare the spectra of a stereo master and its Atmos downmix. Where they diverge significantly, trace back to the mix session routing. Good lesson in how Dolby\'s fold-down algorithm affects frequency content.',
  },

  atmos_downmix_mono: {
    label: 'Downmix Mono Compatibility',
    pro: 'Per-band mono loss for the Atmos stereo downmix — same measurement as the stereo mono compat panel but applied to the fold-down. Atmos downmixes are often wider than the native stereo mix due to surround-object summing into Side.',
    producer: 'Checks if the Atmos stereo downmix will collapse correctly to mono. Atmos mixes sometimes fold down to a wider stereo image than the original — which can cause more mono compatibility issues than the original mix had.',
    student: 'The Atmos fold-down algorithm combines multiple audio paths (bed channels, object renders) into a 2-channel stereo signal. The relative phases of these summed sources can create more or less mono compatibility than the original stereo mix. This check ensures the fold-down is mono-safe for the same reasons as the standard stereo mono compat check.',
    teacher: 'Good comparative exercise: measure mono compat of the stereo master vs. the Atmos downmix. If the downmix has significantly worse mono compat, identify which Atmos mix elements (usually the rear-object sum) are introducing phase divergence.',
  },

  atmos_downmix_vectorscope: {
    label: 'Downmix Vectorscope',
    pro: 'Lissajous display for the Atmos stereo downmix. Compare against the stereo original — the downmix often shows a wider stereo image due to surround-object summing, which affects mono compatibility and the perception of width.',
    producer: 'The stereo image of the Atmos fold-down, shown as a Lissajous display. Compare it against the stereo original — if the downmix shape is much wider, your Atmos mix summed surround content into the Side channel. May need adjustment in the session.',
    student: 'The vectorscope provides an instant visual of stereo width and correlation for the Atmos downmix. Compare the shape against the stereo native — the typical Atmos downmix is wider because surround speakers and height objects fold into the Side channel.',
    teacher: 'Ask students: "Why would an Atmos downmix be wider than the stereo original?" Leads to discussion of how surround channels fold-down: LS and RS (which carry wide stereo content) sum into the L/R of the stereo mix — adding to the Side energy and potentially widening the stereo image beyond what the native stereo mix intended.',
  },

  atmos_downmix_phase: {
    label: 'Downmix Phase Correlation',
    pro: 'L/R phase correlation over time for the Atmos stereo downmix. Section-specific correlation dips indicate moments where object fold-down introduces phase divergence — critical for broadcast and club PA mono playback.',
    producer: 'Phase correlation timeline for the fold-down. Watch for sustained dips below center — that\'s where the Atmos fold-down introduces more phase cancellation than your original stereo mix, which could be a problem on mono playback systems.',
    student: 'Phase correlation of the downmix over time can reveal section-specific fold-down artifacts. For example, if a bridge introduces a new rear-object sound that folds into Side with an inverted phase relationship, the correlation dips below zero for that section — creating a mono cancellation problem only in that part of the track.',
    teacher: 'Compare the phase correlation timeline of the stereo native vs. the Atmos downmix. Any divergence tells a story about how the Atmos mix\'s surround content affects the fold. This builds understanding of the relationship between object routing and mono compatibility.',
  },

  // ─── EQ MATCH — ADDITIONAL MODES ──────────────────────────────────────────

  hybrid_match: {
    label: 'Hybrid EQ Match',
    pro: 'Reference-derived EQ bands merged with non-overlapping engineer-profile bands (1/2-octave exclusion radius). The hybrid gives you spectral correction toward the reference plus the engineer\'s signature where the two don\'t compete. Bands from each source are colour-coded on the chip rail.',
    producer: 'The best of both worlds: EQ moves that bring your file closer to the reference, plus the loaded engineer\'s own style fingerprint in the bands that don\'t overlap. Start with this mode if you\'ve loaded an engineer profile and also have a reference comparison.',
    student: 'Hybrid mode combines two independent EQ suggestion sources: (1) the spectrum-difference between your files (Reference mode), and (2) the loaded engineer\'s profile target curve (Engineer mode). Where they suggest overlapping bands, Reference takes priority. Where they don\'t overlap, the engineer\'s signature is added. This is a form of ensemble recommendation.',
    teacher: 'Hybrid mode is a good teaching case for understanding how two independent EQ sources can be merged without double-correction. Ask: "What happens if both sources suggest a boost at 200 Hz? Which takes priority and why?" Leads to discussion of reference-based vs. style-based EQ recommendations.',
    tip: 'Toggle individual bands off using the chip rail to A/B the Reference contribution vs. the Engineer contribution — a useful way to hear how much each source changes the sound.',
  },

  chain_delta: {
    label: 'Chain Delta Prediction',
    pro: 'Predicted output of the loaded engineer\'s full mastering chain (gain → EQ → compression → limiting) applied to this mix. Derived from the profile\'s historical A/B regression model. Shows predicted LUFS-I, LRA, per-band gain, and spectral character after the chain — before you run it.',
    producer: 'See what the loaded engineer\'s mastering chain would do to your mix before you commit. The prediction shows expected loudness, compression character, and spectral change. Use it to decide whether the engineer\'s style fits your track.',
    student: 'Chain prediction uses a regression model trained on the engineer\'s past mix-to-master pairs. Given your mix\'s measurements as input, it predicts the output after their typical processing chain — without you having to actually run the chain. This is machine learning applied to mastering workflow prediction.',
    teacher: 'Show chain delta predictions for two different engineer profiles on the same mix. Ask students: "Which engineer would make this mix louder? Which would preserve more dynamics?" Then verify by running the Master Assistant with each profile. Builds intuition for how engineer style affects mastering decisions.',
    tip: 'Load a Delta profile at scan time (dropdown before analysis) to see the chain prediction. The prediction is only as accurate as the profile\'s training data — profiles built from more masters are more reliable.',
  },

  // ─── BATCH VIEW ────────────────────────────────────────────────────────────

  batch_overview: {
    label: 'Album Overview',
    pro: 'Cohort loudness distribution, per-track LUFS-I / TP / LRA with heatmap deviation from album median, consistency score (coefficient of variation), and outlier flagging. The album median is computed excluding silence-only tracks. DDP preflight, album-level export (CSV / JSON / PDF / DDP), and session persistence (.rtmalbum.json).',
    producer: 'Your full album at a glance — every track\'s loudness, peaks, and dynamic range in one table. The colour coding shows which tracks are outliers vs. the album median. A consistent album has matching loudness across all tracks; inconsistencies will be noticed by listeners.',
    student: 'Album mastering is about cohesion — every track should feel like it belongs at the same loudness level, with similar tonal character and dynamic feel. This overview computes the LUFS-I distribution across all tracks and flags those more than 1 LU outside the album median. Understanding track-to-track consistency is a key skill for album mastering.',
    teacher: 'Assign students to bring in 5–10 tracks from the same album (commercially released) and run them as a batch. Ask them to identify the loudest and quietest tracks, then listen back-to-back to verify the loudness difference is perceptible. Discuss why mastering engineers sometimes intentionally vary loudness across an album (artistic sequencing vs. uniform delivery).',
    tip: 'Use Cohort Mode to pin one track as the target — all other tracks are measured relative to that master rather than the album median. Useful when one track is the established reference for the project.',
  },

  // ─── LEARN MODE ────────────────────────────────────────────────────────────

  learn_guided_steps: {
    label: 'Guided Steps',
    pro: 'Nine-step structured curriculum: monitoring → overview → loudness → spectrum → stereo → quality → delivery → EQ match → sign-off. Each step navigates to the relevant tab and prompts specific listening tasks. Designed for classroom use but useful as a systematic QC checklist for any session.',
    producer: 'A step-by-step walkthrough of how to critically evaluate a mix or master — covering all the important panels in the right order. Useful when you\'re learning the tool or want to be thorough on an important release.',
    student: 'The nine guided steps follow a professional mastering review workflow: start with monitoring conditions, work through loudness and dynamics, then spectral and stereo content, quality issues, and finally delivery compliance. Each step asks specific questions so you develop a repeatable process rather than random exploration.',
    teacher: 'The guided steps are a structured curriculum you can assign as homework or use in class. Each step has a specific listening task — these are your homework prompts built in. Use the annotation notes feature to require students to write observations at each step before proceeding.',
  },

  learn_blind_test: {
    label: 'Blind A/B Test',
    pro: 'Psychoacoustic bias-elimination protocol. A and B are randomly shuffled each session so the analyst doesn\'t know which is the reference and which is the work-in-progress until they commit their predictions. Results logged to the student report PDF for pedagogical transparency.',
    producer: 'A/B is randomly shuffled so you can\'t see which file is which until after you decide which sounds better. Trains you to evaluate sound without bias from knowing which is the "master" and which is the "rough mix." Your prediction is revealed after you commit.',
    student: 'Blind testing is the gold standard for removing confirmation bias from perceptual evaluation. When you know which file is "supposed to be better," your brain tends to confirm that expectation. This blind A/B design — where file identity is hidden until after your prediction — trains you to evaluate sound objectively, not by expectation.',
    teacher: 'Require students to complete the blind test before viewing any analysis panels. Their prediction accuracy tells you more about their listening development than their analysis skills. Low accuracy + correct analysis = good analytical mind, needs more ear training. High accuracy + poor analysis = good ears, needs more measurement vocabulary.',
  },

  learn_ear_training: {
    label: 'Ear Training',
    pro: 'Drill modes: frequency identification (EQ sweep, narrow-band noise burst), EQ width (Q detection), compression ratio recognition (attack/release cues), and reverb type classification. Pink noise, your own audio, and a reference synth mix. Three difficulty levels with session scoring.',
    producer: 'Practice hearing EQ changes, compression, reverb types, and other effects in isolation. The drills work on your own audio or generated test signals. Good for training the specific skills you need to evaluate a mix or master by ear.',
    student: 'Ear training develops the perceptual vocabulary needed to describe and identify audio processing. The frequency identification drill teaches you to hear specific EQ boosts — a skill that takes months of regular practice to develop. Frequency, dynamics, and space drills each target a different dimension of audio perception.',
    teacher: 'Assign 10 minutes of ear training per class session as a warm-up. Track improvement by exporting the session score over several weeks. Frequency ID is the most important drill for mastering students — inability to identify frequency regions by ear is the most common skill gap in mix-to-master feedback.',
  },

  learn_assignment: {
    label: 'Assignment Builder',
    pro: 'Rubric constructor with 14 weighted metrics, genre target options, and submission export (.rtm-assignment.json). Supports Canvas LMS grade passback via REST API. Assignment constraints set quality thresholds and scoring bands per metric.',
    producer: 'Not applicable for the typical producer workflow — this is a teacher tool for setting up graded assignments.',
    student: 'Your assignment loaded here defines which metrics are graded, what the thresholds are, and how heavily each is weighted. Load the .rtm-assignment.json file your teacher provided to see the rubric before submitting your work.',
    teacher: 'Build your assignment rubric here: select which of the 14 metrics to grade, set pass/fail thresholds, assign point weights, and optionally lock a genre target curve. Export the .rtm-assignment.json for students to load. Submissions auto-grade against the rubric — you see results in the Grade Book.',
    tip: 'Set a genre target when grading albums or genre-specific work — the tonal balance score is then measured against the genre mean rather than an absolute flat curve.',
  },

  learn_grade_book: {
    label: 'Grade Book',
    pro: 'Batch submission scanner — reads .rtm-report.json files from a folder, runs them against the loaded assignment rubric, and produces a grade table. Class Insights highlight which metric tripped up the most students. Canvas LMS CSV export and REST API grade passback available.',
    producer: 'Not applicable for the typical producer workflow — this is a teacher tool.',
    student: 'Your submitted .rtm-report.json file is what the teacher runs through the grade book. The grade is calculated automatically from your measurements against the assignment rubric. You can see the rubric in the Assignment panel to understand how your work will be evaluated.',
    teacher: 'Scan the submissions folder after the deadline — each .rtm-report.json becomes a graded row instantly. The Class Insights panel shows which metric had the most failures (usually True Peak or Mono Compatibility for beginners). Export to CSV for your gradebook, or push directly to Canvas via the LMS integration.',
    tip: 'Use the "Flag for review" column to mark borderline submissions that need a manual listen before finalizing the grade. The automation handles measurement-based grading; your ear handles the subjective judgment.',
  },

}
