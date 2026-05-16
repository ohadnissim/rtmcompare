/**
 * LearnModeContext — React context for RTMcompare's Learn Mode feature.
 *
 * Provides state and actions for toggling guided education mode, switching
 * between Student and Teacher roles, managing guided steps through the
 * analysis workflow, assignment configuration, and per-session annotations.
 *
 * State is persisted to localStorage under the key `rtm-learn-mode-v1` so
 * a page reload doesn't lose in-progress annotations or role selection.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
} from 'react'
import type { LearnModeState, LearnRole, AssignmentConfig, LearnAnnotation, LearnGuidedStep, BlindTestPredictions } from '../types'

// ─── Guided Steps ────────────────────────────────────────────────────────────

export const GUIDED_STEPS: LearnGuidedStep[] = [
  {
    id: 'listening',
    label: 'Methodology',
    tabId: 'overview',
    targetTab: 'Overview',
    question: 'Before looking at a single meter: listen through both files on your main monitors, then again on headphones, then on a laptop speaker or phone. What differences do you notice across playback systems? How does your mix translate?\nWhen you listened on laptop speakers, did the low end disappear? Did the vocal become more or less intelligible? How did the stereo width collapse feel? What did you notice on headphones vs. open-back monitors?',
    hint: 'Translation check is the first professional step. The goal is to hear what the numbers will later confirm — or contradict. Note loudness, tonal character, stereo width, and anything that feels "wrong" on any system.\nTranslation issues are always frequency-specific: low end disappears on laptop speakers, harsh mids amplify on earbuds, excessive reverb smears on phone speakers.',
    actionHint: 'Load both files. Listen through on monitors → headphones → laptop speaker → phone. Write down 3 specific differences per system before moving to Step 2. Do not open any meters yet.',
    teacherQuestion: 'Make the student listen before they look at anything. Ask them: "What did you hear that was different across playback systems?" Watch for students who jump straight to meters — redirect them. The goal is to train ears to lead and numbers to confirm.',
    teacherHint: 'Common student gaps: (1) Listening only on studio monitors — they never hear what happens on a phone. (2) Confusing loudness differences for tonal differences — a louder mix always "sounds better", so A/B without level-matching is meaningless. (3) Not noticing low-end collapse on small speakers — this is the #1 translation failure and they\'re usually surprised. Discussion prompt: "If your mix only sounds good on your monitors, where did the mix actually happen?" Key teaching point: translation failures are always frequency-specific. The disappearing low end is a sub-bass/center-bass mono issue. Harsh mids on earbuds reveal a 2–4 kHz build that monitors flatter. Smeared reverb on phones means reverb tails are too long for the genre or the pre-delay is too short. Teach students to mentally map each system to a frequency region: phone speakers = 200–4000 Hz window; laptop = 100–10000 Hz; earbuds = hyper-detailed 2–8 kHz. If the mix survives all three, it\'s ready.',
  },
  {
    id: 'metering',
    label: 'Loudness',
    tabId: 'overview',
    targetTab: 'Overview',
    question: 'What is the LUFS-I and PLR of your mix? Before the limiter, what is your mix bus peak level — is it hitting around −6 to −3 dBFS? Has gain staging been maintained at every stage from recording through processing to the master bus?\nIs the PLR difference between A and B caused by the mix dynamics themselves, or by the limiter alone? If you removed the limiter, what would PLR be?\nBeyond LUFS-I (integrated/gated): is there a difference between the short-term LUFS-S (3-second window) reading at the loudest chorus vs. the quietest verse? What does a LUFS-S swing of more than 8 LU tell you about the dynamic arc of the arrangement? How does the momentary LUFS-M (400 ms window) behave at the loudest transient?',
    hint: 'Gain staging rule: recording −18 to −12 dBFS, processing −18 to −12 dBFS, mix bus −6 to −3 dBFS before limiting. A PLR below 6 LU means the limiter is working too hard — fix gain staging upstream first.\nA PLR above 14 LU with heavy limiting means the compressor upstream is doing the real work — the limiter is just catching peaks. Fix the bus compression settings before touching the limiter ceiling.\nLUFS-M (400 ms) catches the loudest transient moments — critical for broadcast where momentary peaks above −18 LUFS trigger programme loudness processors. LUFS-S (3 s) reveals the dynamic arc: a 10 LU swing between verse and chorus is common in commercial pop and desirable. LUFS-I (gated integrated) is what streaming platforms normalise to — it ignores silence and very quiet passages. A well-mastered track should have LUFS-I at target, LUFS-S peaks 6–10 LU above that, and LUFS-M peaks 10–14 LU above LUFS-I.',
    actionHint: 'Note both LUFS-I values and the PLR for each file. If your mix PLR is below 6 LU, flag it — fix gain staging before the limiter rather than raising the limiter ceiling. Write down the LUFS-I gap between A and B.',
    teacherQuestion: 'Look at the LUFS-I and PLR for both files. Before discussing anything else, ask the student: "Did you gain-stage your session, or did you just turn things up until it sounded loud?" The numbers will reveal the answer — a PLR below 6 LU is a confession.',
    teacherHint: 'Red flags to catch: (1) PLR below 6 LU — the limiter is crushing dynamics, usually because the mix bus was hitting 0 dBFS before limiting. The fix is upstream gain staging, not a higher limiter ceiling. (2) LUFS-I near −6 or louder — almost always means over-limiting. Ask "what streaming platform are you targeting?" — students are often unaware that Spotify will turn this down to −14 anyway. (3) LUFS-I gap between A and B larger than 3 LU — the student is hearing loudness, not quality. Great teaching moment: play both through a utility gain plugin set to match LUFS-I and ask which sounds better now. The LUFS-M/S/I distinction trips up most beginners. Teach it with an analogy: LUFS-I is your semester GPA (big picture, ignores one bad week), LUFS-S is your weekly quiz average (shows momentum), LUFS-M is your score on a single question (catches the peak moment). A good mix has all three in proportion — LUFS-M about 10–14 LU above LUFS-I. If that gap shrinks below 6, transients are being destroyed.',
  },
  {
    id: 'breakdown',
    label: 'Mix Breakdown',
    tabId: 'breakdown',
    targetTab: 'Breakdown',
    question: 'What is the element hierarchy of your mix — which element sits loudest, which provides the foundation, which cuts through? Is any element masking another in the same frequency band? Describe your bus architecture: what stems or groups are you using?\nWhat reverb types are you using on the main elements — plate, hall, room, or algorithmic? What is the pre-delay setting on your main vocal reverb (aim for 20–60 ms for separation)? Does your reverb decay time match the tempo? Quick check: 60000/BPM × 0.75 = dotted quarter note in ms — a decay longer than 2 bars will blur fast tempos. Are you using any sends for parallel reverb/delay routing, or inserting FX directly on channels?\nWhere does automation play a role in your mix — which elements have volume rides, filter sweeps, or reverb send automation? Does your lead vocal have manual level automation or just compression? Where did you automate a reverb send up on long held notes, and pull it back on dry phrases? Does the automation support the arrangement\'s energy arc (building to chorus, dropping for verse)?',
    hint: 'Mix Breakdown comes before tonal and dynamics analysis because masking and element balance are root causes — not symptoms. Fix the element hierarchy and the tonal/dynamics numbers often fix themselves.\nReverb type determines character: plate is dense and bright (vocals, snare), hall is long and wide (orchestral, pads), room is tight and natural (drums, acoustic). Pre-delay (20–60 ms) separates the dry sound from the reverb tail, preventing the reverb from masking the source. Tempo-sync your delays: 60000/BPM for quarter notes, half that for eighths.\nAutomation is where a technically correct mix becomes an emotionally communicative one. Volume automation on vocals (±2–3 dB per phrase) catches what compressors miss — subtle line-to-line level variation. Reverb send automation: pull the reverb level up on final words and long notes; reduce it on tight, rhythmic phrases so the reverb doesn\'t smear the groove. Filter automation on pads for a build: high-pass at 400 Hz in the verse, open to full range into the chorus, creates energy without changing the mix level.',
    actionHint: 'Open the Breakdown tab. Name the two elements with the most frequency overlap and write down the fix. Confirm your vocal reverb is on a send, not an insert. If you find no automation anywhere in your session, add at least one vocal ride before re-rendering.',
    teacherQuestion: 'Pull up the Breakdown tab and ask the student to explain their element hierarchy out loud before they touch anything. Watch for blank stares — most students haven\'t consciously decided on a hierarchy, it just happened. The masking score and bus structure are your diagnostic tools here.',
    teacherHint: 'What to look for: (1) High masking overlap score — ask "which two elements are fighting each other?" Usually kick/bass in the 60–120 Hz region, or lead vocal/guitar in the 2–5 kHz presence range. The fix is always EQ carving, not volume. (2) No bus architecture — student mixed every track individually with no groups. Teach the hierarchy: instrument buses → stem buses (drums, music, vocals) → master bus. Busing isn\'t just organization; it\'s how you apply glue compression and FX efficiently. (3) Reverb on insert instead of send — this is the number-one beginner mistake. Inserting reverb means every voice gets its own reverb room, so nothing sounds like it\'s in the same space. Sends create a shared room. Ask: "Are your instruments in the same room or different rooms?" (4) No automation anywhere — compression handles dynamics, but automation handles intention. A vocal that hasn\'t been ridden line-by-line almost always has phrases that are either buried or popping out. Discussion prompt: "Pick one moment in the mix where the energy should peak. Did the automation support that?" If they can\'t answer, they don\'t have automation.',
  },
  {
    id: 'stereo',
    label: 'Stereo & Phase',
    tabId: 'stereo-spectrum',
    targetTab: 'Stereo & Spectrum',
    question: 'What is the mono compatibility loss percentage, and how does the mix sound on a single speaker? Check the correlation meter — what does a value near +1 vs near −1 mean? Where in the frequency spectrum does the most phase cancellation occur?\nDescribe your panning architecture: what sits in the center (kick, bass, lead vocal, snare)? What is hard-panned (guitars, pads, doubles)? Are you using Haas effect (a 1–30 ms delay copy on one side for width without M/S artifacts)? Is there enough center-fill — does the mix still have body and punch when summed to mono? If you used M/S (Mid-Side) processing: what did you apply to the Mid channel vs. the Side channel, and why?',
    hint: 'Phase cancellation is frequency-specific. Sub-bass phase issues (below 120 Hz) cause the most mono compat loss and are most damaging on club systems. High-frequency correlation near −1 on cymbals is usually fine. LF correlation near −1 is a serious problem.\nCenter fill is critical: kick, bass, and lead vocal must be center-anchored or the mix collapses in mono. Haas effect (short delay on one channel) creates width without M/S processing but can cause comb filtering — use it sparingly. M/S compression on the sides can control stereo width: compressing just the Side channel narrows overly wide mixes without touching the center image.',
    actionHint: 'Open Stereo & Spectrum. If mono compat loss exceeds 15%, stop here — apply a low-frequency mono maker below 120 Hz in your DAW and re-render before continuing. Write down which frequency range shows the worst correlation.',
    teacherQuestion: 'Check the mono compat score and correlation meter first. If mono compat loss is above 15%, something is genuinely broken — not just "a little wide." Ask the student to describe their panning map from memory before they look at the Stereo & Spectrum tab.',
    teacherHint: 'Teaching moments by symptom: (1) Mono compat loss >15% — almost always a sub-bass phase problem. Ask "is your bass mono?" Kick and bass in separate stereo positions with different phase responses cancel each other in mono. Fix: use a low-frequency mono maker (sum to mono below 120 Hz). (2) Correlation meter swinging negative — something is actively out of phase. Common causes: a stereo plugin applied to a mid-channel instrument, a doubled guitar track panned hard L/R with one phase-flipped, a room mic out of phase with the close mic. Ask "did you flip phase anywhere?" (3) No center fill — the mix sounds wide on stereo but hollow in mono because the student put everything in the sides. Kick, bass, lead vocal, snare must anchor the center. Have them solo the center channel (M in M/S): if it sounds thin, there\'s no center fill. (4) Stereo width too narrow (student afraid of phase) — teach that width comes from intentional stereo placement, not from pushing a stereo width knob. Doubling a guitar take, hard-panning rhythm guitars L/R, using a stereo reverb on a send — these are all safe, phase-coherent width techniques. Discussion: "Play your mix through a mono Bluetooth speaker. What changed? That\'s what happens at a club, a coffee shop, or in a car with one channel broken."',
  },
  {
    id: 'tonal',
    label: 'Tonal Balance',
    tabId: 'eq-match',
    targetTab: 'EQ Match',
    question: 'Where does your mix differ most from the reference tonally? Name the specific frequency region (sub/bass/low-mid/mid/presence/air), the direction (too much or too little), the instrument most responsible, and one EQ move that would address it.\nList every track you high-pass filtered and at what frequency. Why did you cut where you did? What was in the low end of your vocals (below 80–120 Hz) that warranted cutting? Is there mud buildup in the 200–400 Hz region? Did you apply any subtractive EQ to the side channel (M/S) to remove low-frequency stereo content below 120 Hz?\nDescribe your vocal processing chain specifically: Where does the high-pass filter cut on the lead vocal, and what did you remove (proximity effect buildup, breath noise, floor rumble)? Is the de-esser before or after your main compressor, and why? Did you use two stages of compression on the vocal — a transparent fast-attack stage followed by a character stage with slower attack? What was the result?',
    hint: 'Use the subtractive-first approach: find and cut problem frequencies before boosting character frequencies. Common problems — mud: 200–400 Hz; boxiness: 400–600 Hz; harshness: 2–4 kHz; sibilance: 5–8 kHz. Wide Q boosts, narrow Q cuts.\nHPF on every non-bass element cleans the sub register and prevents mud accumulation. Rule of thumb: guitars HPF at 80–100 Hz, keyboards at 60–80 Hz, vocals at 80–120 Hz (male) or 100–150 Hz (female), room mics at 150–200 Hz. Sub-bass (below 80 Hz) should be mono — use an M/S EQ to cut the side channel below 80–120 Hz on the master bus.\nVocal chain doctrine: (1) HPF at 80–120 Hz (male) or 100–150 Hz (female) — removes proximity effect and breath floor. (2) De-esser first if the sibilance is loud enough to trigger downstream compression unevenly; after if sibilance is subtle. (3) Stage 1 compression: 2–3:1 ratio, fast attack (5–10 ms), auto release — transparent levelling. (4) Stage 2 compression: 4–6:1, slow attack (20–50 ms), 150–200 ms release — adds character and glue. The slow attack on stage 2 lets transient consonants through, preserving intelligibility. Parallel blend: 70% compressed, 30% dry restores air without losing density.',
    actionHint: 'Open the EQ Match tab. Find the largest red deviation band. Name the frequency region, direction, and the instrument responsible. Apply that one EQ move in your DAW, re-render, and compare again before moving on.',
    teacherQuestion: 'Open the EQ Match tab and look at the deviation curve before the student does. Identify the 1–2 biggest problem regions. Then let the student identify them. If they can\'t see what you see, that\'s the teaching moment — use it to teach how to read a tonal balance chart.',
    teacherHint: 'Most common tonal problems by region: (1) 200–400 Hz excess (muddy) — the student hasn\'t high-pass filtered their instruments, or high-passed too low. Ask "did you HPF your guitars? Your room mics? Your pad tracks?" A muddy low-mid region is almost always a missing-HPF problem, not an EQ boost problem. (2) 2–4 kHz excess (harsh) — often caused by overcompressed vocals (slow release pushing the compressor into the attack of sibilants) or overdriven guitars. Ask "does this harshness happen on transients or sustained notes?" Transient harshness = compression attack too slow; sustained harshness = the source has it or EQ boost in that region. (3) Missing air above 10 kHz (dull) — overuse of low-pass filters or heavy limiting killing high-frequency transients. Ask "did you add a high shelf anywhere?" If not, check whether their limiter is eating the HF. (4) Vocal chain gaps: if the tonal deviation shows a low-mid build on the vocal region, they skipped or misplaced the HPF. If there\'s a high-frequency shelf dip on the vocal, the de-esser is set too aggressively. Use the EQ Match curve to reverse-engineer what they did (or didn\'t do) in their chain. Diagnostic question: "Point to one frequency on this curve and tell me which instrument caused it." If they can\'t connect the spectrum to an instrument, they\'re EQing by guessing, not listening.',
  },
  {
    id: 'dynamics',
    label: 'Dynamics',
    tabId: 'mastering-delta',
    targetTab: 'Mastering Delta',
    question: 'What is the LRA and PLR of your mix? What is shaping the dynamics — mix bus compression, limiting, or the arrangement itself? Describe the compressor settings on your mix bus (threshold, ratio, attack, release) and how they affect the LRA.\nDescribe your sidechain compression decisions: does the bass have a sidechain from the kick? If so: what threshold, ratio, and release time? What happens to the bass energy on the kick beat? Are you using parallel compression anywhere — if so, what is the blend ratio between the dry and heavily compressed signal, and what does each layer contribute? How does parallel compression preserve transient detail while adding density?\nWhere did you use saturation in your chain — which buses, which channels? What type of saturation (tape, tube, transistor, clipper) and what character does each contribute? Did you use parallel saturation anywhere — what was the blend ratio? Why might you saturate a bass bus but NOT the master bus if the mix already contains heavily distorted guitars?',
    hint: 'LRA reflects the dynamic shape of the arrangement as well as compression decisions. A slow attack (50–100 ms) on the bus compressor lets transients through and preserves punch; a fast attack (1–5 ms) flattens the mix. The PLR shows what the limiter is doing to what the compressor left behind.\nSidechain compression (kick → bass compressor) carves frequency space on the kick beat: the bass ducks 3–6 dB for 20–80 ms, creating a rhythm pocket. Ratio 4–8:1, fast attack (1–5 ms), release matched to beat duration (60000/BPM/4 ms for 16th note). Parallel compression (New York compression): the dry signal preserves transients and air; the heavily compressed copy adds density and sustain. Start with a 30/70 dry/wet blend and adjust by feel.\nSaturation adds harmonic content: tube/tape saturation adds 2nd-order even harmonics (warm, consonant); transistor/clipper adds 3rd and 5th odd harmonics (aggressive, edgy). Even harmonics on sub-bass add an octave above the fundamental, making bass audible on small speakers without adding actual sub energy — critical for translation. Parallel saturation: blend 20–40% wet; the dry path preserves the original transients while the saturated path adds density. When NOT to saturate: already-distorted material (heavy guitars, overdriven synths) — you\'ll add mud. When the master bus is already heavily limited — saturation into a hard limiter creates harsh intermodulation.',
    actionHint: 'Open the Mastering Delta tab. Compare LRA for A and B. If the gap is more than 3 LU, identify which processor (compressor or limiter) is responsible — check attack time first. Write down your bus compressor attack time and its effect on kick transients.',
    teacherQuestion: 'Look at the LRA and PLR numbers before the session. If LRA is below 4 LU or PLR below 5 LU, the student has over-compressed and probably doesn\'t know it. The Mastering Delta tab will show you exactly where the dynamics were removed — use that as a teaching diagram.',
    teacherHint: 'LRA diagnostic by genre (use these as grading benchmarks): Pop: 4–7 LU; Rock: 8–12 LU; Hip-Hop: 6–9 LU; Jazz: 10–14 LU; Classical: 14–20 LU; EDM: 4–6 LU. A student submitting a jazz mix with LRA of 3 LU has destroyed the performance\'s dynamics. A student submitting an EDM track at 15 LU hasn\'t compressed anything and will be buried on streaming playlists. Three questions that reveal understanding: (1) "What is your mix bus compressor\'s attack time — and what happens to the kick drum transient because of it?" A fast attack (< 5 ms) kills the punch; a slow attack (50+ ms) lets it through. (2) "Did you use sidechain compression on the bass? Play me the kick beat with the sidechain on and off." If they can\'t hear the difference, they don\'t have it working. (3) "What does your parallel compression bus sound like in solo?" It should sound crushed, squashed, and dense — almost bad alone. Mixed in at 30%, it adds density without killing the transients. If their parallel bus sounds like the dry mix, they haven\'t compressed it hard enough. Saturation misconceptions: most students think saturation = warm. Teach that odd-harmonic saturation (transistor, clipper) adds aggression and can clash with distorted guitars. Even-harmonic (tube, tape) adds warmth and an octave — helpful for bass translation, destructive on already-harmonically-rich material.',
  },
  {
    id: 'quality',
    label: 'Artifact Check',
    tabId: 'quality',
    targetTab: 'Quality',
    question: 'Are there any clicks, digital clips, distortion artifacts, or hum? For each one found, identify the likely stage in the signal chain where it was introduced. Which is preferable — de-clicking post-export, or returning to the mix session?',
    hint: 'One audible click in a commercial release is a quality control failure. Hum at 50/60 Hz or its harmonics (100, 120, 150, 180 Hz) indicates a ground loop or unbalanced cable in the recording chain. Always fix at the source, never mask with EQ.',
    actionHint: 'Open the Quality tab. For every flagged artifact, return to your DAW session and fix it at the source — never post-export. Re-render and re-check before continuing. A single unfixed click means this mix is not submittable.',
    teacherQuestion: 'Before the student talks about their creative decisions, check Quality first. If there are clicks, clips, or hum, the mix is not submittable regardless of how good it sounds otherwise. This is a professional standard conversation, not a technical detail.',
    teacherHint: 'What the Quality tab flags and what it means for grading: (1) Clicks detected — could be a plugin glitch, a bad edit splice, an automation jump, or sample rate mismatch on a sample. Ask the student "do you know where that click happens?" If they don\'t, they haven\'t listened critically. Returning to the session is always correct — post-export de-clicking is a workaround, not a fix. (2) Distortion / clipping — most commonly the mix bus hit 0 dBFS before the limiter, or a plugin in the chain was driven into hard clipping. Check the PLR: if it\'s below 4 LU and there\'s distortion, the limiter is the culprit. (3) Hum at 50 or 60 Hz — ground loop in the recording chain. This is a recording problem, not a mix problem. The fix is at the source (DI box, balanced cables, ground lift). EQing it out on the master bus means it\'s still on every track, just turned down. (4) Noise floor too high — probably a poor-gain recording (input too low, preamp gain compensation at the DAW level, noise amplified). Ask "what was your preamp gain set to when you recorded this?" Teaching point: the professional standard is zero audible artifacts. A commercial release with a click in it is a quality control failure, full stop. Teach students to listen to a rendered export before submitting — not just play back through the DAW.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    tabId: 'delivery',
    targetTab: 'Delivery',
    question: 'What is the True Peak level, and is it safe for AAC encoding (which can raise peaks by up to 3 dB)? Which streaming platforms is this mix compliant for, and what is the single change that would make it compliant for all target platforms?\nWhat is the bit depth and sample rate of your final delivery file — and is that correct for the destination? If delivering 16-bit/44.1 kHz (CD, most streaming), did you apply dithering as the absolute last step before bouncing? What type of dither did you use (TPDF, noise-shaped)? If you are delivering 24-bit, dithering is not required — do you know why?',
    hint: 'AAC encode risk: if True Peak is above −1.5 dBTP, encoding may push peaks above 0 dBTP causing audible distortion. Aim for −1.0 dBTP as a delivery ceiling. Check the per-platform compliance table — Spotify −14 LUFS, Apple Music −16 LUFS, broadcast −23 LUFS.\nBit depth and sample rate for delivery: mastering session at 24-bit/96 kHz (or 32-bit float); delivery for streaming/CD at 16-bit/44.1 kHz with dither. Dithering is the final step — after the limiter, after any processing: it adds low-level random noise to prevent quantisation distortion during the 24-bit → 16-bit conversion. TPDF dither: spectrally flat, simplest, correct for most uses. Noise-shaped dither (POW-R, UV22HR): pushes the dither noise into 14–16 kHz where the ear is less sensitive — slightly quieter perceived noise floor. NEVER dither and then process — any gain change or EQ after dither re-introduces quantisation errors. For 24-bit delivery: 24-bit has 144 dB of dynamic range vs. 16-bit\'s 96 dB — quantisation distortion is inaudible at 24-bit, so dither is unnecessary.',
    actionHint: 'Open the Delivery tab. Confirm True Peak is at or below −1.0 dBTP. Verify bit depth and sample rate match your target platform. If delivering 16-bit: open your export dialog and confirm dither is enabled as the very last step.',
    teacherQuestion: 'Look at the Delivery tab compliance status. Many students submit with True Peak too hot or the wrong bit depth. This step is about professional standards — the student should be able to tell you exactly what they delivered and why, not just that "it exported fine."',
    teacherHint: 'Most common delivery failures and how to grade them: (1) True Peak above −1.0 dBTP — submittable only if the platform target is −9 LUFS or louder (some broadcast contexts); otherwise a delivery fail. Ask "did you check True Peak after exporting, or just before?" Students often don\'t realize their exporter or DAW adds a stage of processing after the limiter. (2) Wrong bit depth — submitting a 32-bit float file "because it\'s higher quality" reveals a fundamental misunderstanding. 32-bit float is for working sessions, not delivery. Ask "why did you choose that bit depth?" If they say "because it\'s bigger," teach the bit depth/delivery purpose distinction. (3) Missing dither on 16-bit delivery — this is the most commonly skipped step. Ask "what is dithering and where did it go in your chain?" If they can\'t explain it, they didn\'t do it. Most DAWs have dither in the export dialog, not as a plugin — students miss it because they never open the advanced export settings. (4) Sample rate mismatch — delivering 48 kHz to a streaming platform that expects 44.1 kHz: technically fine (platforms convert), but professionally sloppy. Teach the standard: 44.1 kHz for music distribution, 48 kHz for video sync. Delivery quiz questions: "What does AAC encoding do to True Peak?" (+3 dB, so set ceiling to −1.5 dBTP or lower). "Why does Spotify turn your loud master down?" (Loudness normalization to −14 LUFS-I — the loudness war is over on streaming).',
  },
  {
    id: 'reflection',
    label: 'Reflection',
    tabId: 'overview',
    targetTab: 'Overview',
    question: 'Document your mastering chain in order: list every processor (EQ, compressor, saturation, stereo tool, limiter) with its key settings and the problem it solved. Then write one actionable engineering instruction — the single most important change this mix needs before release.\nDid you use any M/S (Mid-Side) processing in the master chain? If so, what was applied to the Mid vs. Side channel? What parallel processing chains did you use (parallel compression, parallel saturation, parallel reverb) and what problem did each solve?\nIs this a full-mix master or would stem mastering have been preferable? What stems would you request (drums, bass, music, vocals, FX) and what would you do differently with individual stem access that you can\'t do with a stereo mix? For 16-bit delivery: confirm dithering was the absolute last step in the chain — document which dither type you used.',
    hint: 'Mastering chain order matters: EQ → Compression → Saturation → Stereo Enhancement → Limiting → Dither (16-bit delivery). Documenting the chain builds vocabulary and creates a reference for future sessions. Be specific: "High-pass at 30 Hz to remove sub rumble" beats "cleaned up the low end."\nM/S processing in mastering: EQ the Mid to fix vocal brightness or low-mid mud; EQ the Side to remove low-frequency stereo content (below 80 Hz) and control harshness (2–4 kHz). M/S compression narrows the stereo field when the sides hit the threshold. Document these separately in your chain: e.g., \'M/S EQ: Side HPF at 80 Hz, Side dip −2 dB at 3 kHz; M/S Comp: 2:1 on Sides at −18 dBFS threshold\'.\nComplete mastering chain order: EQ → Compression → Saturation → Stereo Enhancement → Limiting → Dither (if 16-bit delivery). Dithering must always be the last step — never before the limiter, never before a final EQ pass. Stem mastering advantages: separate EQ/compression per element group, cleaner LF treatment of drums without affecting bass, ability to de-ess vocals independently at mastering stage. Request stems when the full mix has: prominent low-end phase issues, sibilance that can\'t be fixed with broadband de-essing, or dynamic imbalance between elements (e.g., vocal too loud in chorus, can\'t fix with full-mix compression).',
    actionHint: 'Write your full mastering chain in order — every processor, key settings, and the problem it solved. Export your Student Report as a PDF. Submit it as directed before closing RTMcompare.',
    teacherQuestion: 'This is the portfolio step. A student who can articulate their mastering chain — every processor, what it did, what problem it solved — has learned to think like an engineer. A student who says "I just ran it through a mastering preset" hasn\'t. Evaluate the quality of their documentation as much as the numbers.',
    teacherHint: 'What good mastering chain documentation looks like vs. what students typically write. Good: "Fabfilter Pro-Q3: HPF at 28 Hz (remove sub rumble), +1.5 dB shelf at 10 kHz Q 0.7 (restore air lost in limiting); Pro-C2: 2:1, −18 dBFS threshold, 50 ms attack, auto release (light glue, preserved transients); Pro-L2: −0.9 dBTP ceiling, Aggressive mode (EDM genre)." Bad: "EQ, compression, limiter — made it sound better." The chain documentation is a rubric criterion in itself — grade it on specificity. Red flags that indicate a student doesn\'t understand their chain: (1) No EQ before the limiter — the chain goes compressor → limiter with nothing before it. They haven\'t addressed tonal balance at the master stage. (2) Saturation after the limiter — the order is wrong; saturation adds harmonics that may push true peak. (3) Dither listed in the middle of the chain, not at the end — they\'ve re-quantised after dithering. (4) "I just bounced it through the master bus" — no mastering chain at all. Discussion question for the whole class: "When would you send a track to an independent mastering engineer instead of self-mastering it? What would you need to deliver to them?" Stem mastering discussion: teach students that the more they can deliver as stems, the more control the mastering engineer has. It\'s a professional workflow skill, not just a technical one.',
  },
]

// ─── Persisted slice (what we save to localStorage) ──────────────────────────

interface PersistedState {
  enabled: boolean
  role: LearnRole
  step: number
  /** BUG-07: persisted so "Analysis Complete" banner survives re-renders */
  completed: boolean
  assignment: AssignmentConfig | null
  annotations: LearnAnnotation[]
  blindTest: BlindTestPredictions | null
}

