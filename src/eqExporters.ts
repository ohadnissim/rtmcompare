import type { EQBand } from './EQContext'

/**
 * DAW-native EQ preset exporters.
 *
 * Two outputs:
 *
 * 1. Ableton EQ Eight `.adv` — gzipped XML preset that drops onto
 *    an EQ Eight instance in Live 11 / 12. Uses the Live 12.3.6
 *    schema diffed from a factory `EQ Eight.adv` fixture: root
 *    `<Ableton ...><Eq8>` directly (no `<DevicePreset>` wrap),
 *    `<Bands.0>..<Bands.7>` each with `<ParameterA>` + `<ParameterB>`,
 *    and `<Freq>` (not `<Frequency>`). Pre-5.0.5 builds wrapped the
 *    Eq8 in DevicePreset/Device — that file did not load on EQ Eight.
 *
 * 2. FabFilter Pro-Q 3/4 binary `.ffp` — native preset; reverse
 *    engineered from public reference encoders. Pro-Q 4 reads the
 *    Pro-Q 3 binary unchanged. See `buildProQ3Ffp` for the layout.
 *    A plain-text "paste into Pro-Q's Paste bar" path lives in
 *    EQExportButton.exportFFP, and the structured JSON sibling
 *    (`buildFabFilterProQJson`) is kept here for tooling chains
 *    that round-trip RTM data.
 *
 * Logic Channel EQ and Wavelab SparkleEQ exporters were removed in
 * 5.0.5 after a codex format audit: Logic uses a private `.pst`
 * format (not `.aupreset`), and SparkleEQ doesn't exist as a real
 * Wavelab preset target. The CSV / JSON / clipboard fallbacks in
 * EQExportButton cover Logic and Wavelab users via manual dial-in.
 */


// ── Ableton EQ Eight (.adv) ────────────────────────────────────────

/**
 * Map our parametric bands onto Ableton's EQ Eight (8-band) layout.
 * EQ Eight filter type IDs (0..7) per Live's `<Mode>` parameter:
 *   0 = High Cut 48
 *   1 = High Cut 12
 *   2 = Low Shelf
 *   3 = Bell (Peak)
 *   4 = Notch
 *   5 = High Shelf
 *   6 = Low Cut 12
 *   7 = Low Cut 48
 *
 * (Live 12 keeps the same `<Mode>` integer codes used since Live 9.)
 */
function abletonFilterType(band: EQBand): number {
  switch (band.type) {
    case 'lowshelf':  return 2
    case 'highshelf': return 5
    case 'notch':     return 4
    case 'highpass':  return 6  // "Low Cut 12"
    case 'lowpass':   return 1  // "High Cut 12"
    default:          return 3  // bell / peaking
  }
}

function pad8<T>(arr: T[], filler: T): T[] {
  const out = arr.slice(0, 8)
  while (out.length < 8) out.push(filler)
  return out
}

function clamp01(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}

// Per-slot factory defaults extracted from Live 12.3.6's stock
// `EQ Eight.adv` so unused slots get reasonable values rather than
// 8 stacked bells at 1 kHz.
const EQ8_DEFAULT_FREQS = [30, 200, 500, 1000, 2000, 4000, 8000, 18000]
const EQ8_DEFAULT_MODES = [2, 3, 3, 3, 3, 3, 3, 6]

/** Shared subnodes used by every EQ Eight `<Manual>` parameter. */
const EQ8_AUTO = `<AutomationTarget Id="0"><LockEnvelope Value="0" /></AutomationTarget>`
const EQ8_MOD  = `<ModulationTarget Id="0"><LockEnvelope Value="0" /></ModulationTarget>`
const EQ8_MIDI_ONOFF = `<MidiCCOnOffThresholds><Min Value="64" /><Max Value="127" /></MidiCCOnOffThresholds>`

/** `<IsOn>` block: bool Manual, no ranges, MidiCCOnOffThresholds. */
function eq8IsOn(value: boolean): string {
  return `<IsOn>
            <LomId Value="0" />
            <Manual Value="${value ? 'true' : 'false'}" />
            ${EQ8_AUTO}
            ${EQ8_MIDI_ONOFF}
          </IsOn>`
}

