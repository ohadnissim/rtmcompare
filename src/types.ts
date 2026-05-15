export interface SpecSnapshot {
 id: string
 name: string
 version: string
 published: string
 revised: string | null
 targets: Record<string, unknown>
 references: string[]
 provisional: boolean
}

export interface SpecVersions {
 version: number
 evaluated_at: string
 specs: Record<string, SpecSnapshot>
}

/**
 * One row of a batch / album analysis. Shaped to mirror
 * python/batch_analyze.py output 1-for-1 so we can stream straight through
 * IPC without mapping.
 */
export interface BatchResult {
 path: string
 filename: string
 analysed_sec: number | null
 error: string | null
 lufs_i: number | null
 true_peak_dbtp: number | null
 lra: number | null
 duration_sec: number | null
 sample_rate: number | null
 bit_depth: number | null
 channels: number | null
 clipped_samples: number | null
 mono_compat_loss_pct: number | null
 /** 31-band 1/3-octave spectrum in dB relative to peak, if available.
 * Powers Cohort Mode's reference-distance column + drift heatmap.
 * Null when computation failed or the file was too short. */
 spectrum: number[] | null
 isrc: string | null
 upc: string | null
 title: string | null
 artist: string | null
 album: string | null
 track_number: string | null
 /** Explicit-content flag from embedded metadata (ID3 TXXX:advisory,
 * iXML NOTE, or BWF bext description convention). `null` when the
 * file doesn't assert a value. Used by DMR to diff against manifest
 * ParentalWarningType. */
 explicit?: boolean | null
 /** Phonogram copyright (℗) line from ID3 TCOP / LIST ICOP. */
 p_line?: string | null
 /** Composition copyright (©) line — rare in audio, but DDEX requires
 * it for certain Apple submissions so we surface when present. */
 c_line?: string | null
 /** Standards registry snapshot used when this row was analysed. */
 spec_versions?: SpecVersions
}

/**
 * Persisted album-batch session — what Save / Load writes and reads.
 *
 * Why it exists: engineers analyse an album, jot notes, then come back the
 * next day to keep working. We don't want them to re-run 12 analyses just
 * to re-read their notes, so we serialise the analysis rows + notes + open-
 * tab state to a single JSON the user picks a path for.
 *
 * Bump `version` (and write a migration) if the shape changes in a way
 * older files can't be trivially loaded — today a string is just a string.
 */
export const ALBUM_SESSION_VERSION = 1
export interface AlbumSession {
 version: number
 /** ISO timestamp of the save. */
 savedAt: string
 /** Display folder name captured at save time. */
 folderName: string | null
 /** Full batch-analysis rows, keyed by absolute path. Paths may become
 * stale if the user moves files; the renderer tolerates that by only
 * re-using path for display + for save/load, not for re-analysis. */
 results: BatchResult[]
 notes: {
 /** Album-level note — shown above the table + in PDF handoff. */
 album: string
 /** Per-song notes keyed by BatchResult.path. */
 songs: Record<string, string>
 }
 /** Which song tabs were open at save time; restored verbatim on load so
 * the user lands back in the same context. */
 openTabs: string[]
 /** Active tab — either a path in `openTabs` or the sentinel 'overview'. */
 activeTab: string
 /** Standards registry snapshot for stale-spec detection on reload. */
 spec_versions?: SpecVersions
}

// Delivery-Manifest Reconciler / ISRC history / Releases store / DSP
// status types REMOVED — those workflows live in FLOW. RTM's batch /
// album QC retains its album-level duplicate-ISRC sanity check (read
// directly off BatchResult.isrc) but no longer authors release records,
// reconciles against label CSVs, or tracks ISRCs across sessions.

export interface Category {
 name: string
 level_a: number
 level_b: number
 level_diff: number
 width_a: number
 width_b: number
 pan_a: number
 pan_b: number
 dynamics_a: number
 dynamics_b: number
 punch_a: number
 punch_b: number
 centroid_a: number
 centroid_b: number
 insight: string
}

export interface Recommendation {
 priority: 'high' | 'medium' | 'low'
 area: string
 action: string
}

export interface ClickArtifact {
 time: number
 time_formatted: string
 severity: 'high' | 'medium' | 'low'
 energy_db: number
 description: string
}