const STORAGE_KEY = 'rtm-learn-mode-v1'

function loadFromStorage(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPersisted()
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
      role: parsed.role === 'teacher' ? 'teacher' : 'student',
      // CRIT-5 fix: lower-clamp too — a tampered localStorage value of -999999 used
      // to crash the renderer because GUIDED_STEPS[state.step] returned undefined.
      step: typeof parsed.step === 'number' ? Math.max(0, Math.min(parsed.step, GUIDED_STEPS.length - 1)) : 0,
      completed: typeof parsed.completed === 'boolean' ? parsed.completed : false,
      assignment: parsed.assignment ?? null,
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      blindTest: parsed.blindTest ?? null,
    }
  } catch {
    return defaultPersisted()
  }
}

function defaultPersisted(): PersistedState {
  return { enabled: false, role: 'student', step: 0, completed: false, assignment: null, annotations: [], blindTest: null }
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

type Action =
  | { type: 'TOGGLE' }
  | { type: 'SET_ROLE'; role: LearnRole }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_STEP'; n: number }
  | { type: 'SET_COMPLETED'; v: boolean }
  | { type: 'SET_ASSIGNMENT'; assignment: AssignmentConfig | null }
  | { type: 'ADD_ANNOTATION'; annotation: LearnAnnotation }
  | { type: 'REMOVE_ANNOTATION'; id: string }
  | { type: 'CLEAR_ANNOTATIONS'; tabId: string; stepId?: string }
  | { type: 'SUBMIT_BLIND_TEST'; predictions: BlindTestPredictions }
  | { type: 'REVEAL_BLIND_TEST'; analysisResult?: any }
  | { type: 'RESET_BLIND_TEST' }

function reducer(state: PersistedState, action: Action): PersistedState {
  switch (action.type) {
    case 'TOGGLE':
      // Reset step to 0 when enabling so a new session always starts at Methodology.
      // When disabling, preserve step so re-enabling resumes where the user left off.
      return { ...state, enabled: !state.enabled, step: !state.enabled ? 0 : state.step }
    case 'SET_ROLE':
      return { ...state, role: action.role }
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, GUIDED_STEPS.length - 1) }
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 0) }
    case 'SET_STEP':
      return { ...state, step: Math.max(0, Math.min(action.n, GUIDED_STEPS.length - 1)) }
    case 'SET_COMPLETED':
      return { ...state, completed: action.v }
    case 'SET_ASSIGNMENT':
      return { ...state, assignment: action.assignment }
    case 'ADD_ANNOTATION':
      return { ...state, annotations: [...state.annotations, action.annotation] }
    case 'REMOVE_ANNOTATION':
      return { ...state, annotations: state.annotations.filter(a => a.id !== action.id) }
    case 'CLEAR_ANNOTATIONS':
      // BUG-16 + CRIT-2 fix: when stepId is provided, only clear annotations for that
      // step. Legacy annotations (no stepId) are shown on EVERY step by AnnotationLayer,
      // so we must keep them — the previous predicate `a.stepId !== undefined && …`
      // silently deleted legacy notes from all steps. Now we keep:
      //   - any different-tab annotation (untouched)
      //   - any legacy/no-stepId annotation (still visible on other steps)
      //   - any same-tab annotation whose stepId differs from the cleared step
      return {
        ...state,
        annotations: state.annotations.filter(a => {
          if (a.tabId !== action.tabId) return true        // different tab — keep
          if (!action.stepId) return false                  // no stepId → clear everything for this tab
          if (a.stepId === undefined) return true           // legacy annotation — keep (shown on every step)
          return a.stepId !== action.stepId                 // keep if it belongs to a different step
        }),
      }
    case 'SUBMIT_BLIND_TEST':
      return { ...state, blindTest: action.predictions }
    case 'REVEAL_BLIND_TEST': {
      if (!state.blindTest) return state
      // BUG-12 + CRIT-3 fix: stamp isCorrect on each measurable answer.
      // Explicit null/undefined guard before subtracting — previously `null - null === 0`
      // passed the isNaN check and produced meaningless isCorrect flags that ended up in
      // the teacher's Class Insights aggregation. Now we leave isCorrect = undefined when
      // either side of the comparison is missing.
      const ar = action.analysisResult ?? {}
      const isNum = (v: unknown): v is number => typeof v === 'number' && !isNaN(v)
      const revealedAnswers = state.blindTest.answers.map(a => {
        let isCorrect: boolean | undefined
        const c = a.choice
        const abs = (n: number) => Math.abs(n)
        if (a.dimension === 'loudness') {
          const aVal = ar.lufs_i_a ?? ar.lufs_a
          const bVal = ar.lufs_i_b ?? ar.lufs_b
          if (isNum(aVal) && isNum(bVal)) {
            const d = aVal - bVal
            isCorrect = abs(d) < 0.5 ? c === 'equal' : d > 0 ? c === 'A' : c === 'B'
          }
        } else if (a.dimension === 'stereo_width') {
          if (isNum(ar.stereo_width_a) && isNum(ar.stereo_width_b)) {
            const d = ar.stereo_width_a - ar.stereo_width_b
            isCorrect = abs(d) < 0.1 ? c === 'equal' : d > 0 ? c === 'A' : c === 'B'
          }
        } else if (a.dimension === 'dynamics') {
          if (isNum(ar.lra_a) && isNum(ar.lra_b)) {
            const d = ar.lra_a - ar.lra_b
            isCorrect = abs(d) < 0.1 ? c === 'equal' : d < 0 ? c === 'A' : c === 'B'
          }
        } else if (a.dimension === 'translation') {
          if (isNum(ar.mono_compat_a) && isNum(ar.mono_compat_b)) {
            const d = ar.mono_compat_a - ar.mono_compat_b
            isCorrect = abs(d) < 0.1 ? c === 'equal' : d > 0 ? c === 'A' : c === 'B'
          }
        }
        return { ...a, isCorrect }
      })
      return { ...state, blindTest: { ...state.blindTest, revealed: true, answers: revealedAnswers } }
    }
    case 'RESET_BLIND_TEST':
      return { ...state, blindTest: null }
    default:
      return state
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const LearnModeContext = createContext<LearnModeState | null>(null)