/** `<Mode>`: integer Manual, MidiControllerRange 0..7 AFTER AutomationTarget. */
function eq8Mode(value: number): string {
  return `<Mode>
            <LomId Value="0" />
            <Manual Value="${value}" />
            ${EQ8_AUTO}
            <MidiControllerRange><Min Value="0" /><Max Value="7" /></MidiControllerRange>
          </Mode>`
}

/** `<Freq>` / `<Gain>` / `<Q>`: numeric Manual, MidiControllerRange BEFORE AutomationTarget, then ModulationTarget. */
function eq8Numeric(name: 'Freq' | 'Gain' | 'Q', value: number, min: string, max: string): string {
  return `<${name}>
            <LomId Value="0" />
            <Manual Value="${value}" />
            <MidiControllerRange><Min Value="${min}" /><Max Value="${max}" /></MidiControllerRange>
            ${EQ8_AUTO}
            ${EQ8_MOD}
          </${name}>`
}

/** Render a single `<ParameterA>` or `<ParameterB>` block. */
function eq8ParamBlock(opts: { isOn: boolean; mode: number; freq: number; gain: number; q: number }): string {
  return `${eq8IsOn(opts.isOn)}
          ${eq8Mode(opts.mode)}
          ${eq8Numeric('Freq', opts.freq, '10', '22000')}
          ${eq8Numeric('Gain', opts.gain, '-15', '15')}
          ${eq8Numeric('Q', opts.q, '0.1000000015', '18')}`
}

function eq8Band(i: number, b: EQBand | null): string {
  const def = { mode: EQ8_DEFAULT_MODES[i], freq: EQ8_DEFAULT_FREQS[i] }
  const a = b
    ? {
        isOn: b.enabled !== false,
        mode: abletonFilterType(b),
        freq: clamp01(b.freq, 10, 22000),
        gain: clamp01(b.gain_db, -15, 15),
        q:    clamp01(b.q, 0.1, 18),
      }
    : { isOn: false, mode: def.mode, freq: def.freq, gain: 0, q: 0.7071067691 }

  // ParameterB mirrors A's freq but stays disabled — Live uses A/B
  // for the toggle compare; matching A keeps the visual stable.
  const bParam = { isOn: false, mode: def.mode, freq: def.freq, gain: 0, q: 0.7071067691 }

  return `<Bands.${i}>
        <ParameterA>
          ${eq8ParamBlock(a)}
        </ParameterA>
        <ParameterB>
          ${eq8ParamBlock(bParam)}
        </ParameterB>
      </Bands.${i}>`
}