export interface DistortionResult {
 severity: 'clean' | 'warning' | 'problem'
 /** How defensible is the severity call? High = direct evidence (clipping
 * runs, TP over 0.5 dB). Medium = flat-waveform % (could be limiter-
 * by-design). Low = THD-only (saturation is routinely intentional).
 * The UI down-weights low-confidence findings in the verdict rail so
 * "subtle saturation" never HOLDs a delivery by itself. */
 confidence?: 'high' | 'medium' | 'low'
 issues: string[]
 recommendations: string[]
 clipping: {
 a_clip_count: number
 b_clip_count: number
 a_clip_pct: number
 b_clip_pct: number
 }
 true_peaks: {
 a_true_peak_db: number
 b_true_peak_db: number
 a_over_count: number
 b_over_count: number
 }
 limiting: {
 a_flat_pct: number
 b_flat_pct: number
 }
 harmonics: {
 thd_increase_pct: number
 }
}

export interface TonalIssue {
 name: string
 severity: 'warning' | 'info'
 level_a: number
 level_b: number
 diff: number
 freq_range: string
 description: string
 fix: string
 detail: string
}

export interface ReferenceCheck {
 status: 'good' | 'fair' | 'poor'
 summary: string
 warnings: {
 type: string
 severity: 'warning' | 'info'
 message: string
 suggestion: string
 }[]
 song_info?: {
 bpm: number
 key: string
 key_confidence?: number
 key_alternates?: { key: string; score: number }[]
 key_freq: number
 root_note: string
 harmonics?: { freq: number; label: string; is_root: boolean }[]
 // 5.2.3: genre auto-detection removed entirely. The classifier was
 // unreliable on real-world masters (false readings) and the data
 // wasn't acted on anywhere downstream. Field kept optional in case
 // any cached old result still has it; ignored on render.
 }
 stats: {
 lufs: number
 dynamic_range: number
 stereo_correlation: number
 clip_count: number
 clip_regions?: { start: number; end: number; start_formatted: string; end_formatted: string; samples: number }[]
 }
 tonal?: {
 character: string
 measured: number[]
 neutral_curve: number[]
 deviations: number[]
 notes: { region: string; freq_range: string; deviation: number; severity: string; description: string }[]
 freqs: string[]
 }
}

export interface FileMetadata {
 bext?: {
 description?: string
 originator?: string
 originator_reference?: string
 origination_date?: string
 origination_time?: string
 umid?: string
 coding_history?: string
 coding_history_parsed?: { raw: string; algorithm?: string; sample_rate?: string; bit_rate?: string; bit_depth?: string; mode?: string; text?: string }[]
 }
 ixml?: { project?: string; scene?: string; take?: string; note?: string; isrc?: string }
 info?: { title?: string; artist?: string; album?: string; date?: string; genre?: string; track?: string; copyright?: string; software?: string; comment?: string; engineer?: string; source?: string }
 id3?: { title?: string; artist?: string; album_artist?: string; album?: string; track?: string; year?: string; date?: string; genre?: string; isrc?: string; copyright?: string; software?: string; encoded_by?: string; comment?: string }
 file_bytes?: number
}

export interface MonoBand {
 name: string
 freq_range: string
 impact: number
 note: string
 correlation: number
 loss_pct: number
 risk: number
}

export interface MonoCompatibility {
 correlation_a: number
 correlation_b: number
 mono_loss_a_pct: number
 mono_loss_b_pct: number
 bands_a?: MonoBand[]
 bands_b?: MonoBand[]
 risk_a?: number
 risk_b?: number
 insight: string
}