export function LearnModeProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadFromStorage)
  // NOT persisted — teacher preview-as-student is a local UI flag only.
  // Consumers that want to render the "effective" role should check
  // `previewingStudent || role === 'student'`.
  const [previewingStudent, setPreviewingStudent] = React.useState(false)

  // Persist every state change.
  useEffect(() => {
    try {
      const persisted: PersistedState = {
        enabled: state.enabled,
        role: state.role,
        step: state.step,
        completed: state.completed,
        assignment: state.assignment,
        annotations: state.annotations,
        blindTest: state.blindTest,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch { /* swallow — storage is best-effort */ }
  }, [state.enabled, state.role, state.step, state.completed, state.assignment, state.annotations, state.blindTest])

  const toggleLearnMode = useCallback(() => dispatch({ type: 'TOGGLE' }), [])
  const setRole = useCallback((role: LearnRole) => dispatch({ type: 'SET_ROLE', role }), [])
  const nextStep = useCallback(() => dispatch({ type: 'NEXT_STEP' }), [])
  const prevStep = useCallback(() => dispatch({ type: 'PREV_STEP' }), [])
  const setStep = useCallback((n: number) => dispatch({ type: 'SET_STEP', n }), [])
  const setCompleted = useCallback((v: boolean) => dispatch({ type: 'SET_COMPLETED', v }), [])
  const setAssignment = useCallback((assignment: AssignmentConfig | null) => dispatch({ type: 'SET_ASSIGNMENT', assignment }), [])

  const addAnnotation = useCallback((a: Omit<LearnAnnotation, 'id' | 'createdAt'>) => {
    const annotation: LearnAnnotation = {
      ...a,
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    }
    dispatch({ type: 'ADD_ANNOTATION', annotation })
  }, [])

  const removeAnnotation = useCallback((id: string) => dispatch({ type: 'REMOVE_ANNOTATION', id }), [])
  const clearAnnotations = useCallback((tabId: string, stepId?: string) => dispatch({ type: 'CLEAR_ANNOTATIONS', tabId, stepId }), [])

  const submitBlindTest = useCallback((p: BlindTestPredictions) => dispatch({ type: 'SUBMIT_BLIND_TEST', predictions: p }), [])
  const revealBlindTest = useCallback((analysisResult?: any) => dispatch({ type: 'REVEAL_BLIND_TEST', analysisResult }), [])
  const resetBlindTest = useCallback(() => dispatch({ type: 'RESET_BLIND_TEST' }), [])

  const value: LearnModeState = {
    enabled: state.enabled,
    role: state.role,
    step: state.step,
    completed: state.completed,
    assignment: state.assignment,
    annotations: state.annotations,
    blindTest: state.blindTest,
    previewingStudent,
    setPreviewingStudent,
    toggleLearnMode,
    setRole,
    nextStep,
    prevStep,
    setStep,
    setCompleted,
    setAssignment,
    addAnnotation,
    removeAnnotation,
    clearAnnotations,
    submitBlindTest,
    revealBlindTest,
    resetBlindTest,
  }

  return (
    <LearnModeContext.Provider value={value}>
      {children}
    </LearnModeContext.Provider>
  )
}

/** Hook to consume LearnModeContext. Throws if used outside LearnModeProvider. */
export function useLearnMode(): LearnModeState {
  const ctx = useContext(LearnModeContext)
  if (!ctx) throw new Error('useLearnMode must be used inside <LearnModeProvider>')
  return ctx
}
