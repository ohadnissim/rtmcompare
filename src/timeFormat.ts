/**
 * Shared time-formatting helpers used by the player and every timeline
 * chart in the app. Beta testers asked for "exact time, not rounded
 * seconds" so they can pinpoint where an issue happens — these helpers
 * give every component the same vocabulary.
 *
 *   formatPreciseTime(94.273, 'second') -> "1:34"
 *   formatPreciseTime(94.273, 'tenth')  -> "1:34.3"
 *   formatPreciseTime(94.273, 'milli')  -> "1:34.273"
 *
 * Always renders M:SS for clock readability — no leading-zero on the
 * minutes column. Hours fold in only past 60 min ("65:01" stays as
 * "65:01"; we don't switch to H:MM:SS unless the track is over an
 * hour, which is rare in mastering work).
 */

export type TimePrecision = 'second' | 'tenth' | 'milli'

export function formatPreciseTime(seconds: number, precision: TimePrecision = 'second'): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.max(0, seconds)
  const mins = Math.floor(total / 60)
  const secsRaw = total - mins * 60
  let secStr: string
  if (precision === 'milli') {
    secStr = secsRaw.toFixed(3).padStart(6, '0')   // "01.234"
  } else if (precision === 'tenth') {
    secStr = secsRaw.toFixed(1).padStart(4, '0')   // "01.2"
  } else {
    secStr = Math.floor(secsRaw).toString().padStart(2, '0')
  }
  return `${mins}:${secStr}`
}

/**
 * Pick a sensible default precision for a given duration. Short clips
 * (Translation Check renders, click windows) read better with tenths;
 * a 4-minute album track reads cleanly at second-precision; loop
 * boundaries always want millisecond precision because that's where
 * an off-by-50ms matters.
 */
export function defaultPrecisionFor(durationSeconds: number): TimePrecision {
  if (durationSeconds < 60) return 'tenth'
  return 'second'
}

/**
 * Format a span as "0:34.0 — 1:12.5". Always uses tenth precision
 * because span boundaries are typically dragged or scrubbed and a
 * tenth-second is the right reading granularity.
 */
export function formatTimeSpan(startSec: number, endSec: number, precision: TimePrecision = 'tenth'): string {
  return `${formatPreciseTime(startSec, precision)} — ${formatPreciseTime(endSec, precision)}`
}