export interface MasteringDelta {
 broadband_gain_db: number
 per_band_gain_db: number[]
 lra_delta: number
 psr_delta: number
 transient_density_change_pct: number
 stereo_width_change_per_band: number[]
 tp_overs_pulled_back: number
 limiter_aggressiveness: number
 perceived_gain_per_platform: Record<string, number>
 signature_hash: string
 rms_to_peak_delta?: number
 peak_to_rms_ratio_change?: number
 tp_overs_a?: number
 tp_overs_b?: number
 estimated_gain_reduction_db?: number
 width_per_band_a?: number[]   // 8 values, 0=mono, 1=decorrelated, bands: 63/125/250/500/1k/2k/4k/8k Hz
 width_per_band_b?: number[]
 // Crest trajectory — dynamic fatigue curve
 crest_trajectory?: {
  segments: { start_s: number; crest_db: number }[]
  crest_variance_db2: number
  crest_mean_db: number
  trajectory: 'dynamic' | 'moderate' | 'flat'
  n_segments: number
 }
 // Perceptual quality distance
 perceptual_quality?: {
  perceptual_distance_db: number
  quality_interpretation: string
 }
 // Transient homogeneity (limiter tell)
 transient_homogeneity?: {
  homogeneity_score: number  // 0..1
  flag: boolean
 }
 // PLR plausibility flag
 plr_plausibility?: {
  plr_db: number
  lufs_i_db: number
  flag: boolean
  note: string
 }
 // Measurement chain inconsistency
 measurement_inconsistency?: string
 // Polarity inversion
 polarity_inverted?: boolean
}

export interface AnalysisResult {
 spec_versions?: SpecVersions
 comparison_mode?: ComparisonMode
 atmos?: AtmosAnalysis
 atmos_object_view?: AtmosObjectView
 atmos_qc?: AtmosQC
 atmos_channels?: { channel: string; label: string; role: string; level_db: number; centroid_hz: number; dynamic_range_db: number; is_active: boolean; description: string }[]
 atmos_downmix_path?: string
 engineer_tips?: EngineerTips
 chain_tips?: ChainTips
 level_matched: boolean
 gain_applied_db: number
 categories: Category[]
 recommendations: Recommendation[]
 clicks: ClickArtifact[]
 /** ADM structural validation — populated by python/adm_parser.py's
 * validate_adm() when an ADM file is analysed. Surfaced above the
 * Atmos preflight so block-severity issues gate delivery. */
 adm_validation?: { severity: 'block' | 'warn' | 'info'; code: string; message: string; field?: string }[]
 distortion?: DistortionResult
 /** Limiter-artefact detector — pumping / ISO peaks / HF ringing.
 * Runs alongside distortion for the mastering QC surface. */
 limiter_artefacts?: {
 severity: 'clean' | 'advisory' | 'warning' | 'problem'
 confidence: 'high' | 'medium' | 'low'
 issues: string[]
 recommendations: string[]
 pump_score: number
 intersample_over_count: number
 intersample_over_per_min: number
 ringing_events: number
 }
 spectrum_a?: number[]
 spectrum_b?: number[]
 mid_spectrum_a?: number[]
 mid_spectrum_b?: number[]
 side_spectrum_a?: number[]
 side_spectrum_b?: number[]
 mono_compat?: MonoCompatibility
 mastering_delta?: MasteringDelta
 /** Short-term LUFS (3-second window, ~10 Hz sample rate). The
 * traditional "how the song breathes" timeline — what the current
 * Loudness-over-time panel renders. */
 lufs_over_time_a?: number[]
 lufs_over_time_b?: number[]
 /** Momentary LUFS (400 ms window). Faster than short-term — catches
 * pumping artefacts and serves as the dialog-anchor read in post
 * workflows. 1770 author) + Roberto
 * (ADR) + Ariel (Atmos). Overlaid on the short-term plot in the
 * LoudnessTimeline component when present. */
 lufs_momentary_a?: number[]
 lufs_momentary_b?: number[]
 /** Dialog-gated loudness read — populated by the Python backend's
 * speech-gate pass. Netflix / ATSC A/85 anchor against this, not
 * the full-programme integrated. Falsy when no speech detected.
 * `insufficient` and `error` are structured failure states from the
 * speech-gate detector — the row should still render with a note,
 * but lufs_i will be null and no LUFS number should be shown. */
 dialog_gate?: {
 lufs_i: number | null
 speech_pct: number
 confidence: 'high' | 'medium' | 'low' | 'none' | 'insufficient' | 'error'
 note?: string
 } | null
 phase_over_time_a?: number[]
 phase_over_time_b?: number[]
 waveform_a?: number[]
 waveform_b?: number[]
 vectorscope_a?: { l: number; r: number }[]
 vectorscope_b?: { l: number; r: number }[]
 duration_sec?: number
 duration_sec_a?: number
 duration_sec_b?: number
 tonal_issues?: TonalIssue[]
 reference_check?: ReferenceCheck
 file_warnings?: { type: string; message: string }[]
 /** Generation-loss detector result — populated by python/generation_loss_detector.py.
  * Absent when the detector is not installed or skipped for non-lossy inputs. */
 generation_loss?: {
  probability: number      // 0–1
  verdict: 'likely_lossless' | 'suspect' | 'likely_prior_lossy'
  summary: string
  checks: { name: string; score: number; detail: string }[]
  deployment_ready: boolean
 } | null
 phase_bands_a?: { name: string; freq_range: string; correlation: number }[]
 phase_bands_b?: { name: string; freq_range: string; correlation: number }[]
 stereo_timeline_a?: { width: number[]; correlation: number[]; balance: number[] }
 stereo_timeline_b?: { width: number[]; correlation: number[]; balance: number[] }
 streaming_preview?: {
 a: { name: string; played_lufs: number; played_tp: number; delta_db: number; action: string; tp_breach: boolean; target_lufs: number; target_tp: number }[]
 b: { name: string; played_lufs: number; played_tp: number; delta_db: number; action: string; tp_breach: boolean; target_lufs: number; target_tp: number }[]
 }
 // 5.2.3: top-level genre_a/genre_b removed alongside song_info.genre
 // (see comment above). Cached results may still carry these fields;
 // they're silently ignored downstream.
 hum?: {
 mains: number
 harmonics: { freq: number; prominence_db: number; coverage: number }[]
 notch_preset: { freq: number; q: number; gain_db: number }[]
 severity: 'none' | 'subtle' | 'audible'
 summary: string
 }
 transient_density?: {
 timeline: { time: number; density: number; energy: number }[]
 sections: { start: number; end: number; label: string; energy: number }[]
 }
 waveform_diff?: {
 freqs: number[]
 timeline: number[]
 window_sec: number
 grid: number[][] // [time][freq] → dB diff (B − A)
 hotspots: { time_sec: number; freq_hz: number; diff_db: number }[]
 duration_sec: number
 }
 masking?: {
 overlaps: {
 pair: string
 freq_range: string
 severity: 'high' | 'medium' | 'low' | 'info'
 description: string
 level_a: number
 level_b: number
 tip: string
 }[]
 stem_based: boolean
 }
 metadata?: {
 a?: FileMetadata
 b?: FileMetadata
 }
 headroom?: {
 a: number
 b: number
 true_peak_a: number
 true_peak_b: number
 }
 stems?: {
 a: Record<string, string>
 b: Record<string, string>
 }
 overall: {
 lufs_a: number
 lufs_b: number
 loudness_diff: number
 short_term_max_a?: number
 short_term_max_b?: number
 plr_a?: number
 plr_b?: number
 psr_a?: number | null
 psr_b?: number | null
 visqol_mos?: number | null
 momentary_max_a?: number
 momentary_max_b?: number
 width_a: number
 width_b: number
 dynamics_a: number
 dynamics_b: number
 insights: string[]
 }
}