export function buildAbletonEqEightXml(bands: EQBand[], amount: number = 1.0): string {
  const scaled = bands.filter(b => b.enabled).map(b => ({
    ...b,
    gain_db: b.gain_db * amount,
  }))
  const eight = pad8<EQBand | null>(scaled, null)

  const bandsXml = eight.map((b, i) => eq8Band(i, b)).join('\n      ')

  // Top-level `<Eq8>` directly under `<Ableton>` — NOT wrapped in
  // `<DevicePreset><Device>`. Verified against Live 12.3.6's stock
  // `EQ Eight.adv` (gzipped XML, 30,963-byte XML body).
  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12300" SchemaChangeCount="1" Creator="RTMcompare">
  <Eq8>
    <LomId Value="0" />
    <LomIdView Value="0" />
    <IsExpanded Value="false" />
    <BreakoutIsExpanded Value="false" />
    <On>
      <LomId Value="0" />
      <Manual Value="true" />
      ${EQ8_AUTO}
      ${EQ8_MIDI_ONOFF}
    </On>
    <ModulationSourceCount Value="0" />
    <ParametersListWrapper LomId="0" />
    <Pointee Id="0" />
    <LastSelectedTimeableIndex Value="0" />
    <LastSelectedClipEnvelopeIndex Value="0" />
    <LastPresetRef>
      <Value>
        <AbletonDefaultPresetRef Id="0">
          <FileRef>
            <RelativePathType Value="0" />
            <RelativePath Value="" />
            <Path Value="" />
            <Type Value="2" />
            <LivePackName Value="" />
            <LivePackId Value="" />
            <OriginalFileSize Value="0" />
            <OriginalCrc Value="0" />
            <SourceHint Value="" />
          </FileRef>
          <DeviceId Name="Eq8" />
        </AbletonDefaultPresetRef>
      </Value>
    </LastPresetRef>
    <LockedScripts />
    <IsFolded Value="false" />
    <ShouldShowPresetName Value="true" />
    <UserName Value="" />
    <Annotation Value="" />
    <SourceContext>
      <Value />
    </SourceContext>
    <MpePitchBendUsesTuning Value="true" />
    <ViewData Value="{}" />
    <OverwriteProtectionNumber Value="3075" />
    <Precision Value="0" />
    <Mode Value="0" />
    <EditMode Value="false" />
    <SelectedBand Value="0" />
    <GlobalGain>
      <LomId Value="0" />
      <Manual Value="0" />
      <MidiControllerRange><Min Value="-12" /><Max Value="12" /></MidiControllerRange>
      ${EQ8_AUTO}
      ${EQ8_MOD}
    </GlobalGain>
    <Scale>
      <LomId Value="0" />
      <Manual Value="1" />
      <MidiControllerRange><Min Value="-2" /><Max Value="2" /></MidiControllerRange>
      ${EQ8_AUTO}
      ${EQ8_MOD}
    </Scale>
    ${bandsXml}
    <SpectrumAnalyzer>
      <LomId Value="0" />
      <LomIdView Value="0" />
      <IsExpanded Value="false" />
      <BreakoutIsExpanded Value="false" />
      <On>
        <LomId Value="0" />
        <Manual Value="true" />
        ${EQ8_AUTO}
        ${EQ8_MIDI_ONOFF}
      </On>
      <ModulationSourceCount Value="0" />
      <ParametersListWrapper LomId="0" />
      <Pointee Id="0" />
      <LastSelectedTimeableIndex Value="0" />
      <LastSelectedClipEnvelopeIndex Value="0" />
      <LastPresetRef>
        <Value />
      </LastPresetRef>
      <LockedScripts />
      <IsFolded Value="false" />
      <ShouldShowPresetName Value="true" />
      <UserName Value="" />
      <Annotation Value="" />
      <SourceContext>
        <Value />
      </SourceContext>
      <MpePitchBendUsesTuning Value="true" />
      <ViewData Value="{}" />
      <OverwriteProtectionNumber Value="3075" />
      <ScaleYBegin Value="0" />
      <ScaleYRange Value="80" />
      <AutoScaleY Value="false" />
      <ScaleXMode Value="1" />
      <ShowBins Value="false" />
      <ShowMax Value="true" />
      <AnalyzeOn Value="true" />
      <Length Value="2" />
      <Window Value="3" />
      <ChannelMode Value="2" />
      <NumAverages Value="1" />
      <MinRefreshTime Value="60" />
    </SpectrumAnalyzer>
    <Live8ShelfScaleLegacyMode Value="false" />
    <AuditionOnOff Value="false" />
    <AdaptiveQFactor Value="1.12" />
    <AdaptiveQ>
      <LomId Value="0" />
      <Manual Value="true" />
      ${EQ8_AUTO}
      ${EQ8_MIDI_ONOFF}
    </AdaptiveQ>
    <AdaptiveQAffectsShelves Value="false" />
  </Eq8>
</Ableton>
`
}

/**
 * Gzip a string via the browser's CompressionStream. Available in
 * Electron's renderer since Chromium 80.
 */
export async function gzipString(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(new TextEncoder().encode(text))
  writer.close()
  const reader = cs.readable.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

export async function buildAbletonAdg(bands: EQBand[], amount: number = 1.0): Promise<Uint8Array> {
  const xml = buildAbletonEqEightXml(bands, amount)
  return await gzipString(xml)
}


// ── FabFilter Pro-Q 3 / 4 preset (JSON bank) ───────────────────────

/**
 * FabFilter Pro-Q 3/4 preset — pragmatic JSON form. Sibling to the
 * binary `buildProQ3Ffp` writer below; this exists for tooling chains
 * that want a structured doc, not a file Pro-Q double-clicks.
 *
 * For the one-click "load straight in Pro-Q" path use `buildProQ3Ffp`
 * (binary `.ffp`) or EQExportButton.exportFFP (plain-text "paste into
 * Pro-Q's Paste bar").
 *
 * Schema "rtm.fabfilter-proq.v1" — 16 band slots, unused are
 * `enabled:false` with freq=1000/gain=0/q=1.0/shape="bell".
 */

type ProQShape = 'bell' | 'low_shelf' | 'high_shelf' | 'low_cut' | 'high_cut' | 'notch'

function proqShape(band: EQBand): ProQShape {
  switch (band.type) {
    case 'lowshelf':  return 'low_shelf'
    case 'highshelf': return 'high_shelf'
    case 'highpass':  return 'low_cut'
    case 'lowpass':   return 'high_cut'
    case 'notch':     return 'notch'
    default:          return 'bell'
  }
}

export function buildFabFilterProQJson(bands: EQBand[], title: string): string {
  const scaled = bands.filter(b => b.enabled).slice(0, 16)
  const MAX_BANDS = 16

  const emitted: Array<{
    index: number
    enabled: boolean
    freq: number
    gain_db: number
    q: number
    shape: ProQShape
    slope: number | null
    channel: 'stereo' | 'mid' | 'side' | 'left' | 'right'
    label: string | null
  }> = []

  for (let i = 0; i < MAX_BANDS; i++) {
    const b = scaled[i]
    if (b) {
      emitted.push({
        index: i + 1,
        enabled: true,
        freq: +Math.max(10, Math.min(30000, b.freq)).toFixed(3),
        gain_db: +b.gain_db.toFixed(3),
        q: +Math.max(0.1, Math.min(40, b.q)).toFixed(3),
        shape: proqShape(b),
        slope: null,
        channel: 'stereo',
        label: b.label ?? null,
      })
    } else {
      emitted.push({
        index: i + 1,
        enabled: false,
        freq: 1000,
        gain_db: 0,
        q: 1.0,
        shape: 'bell',
        slope: null,
        channel: 'stereo',
        label: null,
      })
    }
  }

  const safeTitle = String(title || 'RTM Master Assistant')

  const preamble = [
    '// RTMcompare preset bank for FabFilter Pro-Q 3/4.',
    '// This is NOT the binary .ffp format. Pro-Q does not import this',
    "// JSON directly; use the .ffp binary export instead, or paste the",
    "// text export into Pro-Q's Paste bar.",
    '// Schema: rtm.fabfilter-proq.v1 -- see src/eqExporters.ts.',
  ].join('\n')

  const payload = {
    format: 'rtm.fabfilter-proq.v1',
    target: 'FabFilter Pro-Q 3/4',
    title: safeTitle,
    generated_by: 'RTMcompare Master Assistant',
    notes: 'JSON bank. Not a binary .ffp. See header comment.',
    output_gain_db: 0.0,
    bands: emitted,
  }

  return preamble + '\n' + JSON.stringify(payload, null, 2) + '\n'
}


// ── FabFilter Pro-Q 3 binary preset (.ffp) ─────────────────────────
//
// The REAL native .ffp Pro-Q 3 / Pro-Q 4 will load directly. Reverse-
// engineered from MIT-licensed reference encoders (raoulsh/preset-toolkit)
// and FabFilter forum confirmations (Jan 2025). Pro-Q 4 reads the Pro-Q 3
// binary format unchanged, so a single writer covers both.
//
// Layout (little-endian):
//   0x0000  char[4]   magic         "FQ3p"
//   0x0004  int32     version       4
//   0x0008  int32     float_count   334
//   0x000c  float32[24][13]         24 band slots × 13 floats each
//   0x04ec  float32[22]             global params trailer
//
// Per-band 13-float record:
//   [0]  used (1=active slot)
//   [1]  enabled (1=on)
//   [2]  log2(freq_hz)
//   [3]  gain_db (raw dB)
//   [4]  dynamic_range  (0 for static)
//   [5]  dynamics_enabled (1 default)
//   [6]  dynamic_threshold (1 default)
//   [7]  log2(q) / 10.643856189774725 + 0.5  ← Pro-Q's Q encoding
//   [8]  shape (0=bell, 1=lowshelf, 2=lowcut/HP, 3=highshelf,
//             4=highcut/LP, 5=notch, 6=bandpass, 7=tilt, 8=flat-tilt)
//   [9]  slope (0=6, 1=12, 2=24, 3=48 dB/oct)
//   [10] stereo (0=L, 1=R, 2=stereo)
//   [11] speakers (1 default)
//   [12] reserved (0)

const PROQ3_FLOAT_COUNT = 334
const PROQ3_BAND_COUNT  = 24
const PROQ3_BAND_FLOATS = 13
const PROQ3_HEADER_BYTES = 12      // magic(4) + version(4) + count(4)
const PROQ3_Q_DIVISOR = 10.643856189774725

function proq3ShapeCode(band: EQBand | undefined): number {
  switch (band?.type) {
    case 'lowshelf':  return 1
    case 'highpass':  return 2
    case 'highshelf': return 3
    case 'lowpass':   return 4
    case 'notch':     return 5
    case 'bandpass':  return 6
    default:          return 0
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Build a Pro-Q 3 binary .ffp that Pro-Q 4 also loads natively (Pro-Q 4
 * is backward-compatible with the v3 binary). Produces a 1348-byte file:
 * 12-byte header + 24×13 band floats + 22 global trailer floats.
 */
export function buildProQ3Ffp(bands: EQBand[]): Uint8Array {
  const totalBytes = PROQ3_HEADER_BYTES + PROQ3_FLOAT_COUNT * 4
  const out = new Uint8Array(totalBytes)
  const view = new DataView(out.buffer)

  out[0] = 0x46  // 'F'
  out[1] = 0x51  // 'Q'
  out[2] = 0x33  // '3'
  out[3] = 0x70  // 'p'
  view.setInt32(4, 4, true)
  view.setInt32(8, PROQ3_FLOAT_COUNT, true)

  const f32At = (floatIndex: number, value: number) => {
    view.setFloat32(PROQ3_HEADER_BYTES + floatIndex * 4, value, true)
  }

  const usable = bands.slice(0, PROQ3_BAND_COUNT)
  for (let i = 0; i < PROQ3_BAND_COUNT; i++) {
    const b = usable[i]
    const base = i * PROQ3_BAND_FLOATS
    if (!b) {
      f32At(base + 0,  0)
      f32At(base + 1,  0)
      f32At(base + 2,  Math.log2(1000))
      f32At(base + 3,  0)
      f32At(base + 4,  0)
      f32At(base + 5,  1)
      f32At(base + 6,  1)
      f32At(base + 7,  0.5)
      f32At(base + 8,  0)
      f32At(base + 9,  2)
      f32At(base + 10, 2)
      f32At(base + 11, 1)
      f32At(base + 12, 0)
      continue
    }
    const freq = clamp(b.freq, 10, 30000)
    const gain = clamp(b.gain_db, -30, 30)
    const q    = clamp(b.q,    0.025, 40)
    f32At(base + 0,  1)
    f32At(base + 1,  b.enabled ? 1 : 0)
    f32At(base + 2,  Math.log2(freq))
    f32At(base + 3,  gain)
    f32At(base + 4,  0)
    f32At(base + 5,  1)
    f32At(base + 6,  1)
    f32At(base + 7,  Math.log2(q) / PROQ3_Q_DIVISOR + 0.5)
    f32At(base + 8,  proq3ShapeCode(b))
    f32At(base + 9,  2)
    f32At(base + 10, 2)
    f32At(base + 11, 1)
    f32At(base + 12, 0)
  }

  const globals = [
    0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1,
    -1, 1, 2, 2, 3, 0, 1, 1, 2, 0, 0,
  ]
  globals.forEach((v, j) => {
    f32At(PROQ3_BAND_COUNT * PROQ3_BAND_FLOATS + j, v)
  })

  return out
}
