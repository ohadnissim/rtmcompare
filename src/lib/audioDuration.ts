/**
 * audioDuration.ts — B1, fast audio header duration extractor.
 *
 * Reads just enough of a file to extract the duration without a full
 * audio decode. WAV / AIFF read from the header; other formats use the
 * Python daemon via IPC (which opens the file for analysis anyway).
 *
 * Returns a formatted string like "3:42" or null on failure.
 */

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60)
  const secs = Math.floor(totalSeconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Read a WAV file's duration from its header chunk.
 * WAV header: RIFF(4) + size(4) + WAVE(4) + fmt (8+16) + data chunk size.
 * Duration = dataSize / (sampleRate × numChannels × bitsPerSample/8)
 */
async function wavDuration(buffer: ArrayBuffer): Promise<number | null> {
  try {
    const view = new DataView(buffer)
    if (view.byteLength < 44) return null
    // Check RIFF + WAVE magic
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))
    if (riff !== 'RIFF' || wave !== 'WAVE') return null
    // fmt chunk starts at byte 12. Read audio format fields.
    const numChannels = view.getUint16(22, true)
    const sampleRate = view.getUint32(24, true)
    const bitsPerSample = view.getUint16(34, true)
    const bytesPerSample = bitsPerSample / 8
    // Find the 'data' sub-chunk (may not start at byte 36 if there are extra chunks).
    let offset = 12
    while (offset + 8 <= view.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3),
      )
      const chunkSize = view.getUint32(offset + 4, true)
      if (chunkId === 'data') {
        // Guard against malformed headers with zero channels, bps, or sample rate.
        if (numChannels === 0 || bytesPerSample === 0 || sampleRate === 0) return null
        const numFrames = chunkSize / (numChannels * bytesPerSample)
        return numFrames / sampleRate
      }
      offset += 8 + chunkSize
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract audio duration from a File object.
 *
 * Strategy:
 *   1. For WAV files: parse header (reads only 1 kB).
 *   2. For all other formats: try window.electronAPI.analyzeFiles fallback
 *      (daemon opens the file). If unavailable, use HTMLMediaElement.
 *
 * Returns formatted duration string or null.
 */
export async function getAudioDuration(file: File): Promise<string | null> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

    if (ext === 'wav') {
      const slice = file.slice(0, 1024)
      const buffer = await slice.arrayBuffer()
      const secs = await wavDuration(buffer)
      if (secs != null && secs > 0) return formatDuration(secs)
    }

    // Fallback: HTMLMediaElement — works in browser context; may fail for
    // lossless files in Electron depending on codec support.
    return await new Promise<string | null>(resolve => {
      const url = URL.createObjectURL(file)
      const audio = document.createElement('audio')
      const timeout = setTimeout(() => {
        URL.revokeObjectURL(url)
        resolve(null)
      }, 3000)
      audio.onloadedmetadata = () => {
        clearTimeout(timeout)
        URL.revokeObjectURL(url)
        const dur = audio.duration
        resolve(isFinite(dur) && dur > 0 ? formatDuration(dur) : null)
      }
      audio.onerror = () => {
        clearTimeout(timeout)
        URL.revokeObjectURL(url)
        resolve(null)
      }
      audio.src = url
    })
  } catch {
    return null
  }
}