// ─── Atmos / Multichannel types ─────────────────────────────────────────────

export type ComparisonMode = 'stereo' | 'stereo_vs_atmos' | 'atmos_solo'

export interface ChannelEnergy {
 channel: string
 label: string
 level_db: number
 group: 'ear_level' | 'height' | 'lfe'
 azimuth: number
 elevation: number
}

export interface LfeAnalysis {
 level_db: number
 has_content: boolean
 high_freq_warning: boolean
 high_freq_energy_db: number
}

export interface SurroundBalance {
 ls_db: number
 rs_db: number
 lrs_db: number
 rrs_db: number
 lr_diff_db: number
 rear_lr_diff_db: number
 balanced: boolean
}

export interface DownmixDelta {
 categories: { name: string; diff_db: number }[]
 overall_diff_db: number
 insight: string
}

export interface MissingElement {
 name: string
 severity: 'missing' | 'reduced'
 diff_db: number
 message: string
 suggestion: string
}

export interface AtmosObjectView {
 object_count: number
 heatmap_grid: number[][]
 heatmap_dims: { az_bins: number; el_bins: number }
 trajectories: { name: string; cf_id: string; points: { t: number; az: number; el: number; dist: number }[] }[]
 stats: { name: string; motion: string; travel_deg: number; height_pct: number; duration_sec: number; start_sec: number; end_sec: number }[]
 heights_over_time: [number, number][]
 duration_sec: number
}

export interface AtmosAnalysis {
 channel_count: number
 channel_layout: string
 programme_name?: string
 object_count: number
 has_adm?: boolean
 object_energy_db?: number | null
 channel_energy: ChannelEnergy[]
 height_ratio: number
 center_extraction: number
 lfe: LfeAnalysis
 surround_balance: SurroundBalance
 binaural_tp?: { true_peak_db: number; headroom_db: number; method: string } | null
 downmix_delta: DownmixDelta
 missing_elements?: MissingElement[]
}

export interface AtmosQCCheck {
 name: string
 status: 'pass' | 'warning' | 'fail'
 value: string
 target: string
 message: string
 suggestion: string
}

export interface AtmosQC {
 status: 'pass' | 'warning' | 'fail'
 summary: string
 score: number
 specs: {
 loudness_lufs: number
 true_peak_dbtp: number
 sample_rate: number
 bit_depth: number
 channel_count: number
 layout: string
 duration_sec: number
 }
 checks: AtmosQCCheck[]
 channel_stats: {
 active_channels: number
 silent_channels: string[]
 loudest_channel: string
 quietest_active: string
 }
}

// AI Detection types removed in 5.5.0 — see CHANGELOG.

// ─── Engineer Profile types ─────────────────────────────────────────────────

export interface EngineerTip {
 category: string
 priority: 'high' | 'medium' | 'low'
 tip: string
 detail: string
 // Optional structured EQ move — populated for tonal-balance tips so the
 // UI can render freq + gain + Q as a compact chip without parsing the
 // tip string.
 eq_move?: { freq: number; gain_db: number; q: number; q_note?: string; region: string } | null
}

export interface EngineerTips {
 engineer: string
 profile_id: string
 tips: EngineerTip[]
 tonal_diff: { region: string; freq_range: string; diff_db: number; direction: string }[]
 summary: string
 file_stats: { lufs: number; short_term_max: number; true_peak: number; dynamic_range: number; width: number }
 target_stats: { lufs: number; dynamic_range: number; width: number }
 spectrum_file?: number[]
 spectrum_target?: number[]
 spectrum_corrected?: number[]
 // 5.7.x: log-frequency Hann-smoothed counterparts of the raw spectra.
 // These are what the recommender actually diffs (so a tuned-kick spike
 // at 50 Hz doesn't read as a broad-band imbalance and trigger a phantom
 // -7 dB cut). The Tonal Curve chart and the per-region tonal_diff bars
 // both render off these so the visual matches the recommendations —
 // before this we drew the raw lines and Mike (correctly) flagged that
 // the chart looked way more dramatic than the tip set warranted.
 spectrum_file_smoothed?: number[]
 spectrum_target_smoothed?: number[]
 freqs?: string[]
 eq_filters?: { freq: number; gain_db: number; q: number; q_note?: string; region: string }[]
 match_score?: number
 chain_analysis?: {
   eq_curve: (number | null)[]
   eq_mad: (number | null)[]
   pair_count: number
   pairs: { mix: string; master: string }[]
   label: string
 }
}

/** Result returned when a chain profile is applied to a file. */
export interface ChainTips {
 engineer: string
 profile_id: string
 profile_type: 'chain'
 pair_count: number
 /** File spectrum shifted by the chain delta — where this mix lands after mastering. */
 spectrum_after_chain: number[]
 spectrum_file: number[]
 freqs: string[]
 eq_curve: (number | null)[]
 eq_mad: (number | null)[]
}

export interface StemAnalysis {
 name: string
 insights: string[]
 level: { lufs_a: number; lufs_b: number; diff_db: number }
 stereo: { width_a: number; width_b: number; pan_a: number; pan_b: number }
 dynamics: { dynamic_range_a: number; dynamic_range_b: number; diff: number }
}

export type AppState = 'upload' | 'processing' | 'results' | 'ref-only' | 'batch'

/**
 * A single row in the local version-history log. One per completed
 * analysis of a "target" file (File B in a 2-file compare, the single
 * file in ref-only / QC, or each row of a batch analysis). Persisted to
 * `~/.rtm/history.json` and surfaced on the upload screen as "Recent
 * analyses" so users can re-pull a previous version as Reference A with
 * a single click.
 */
export interface HistoryEntry {
 /** Stable unique ID for this history entry (UUID or similar). */
 id?: string
 /** SHA-256 of the audio file when it was analysed — the canonical identity
 * that survives renames and folder moves. */
 sha256: string
 /** Filename at analysis time (may have changed since — path is the fallback). */
 name: string
 /** Absolute path at analysis time. Used to re-load if the file is still
 * where we left it; if not, user is prompted to locate it. */
 path: string
 /** Unix ms timestamp of when the analysis ran. */
 ts: number
 /** How the file was analysed — determines whether there's a paired ref. */
 mode: 'compare' | 'ref-only' | 'batch'
 /** Filename of the reference used (when mode='compare'). */
 ref_name?: string
 /** Key metrics snapshot so the history list can show LUFS/TP/LRA at a glance
 * without re-running anything. */
 lufs?: number
 true_peak?: number
 lra?: number
 duration_sec?: number
 /** Standards registry snapshot used when the analysis was generated. */
 spec_versions?: SpecVersions
 /** Human label, optional — e.g. "v3 · after master bus tweak". */
 note?: string
}

export interface FileInfo {
 path: string
 name: string
}

/**
 * Reference Library record. Persisted at ~/.rtm/references.json.
 * All analysis fields optional because a partial quick-scan still
 * stores a useful row (the user may have deleted the audio file since
 * adding it, etc.). User-editable fields: `tags`, `notes`.
 */
export interface ReferenceRecord {
 id: string
 path: string
 filename: string
 added_at: string
 sample_rate?: number
 channels?: number
 duration_sec?: number
 lufs_i?: number | null
 lra?: number
 true_peak_dbtp?: number
 /** 31-band 1/3-octave spectrum in dB relative to the band peak. */
 spectrum?: number[]
 bpm?: number
 key?: string
 tags?: string[]
 notes?: string
 error?: string
}

/**
 * One detected click from python/declick.py. Shape mirrors the Python
 * dataclass Click 1-for-1 so IPC passes through unchanged.
 */
export interface DeclickClick {
 sample: number
 channel: number
 width_samples: number
 severity_db: number
 band?: string
}

/**
 * Aggregate result returned by both `declick-process` and
 * `declick-preview`. `output_path` is null only when the user requests
 * mode=list (no audio written).
 */
export interface DeclickResult {
 click_count: number
 clicks_per_minute: number
 clicks: DeclickClick[]
 output_path: string | null
 samples_repaired: number
 duration_sec: number
}

// ─── Learn Mode Types ────────────────────────────────────────────────────────

export type LearnRole = 'student' | 'teacher'

export interface RubricCriteria {
 id: string
 metric: string        // e.g. 'lufs_i', 'lra', 'true_peak_dbtp'
 label: string         // human label, e.g. 'Integrated Loudness'
 target: number        // target value (e.g. -14 for LUFS-I)
 tolerance: number     // acceptable deviation (e.g. 1.5)
 weight: number        // 0–1, weights in rubric sum to 1
 points?: number       // optional point value for this criterion
}

export interface AssignmentConfig {
 title: string
 instructor: string
 course?: string
 studentName: string
 studentId?: string
 dueDate?: string
 genre?: string   // e.g. 'Pop', 'EDM', 'Rock', 'Hip-Hop', 'Jazz', 'Classical', 'Podcast'
 submissionsFolder?: string   // teacher-set folder path where students drop .rtm-report.json files
 lockedReferenceFile?: string | null   // absolute path or null
 lockedTargetSpec?: string | null      // spec ID string or null
 rubric: RubricCriteria[]
}

export interface LearnAnnotation {
 id: string
 text: string
 tabId?: string          // which analysis tab this note belongs to
 /** BUG-16 fix: step ID (GUIDED_STEPS[n].id) so steps sharing the same
  *  tabId ('overview' shared by steps 1, 2, 9) get separate annotation namespaces */
 stepId?: string
 positionX?: number      // 0–1 relative horizontal position (waveform)
 color?: 'gold' | 'red' | 'teal' | 'sand'
 createdAt: string       // ISO string
}

export interface LearnGuidedStep {
 id: string
 label: string           // step name shown in progress bar
 tabId: string           // App tab to navigate to
 question: string        // question the student should answer
 hint?: string           // optional hint text
 targetTab?: string      // human-readable tab label shown as a navigate-to hint
 teacherQuestion?: string  // teacher-facing focus prompt (what to teach / look for)
 teacherHint?: string      // teacher-facing guidance on common mistakes + discussion
}

export interface BlindTestAnswer {
  dimension: 'loudness' | 'tonal_low' | 'tonal_bright' | 'stereo_width' | 'dynamics' | 'translation' | 'overall'
  choice: 'A' | 'equal' | 'B'
  notes: string
  /** BUG-12 fix: set to true/false when measurements are revealed; undefined if not yet revealed or dimension is unmeasurable */
  isCorrect?: boolean
}

export interface EarTrainingAnswers {
  /** Which frequency regions are more prominent in B vs A (checkboxes, multiple allowed) */
  frequencyRegions: Array<'sub' | 'bass' | 'low_mids' | 'mids' | 'upper_mids' | 'presence' | 'air'>
  /** What reverb type is most prominent on the lead element */
  reverbType: 'plate' | 'hall' | 'room' | 'spring' | 'none' | ''
  /** What would you predict loses most when summed to mono */
  monoPrediction: 'sub_loss' | 'mid_fullness' | 'stereo_collapse' | 'nothing' | ''
}

export interface BlindTestPredictions {
  answers: BlindTestAnswer[]
  earTraining?: EarTrainingAnswers
  submittedAt: string
  revealed: boolean
}

// ─── Ear Training (Golden Ears-style) ────────────────────────────────────────

export type EarTrainingDrillId =
  | 'frequency_id'        // Identify which band was boosted/cut
  | 'eq_direction'        // Was it a boost or a cut?
  | 'q_width'             // Narrow Q vs wide Q
  | 'compression'         // Was that compressed or not?
  | 'reverb_time'         // Short or long reverb?
  | 'distortion'          // Clean or saturated?

export type EarTrainingDifficulty = 'beginner' | 'intermediate' | 'advanced'

export interface EarTrainingPerBandStat {
  attempts: number
  correct: number
}

export interface EarTrainingDrillStats {
  attempts: number
  correct: number
  /** key: band ID (e.g. "1000hz") or drill option ("boost"/"cut").
   *  Lets us build a heat-map of where the student is weak. */
  perOption: Record<string, EarTrainingPerBandStat>
  lastDifficulty: EarTrainingDifficulty
  streak: number               // consecutive correct (for unlock progression)
  bestStreak: number
}

export interface EarTrainingProgress {
  /** per-drill stats keyed by EarTrainingDrillId */
  drills: Record<EarTrainingDrillId, EarTrainingDrillStats>
  /** drills the student has unlocked (Berklee/Full Sail progression).
   *  frequency_id is unlocked by default. */
  unlocked: EarTrainingDrillId[]
  /** max difficulty unlocked per drill */
  unlockedDifficulty: Record<EarTrainingDrillId, EarTrainingDifficulty>
  totalAttempts: number
  totalCorrect: number
  lastUpdated: string  // ISO timestamp
}

export interface LearnModeState {
 enabled: boolean
 role: LearnRole
 step: number                        // current guided step (0-indexed)
 /** BUG-07 fix: persisted so "Analysis Complete" banner survives re-renders */
 completed: boolean
 assignment: AssignmentConfig | null
 annotations: LearnAnnotation[]
 blindTest: BlindTestPredictions | null
 /** Teacher previewing as student — NOT persisted, derived from local UI state.
  *  When true, every consumer should treat the user as a student (sidebar,
  *  hidden teacher buttons, etc.) without touching the actual persisted role. */
 previewingStudent: boolean
 setPreviewingStudent: (v: boolean) => void
 toggleLearnMode: () => void
 setRole: (role: LearnRole) => void
 nextStep: () => void
 prevStep: () => void
 setStep: (n: number) => void
 setCompleted: (v: boolean) => void
 setAssignment: (a: AssignmentConfig | null) => void
 addAnnotation: (a: Omit<LearnAnnotation, 'id' | 'createdAt'>) => void
 removeAnnotation: (id: string) => void
 clearAnnotations: (tabId: string, stepId?: string) => void
 submitBlindTest: (predictions: BlindTestPredictions) => void
 revealBlindTest: (analysisResult?: any) => void
 resetBlindTest: () => void
}
