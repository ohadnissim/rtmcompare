#!/usr/bin/env python3
"""
student_report.py — RTMcompare Learn Mode Student Report Generator.
Reads a StudentReportPayload JSON from stdin, produces a complete HTML
document to stdout. Electron's renderPdf IPC handler prints it to PDF.

Usage: echo '<json>' | python3 student_report.py
"""

import json
import sys
from datetime import datetime


# ─── Helpers ──────────────────────────────────────────────────────────────────

def esc(s):
    """Minimal HTML-escape for text content."""
    if s is None:
        return ''
    return (str(s)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;'))


def fmt_num(v, decimals=1, unit=''):
    """Format a numeric value gracefully, returning '—' on None/error."""
    if v is None:
        return '—'
    try:
        return f'{float(v):.{decimals}f}{unit}'
    except (TypeError, ValueError):
        return '—'


def get_actual(metric, result):
    """
    Pull the actual measured value for a rubric metric from the
    analysisResult object.  All accesses use .get() so missing keys
    never raise.
    """
    overall = result.get('overall', {}) if result else {}
    if metric == 'lufs_i':
        return overall.get('lufs_b') or overall.get('lufs_a')
    if metric == 'lra':
        # BUG-17 fix: analysis result stores lra_b at top-level, not in overall sub-object
        return (result.get('lra_b') or result.get('lra_a') or
                overall.get('lra_b') or overall.get('lra') or overall.get('dynamics_b'))
    if metric == 'true_peak_dbtp':
        # Try headroom first, then true_peaks array, then overall
        headroom = overall.get('headroom_b') or overall.get('headroom')
        if headroom is not None:
            return headroom
        true_peaks = result.get('true_peaks', {})
        if isinstance(true_peaks, dict):
            return true_peaks.get('b') or true_peaks.get('a')
        return overall.get('true_peak_b') or overall.get('true_peak')
    if metric in ('mono_compat', 'mono_compat_pct'):
        # BUG-04 fix: rubric uses 'mono_compat_pct' key; also accept 'mono_compat'
        mono = result.get('mono_compat', {}) if result else {}
        return (result.get('mono_compat_pct') or result.get('mono_compat_b') or
                mono.get('mono_loss_b_pct') or mono.get('mono_loss_pct'))
    if metric == 'stereo_width':
        return overall.get('width_b') or overall.get('width')

    if metric == 'plr':
        # PLR = true_peak_dbtp - lufs_i (approximate)
        lufs = overall.get('lufs_b') or overall.get('lufs_a')
        tp = overall.get('headroom_b') or overall.get('headroom_a') or overall.get('true_peak_b') or overall.get('true_peak')
        if lufs is not None and tp is not None:
            try:
                return float(tp) - float(lufs)
            except (TypeError, ValueError):
                return None
        return None

    if metric == 'tonal_deviation':
        tonal = result.get('tonal', {}) if result else {}
        return tonal.get('deviation_b') or tonal.get('rms_deviation_b') or tonal.get('deviation')

    if metric == 'distortion':
        distortion = result.get('distortion', {}) if result else {}
        # Try distortion_severity as a 0-1 float or as named levels
        val = distortion.get('severity_b') or distortion.get('severity') or distortion.get('distortion_severity_b')
        if val is not None:
            return val
        # Fall back to a boolean-style field
        has_clipping = distortion.get('has_clipping_b') or distortion.get('has_clipping')
        if has_clipping is True:
            return 1.0
        if has_clipping is False:
            return 0.0
        return None

    if metric == 'masking_overlap':
        masking = result.get('masking', {}) if result else {}
        return masking.get('overlap_pct') or masking.get('masking_pct') or masking.get('masking_overlap_b')

    if metric == 'click_count':
        clicks = result.get('clicks', {}) if result else {}
        count = clicks.get('count_b') or clicks.get('click_count_b') or clicks.get('count')
        if count is not None:
            return count
        # Some payloads have click_events as an array
        events = clicks.get('click_events') or clicks.get('events') or []
        if isinstance(events, list):
            return len(events)
        return None

    return None


def score_criterion(actual, target, tolerance, max_points):
    """
    Score a single rubric criterion:
      - within tolerance → full points
      - within 2× tolerance → 50 % points
      - otherwise → 0
    Returns (score, delta_str).
    """
    if actual is None or target is None:
        return (None, '—')
    try:
        delta = float(actual) - float(target)
        abs_delta = abs(delta)
        delta_str = f'{delta:+.1f}'
        tol = abs(float(tolerance))
        if abs_delta <= tol:
            return (max_points, delta_str)
        elif abs_delta <= 2 * tol:
            return (max_points * 0.5, delta_str)
        else:
            return (0, delta_str)
    except (TypeError, ValueError):
        return (None, '—')


METRIC_LABELS = {
    'lufs_i':           'Integrated Loudness',
    'lra':              'Loudness Range (LRA)',
    'true_peak_dbtp':   'True Peak',
    'mono_compat':      'Mono Compatibility',
    'stereo_width':     'Stereo Width',
    'plr':              'Peak-to-Loudness Ratio',
    'tonal_deviation':  'Tonal Balance Deviation',
    'distortion':       'Distortion / Clipping',
    'masking_overlap':  'Frequency Masking',
    'click_count':      'Click / Artifact Count',
}

METRIC_UNITS = {
    'lufs_i':           ' LUFS',
    'lra':              ' LU',
    'true_peak_dbtp':   ' dBTP',
    'mono_compat':      '%',
    'stereo_width':     '',
    'plr':              ' LU',
    'tonal_deviation':  ' dB',
    'distortion':       '',      # unitless severity
    'masking_overlap':  '%',
    'click_count':      '',      # count
}


GENRE_LRA_TARGETS = {
    'Pop':                    (4, 7),
    'EDM / Electronic':       (4, 6),
    'Metal':                  (4, 7),
    'Rock':                   (8, 12),
    'Hip-Hop / R&B':          (6, 9),
    'Country':                (8, 12),
    'Jazz':                   (10, 14),
    'Classical / Orchestral': (14, 20),
    'Folk / Acoustic':        (10, 16),
    'Podcast / Spoken Word':  (6, 12),
}

GENRE_LUFS_TARGETS = {
    'Pop':                    -14,
    'EDM / Electronic':       -9,
    'Rock':                   -12,
    'Metal':                  -10,
    'Hip-Hop / R&B':          -12,
    'Country':                -13,
    'Jazz':                   -18,
    'Classical / Orchestral': -23,
    'Folk / Acoustic':        -16,
    'Podcast / Spoken Word':  -16,
    'Other':                  -14,
}


# ─── Main report builder ──────────────────────────────────────────────────────

def build_html(payload):
    assignment   = payload.get('assignment') or {}
    annotations  = payload.get('annotations') or []
    result       = payload.get('analysisResult') or {}
    file_a       = esc(payload.get('fileAName') or 'File A')
    file_b       = esc(payload.get('fileBName') or 'File B')
    exported_at  = payload.get('exportedAt') or datetime.utcnow().isoformat()

    # ── Assignment meta ──────────────────────────────────────────────
    title        = esc(assignment.get('title') or 'Untitled Assignment')
    instructor   = esc(assignment.get('instructor') or '—')
    course       = esc(assignment.get('course') or '—')
    student_name = esc(assignment.get('studentName') or '—')
    student_id   = esc(assignment.get('studentId') or '')
    due_date     = esc(assignment.get('dueDate') or '—')
    rubric       = assignment.get('rubric') or []
    genre        = assignment.get('genre') or ''

    try:
        date_str = datetime.fromisoformat(exported_at.replace('Z', '+00:00')).strftime('%B %d, %Y  %H:%M UTC')
    except Exception:
        date_str = esc(exported_at)

    # ── Overall metrics ──────────────────────────────────────────────
    overall = result.get('overall', {}) or {}
    mono    = result.get('mono_compat', {}) or {}
    recs    = result.get('recommendations') or []

    metrics = {
        'lufs_i':        {'a': overall.get('lufs_a'),    'b': overall.get('lufs_b'),    'unit': ' LUFS'},
        'lra':           {'a': overall.get('dynamics_a'), 'b': overall.get('dynamics_b'), 'unit': ' LU'},
        'true_peak':     {'a': overall.get('headroom_a'), 'b': overall.get('headroom_b'), 'unit': ' dBTP'},
        'mono_compat':   {'a': mono.get('mono_loss_a_pct'), 'b': mono.get('mono_loss_b_pct'), 'unit': '%'},
        'stereo_width':  {'a': overall.get('width_a'),   'b': overall.get('width_b'),   'unit': ''},
    }
    metric_display_names = {
        'lufs_i':       'LUFS-I',
        'lra':          'LRA',
        'true_peak':    'True Peak',
        'mono_compat':  'Mono Compat Loss',
        'stereo_width': 'Stereo Width',
    }

    # ── Rubric scorecard ─────────────────────────────────────────────
    rubric_rows_html = ''
    total_earned = 0.0
    total_possible = 0.0
    rubric_has_data = bool(rubric)

    for criterion in rubric:
        metric   = criterion.get('metric', '')
        label    = esc(criterion.get('label') or METRIC_LABELS.get(metric, metric))
        target   = criterion.get('target')
        tol      = criterion.get('tolerance')
        points   = criterion.get('points') or (criterion.get('weight', 0) * 100)
        unit     = METRIC_UNITS.get(metric, '')

        actual = get_actual(metric, result)
        earned, delta_str = score_criterion(actual, target, tol, points)

        target_str = fmt_num(target, 1, unit)
        actual_str = fmt_num(actual, 1, unit)

        if earned is None:
            score_str = '—'
            score_color = '#888'
        elif earned >= points:
            score_str = f'{earned:.0f} / {points:.0f}'
            score_color = '#6fcf97'
            total_earned += earned
            total_possible += points
        elif earned > 0:
            score_str = f'{earned:.0f} / {points:.0f}'
            score_color = '#f2c94c'
            total_earned += earned
            total_possible += points
        else:
            score_str = f'0 / {points:.0f}'
            score_color = '#eb5757'
            total_possible += points

        rubric_rows_html += f"""
        <tr>
          <td>{label}</td>
          <td style="text-align:center">{target_str}</td>
          <td style="text-align:center">{actual_str}</td>
          <td style="text-align:center">{delta_str}</td>
          <td style="text-align:center; color:{score_color}; font-weight:600">{score_str}</td>
        </tr>"""

    if rubric_has_data:
        pct = (total_earned / total_possible * 100) if total_possible > 0 else 0
        rubric_rows_html += f"""
        <tr style="border-top:2px solid #d0b066; font-weight:700">
          <td colspan="4" style="text-align:right; padding-right:16px">Total</td>
          <td style="text-align:center; color:#d0b066">{total_earned:.0f} / {total_possible:.0f} &nbsp;({pct:.0f}%)</td>
        </tr>"""

    rubric_section = ''
    if rubric_has_data:
        rubric_section = f"""
    <section>
      <h2>Rubric Scorecard</h2>
      <table>
        <thead>
          <tr>
            <th>Criterion</th>
            <th style="text-align:center">Target</th>
            <th style="text-align:center">Actual</th>
            <th style="text-align:center">Delta</th>
            <th style="text-align:center">Score</th>
          </tr>
        </thead>
        <tbody>{rubric_rows_html}
        </tbody>
      </table>
    </section>"""

    # ── Teacher feedback ─────────────────────────────────────────────
    teacher_feedback_raw = payload.get('teacherFeedback', '') or ''
    teacher_feedback_section = ''
    if teacher_feedback_raw.strip():
        teacher_feedback_section = f"""
  <div style="margin-bottom:28px;">
    <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#6b6560;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06);">
      Instructor Feedback
    </div>
    <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(208,176,102,0.2); border-left:3px solid rgba(208,176,102,0.6); border-radius:2px; padding:14px 16px; font-size:12px; line-height:1.8; color:#c8c0b0; white-space:pre-wrap;">{esc(teacher_feedback_raw.strip())}</div>
  </div>"""

    # ── Genre context note ───────────────────────────────────────────
    genre_note_html = ''
    if genre:
        lra_info = ''
        lufs_info = ''
        if genre in GENRE_LRA_TARGETS:
            lra_lo, lra_hi = GENRE_LRA_TARGETS[genre]
            actual_lra = get_actual('lra', result)
            try:
                lra_in_range = actual_lra is not None and lra_lo <= float(actual_lra) <= lra_hi
            except (TypeError, ValueError):
                lra_in_range = False
            lra_verdict = '✓ In range' if lra_in_range else '⚠ Out of range'
            lra_verdict_color = '#6fcf97' if lra_in_range else '#f2c94c'
            lra_info = f'<span>LRA target: {lra_lo}–{lra_hi} LU &nbsp;<span style="color:{lra_verdict_color}">{lra_verdict}</span></span>'

        if genre in GENRE_LUFS_TARGETS:
            lufs_target = GENRE_LUFS_TARGETS[genre]
            actual_lufs = get_actual('lufs_i', result)
            try:
                lufs_ok = actual_lufs is not None and abs(float(actual_lufs) - lufs_target) <= 1.5
            except (TypeError, ValueError):
                lufs_ok = False
            lufs_verdict = '✓ On target' if lufs_ok else '⚠ Off target'
            lufs_verdict_color = '#6fcf97' if lufs_ok else '#f2c94c'
            lufs_info = f'<span>LUFS-I target: {lufs_target} LUFS &nbsp;<span style="color:{lufs_verdict_color}">{lufs_verdict}</span></span>'

        if lra_info or lufs_info:
            genre_note_html = f"""
<div style="background:rgba(208,176,102,0.04); border:1px solid rgba(208,176,102,0.15); border-radius:2px; padding:10px 16px; margin-bottom:20px; font-size:12px;">
  <div style="color:#d0b066; font-weight:600; text-transform:uppercase; font-size:10px; letter-spacing:0.07em; margin-bottom:6px;">Genre Context — {esc(genre)}</div>
  <div style="color:#b0a88a; line-height:2; display:flex; gap:24px; flex-wrap:wrap;">
    {lra_info}
    {lufs_info}
  </div>
</div>"""

    # ── Encode penalty / delivery risk ──────────────────────────────
    true_peak_b = get_actual('true_peak_dbtp', result)
    encode_risk = ''
    if true_peak_b is not None:
        try:
            tp_val = float(true_peak_b)
            if tp_val > -1.0:
                risk_level = 'HIGH'
                risk_color = '#eb5757'
                risk_msg = f'True Peak is {tp_val:+.1f} dBTP — above the −1.0 dBTP delivery ceiling. AAC encoding may cause audible clipping. Lower the limiter ceiling immediately.'
            elif tp_val > -1.5:
                risk_level = 'MODERATE'
                risk_color = '#f2c94c'
                risk_msg = f'True Peak is {tp_val:+.1f} dBTP. AAC encoding (which can raise peaks by up to 3 dB) may push this above 0 dBTP. Consider lowering to −1.5 dBTP or below.'
            else:
                risk_level = 'LOW'
                risk_color = '#6fcf97'
                risk_msg = f'True Peak is {tp_val:+.1f} dBTP — sufficient encode headroom for AAC/MP3 delivery.'
            encode_risk = f"""
<section>
  <h2>Encode / Delivery Risk</h2>
  <table>
    <tbody>
      <tr>
        <td style="width:100px; font-weight:600">True Peak (B)</td>
        <td>{tp_val:+.1f} dBTP</td>
        <td style="color:{risk_color}; font-weight:600">{risk_level} RISK</td>
      </tr>
      <tr>
        <td colspan="3" style="color:#b0a88a; font-size:11px; line-height:1.6">{esc(risk_msg)}</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:11px; color:#888; margin-top:8px; font-style:italic">Note: AAC encoding (iTunes, Spotify, Apple Music) can raise true peaks by up to 3 dB due to inter-sample peak reconstruction.</p>
</section>"""
        except (TypeError, ValueError):
            pass

    # ── Technical QC data ────────────────────────────────────────────
    file_info = result.get('file_info', {}) or result.get('fileInfo', {}) or {}
    sample_rate_b = file_info.get('sample_rate_b') or file_info.get('sampleRate_b') or overall.get('sample_rate_b')
    bit_depth_b   = file_info.get('bit_depth_b')   or file_info.get('bitDepth_b')   or overall.get('bit_depth_b')
    file_format_b = file_info.get('format_b')      or file_info.get('codec_b')      or overall.get('format_b')
    duration_b    = file_info.get('duration_b')    or overall.get('duration_b')

    # Build QC rows
    qc_rows = ''
    def qc_row(label, value, ok=None):
        color = '#6fcf97' if ok is True else ('#eb5757' if ok is False else '#ebe7e0')
        icon = ' ✓' if ok is True else (' ✗' if ok is False else '')
        return f'<tr><td style="width:160px; color:#b0a88a">{esc(label)}</td><td style="color:{color}">{esc(str(value or "—"))}{icon}</td></tr>'

    if sample_rate_b:
        try:
            sr = int(float(sample_rate_b))
            sr_ok = sr in (44100, 48000, 88200, 96000)
            qc_rows += qc_row('Sample Rate', f'{sr:,} Hz', sr_ok)
        except (TypeError, ValueError):
            qc_rows += qc_row('Sample Rate', sample_rate_b)

    if bit_depth_b:
        try:
            bd = int(float(bit_depth_b))
            bd_ok = bd >= 16
            qc_rows += qc_row('Bit Depth', f'{bd}-bit', bd_ok)
        except (TypeError, ValueError):
            qc_rows += qc_row('Bit Depth', bit_depth_b)

    if file_format_b:
        fmt_ok = str(file_format_b).lower() in ('wav', 'aiff', 'aif', 'flac', 'pcm')
        qc_rows += qc_row('Format', file_format_b, fmt_ok)

    if duration_b:
        try:
            dur = float(duration_b)
            mins = int(dur // 60)
            secs = dur % 60
            qc_rows += qc_row('Duration', f'{mins}:{secs:04.1f}')
        except (TypeError, ValueError):
            qc_rows += qc_row('Duration', duration_b)

    noise_floor_b = result.get('noise_floor_b')
    if noise_floor_b is not None:
        try:
            nf_val = float(noise_floor_b)
            nf_display = f'−{abs(nf_val):.1f} dBFS' if nf_val < 0 else f'{nf_val:.1f} dBFS'
            if nf_val <= -75:
                nf_indicator = '<span style="color:#6fcf97">&#10003;</span>'
            elif nf_val <= -60:
                nf_indicator = '<span style="color:#f2c94c">&#9888;</span>'
            else:
                nf_indicator = '<span style="color:#eb5757">&#10007;</span>'
            qc_rows += (
                f'<tr><td style="width:160px; color:#b0a88a">Noise Floor</td>'
                f'<td style="color:#ebe7e0">{nf_display} {nf_indicator}</td></tr>'
            )
        except (TypeError, ValueError):
            qc_rows += qc_row('Noise Floor', noise_floor_b)

    # Dither detection
    bit_depth_val = result.get('bit_depth_b')
    dither_applied = payload.get('ditherApplied')  # bool or None, set by student in reflection
    dither_html = ''
    if bit_depth_val is not None:
        if str(bit_depth_val) in ('16', '16-bit'):
            # 16-bit delivery: dithering matters
            if dither_applied is True:
                dither_icon = '<span style="color:#6fcf97">&#10003;</span>'
                dither_text = '16-bit + dithered'
            elif dither_applied is False:
                dither_icon = '<span style="color:#eb5757">&#10007;</span>'
                dither_text = '16-bit — no dither reported'
            else:
                dither_icon = '<span style="color:#f2c94c">&#8263;</span>'
                dither_text = '16-bit — dither unconfirmed'
            dither_html = f'<tr><td style="width:160px; color:#b0a88a">Dithering</td><td style="color:#ebe7e0">{dither_text} {dither_icon}</td></tr>'
        else:
            # 24-bit or 32-bit: no dither needed
            dither_html = f'<tr><td style="width:160px; color:#b0a88a">Dithering</td><td style="color:#6b6560">Not required ({esc(str(bit_depth_val))}-bit delivery)</td></tr>'
    if dither_html:
        qc_rows += dither_html

    ms_ratio_b = result.get('ms_ratio_b')
    if ms_ratio_b is not None:
        try:
            ms_val = float(ms_ratio_b)
            ms_display = f'{ms_val:.2f}'
            if 0.8 <= ms_val <= 1.4:
                ms_indicator = '<span style="color:#6fcf97">&#10003;</span>'
            elif (0.5 <= ms_val < 0.8) or (1.4 < ms_val <= 1.8):
                ms_indicator = '<span style="color:#f2c94c">&#9888;</span>'
            else:
                ms_indicator = '<span style="color:#eb5757">&#10007;</span>'
            qc_rows += (
                f'<tr><td style="width:160px; color:#b0a88a">Center Fill (M/S)</td>'
                f'<td style="color:#ebe7e0">{ms_display} {ms_indicator}</td></tr>'
            )
        except (TypeError, ValueError):
            qc_rows += qc_row('Center Fill (M/S)', ms_ratio_b)

    tech_qc_section = ''
    if qc_rows:
        tech_qc_section = f"""
<section>
  <h2>Technical QC</h2>
  <table>
    <tbody>{qc_rows}
    </tbody>
  </table>
</section>"""

    # ── Mastering chain documentation ────────────────────────────────
    mastering_chain = payload.get('masteringChain') or payload.get('processingNotes') or ''
    mastering_chain_section = ''
    if mastering_chain:
        mastering_chain_section = f"""
<section>
  <h2>Mastering Chain Documentation</h2>
  <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:2px; padding:12px 16px; font-size:12px; line-height:1.7; color:#b0a88a; white-space:pre-wrap;">{esc(mastering_chain)}</div>
</section>"""

    # ── Key metrics table ────────────────────────────────────────────
    metrics_rows = ''
    for key, vals in metrics.items():
        unit = vals['unit']
        a_val = fmt_num(vals['a'], 1, unit)
        b_val = fmt_num(vals['b'], 1, unit)
        name  = metric_display_names.get(key, key)
        metrics_rows += f"""
        <tr>
          <td>{esc(name)}</td>
          <td style="text-align:center">{a_val}</td>
          <td style="text-align:center">{b_val}</td>
        </tr>"""
        # Insert M/S center-fill row after stereo_width
        if key == 'stereo_width':
            ar = result
            ms_a = ar.get('ms_ratio_a') or ar.get('center_fill_ms_a')
            ms_b = ar.get('ms_ratio_b') or ar.get('center_fill_ms_b')
            if ms_a is not None or ms_b is not None:
                def fmt_ms(v):
                    if v is None:
                        return '&mdash;'
                    try:
                        return f'{float(v):.2f}'
                    except (TypeError, ValueError):
                        return '&mdash;'
                ms_a_str = fmt_ms(ms_a)
                ms_b_str = fmt_ms(ms_b)
                metrics_rows += f"""
        <tr>
          <td>Center Fill (M/S)</td>
          <td style="text-align:center">{ms_a_str}</td>
          <td style="text-align:center">{ms_b_str}</td>
        </tr>"""

    # ── Annotations ──────────────────────────────────────────────────
    ann_rows = ''
    for ann in annotations:
        tab_id   = esc(ann.get('tabId') or '—')
        text     = esc(ann.get('text') or '')
        color    = ann.get('color') or 'gold'
        created  = ann.get('createdAt') or ''
        try:
            ts = datetime.fromisoformat(created.replace('Z', '+00:00')).strftime('%H:%M')
        except Exception:
            ts = esc(created)
        color_css = {
            'gold': '#d0b066',
            'red':  'rgba(220,80,60,0.9)',
            'teal': 'rgba(100,200,180,0.9)',
            'sand': '#b0a88a',
        }.get(color, '#d0b066')
        ann_rows += f"""
        <tr>
          <td style="color:{color_css}; white-space:nowrap">{tab_id}</td>
          <td>{text}</td>
          <td style="white-space:nowrap; color:#888">{ts}</td>
        </tr>"""

    annotations_section = ''
    if ann_rows:
        annotations_section = f"""
    <section>
      <h2>Student Annotations</h2>
      <table>
        <thead>
          <tr><th>Tab</th><th>Note</th><th>Time</th></tr>
        </thead>
        <tbody>{ann_rows}
        </tbody>
      </table>
    </section>"""

    # ── Blind Test section ───────────────────────────────────────────────────
    file_a_name = payload.get('fileAName') or 'File A'
    file_b_name = payload.get('fileBName') or 'File B'
    blind_test = payload.get('blindTest') or {}
    bt_answers = blind_test.get('answers', [])
    blind_test_section = ''
    if bt_answers:
        DIMENSION_LABELS = {
            'loudness':     'Loudness',
            'tonal_low':    'Low-end energy',
            'tonal_bright': 'Brightness',
            'stereo_width': 'Stereo width',
            'dynamics':     'Dynamic feel',
            'translation':  'Translation',
            'overall':      'Overall preference',
        }
        rows_html = ''
        for ans in bt_answers:
            dim = ans.get('dimension', '')
            choice = ans.get('choice', '')  # 'A', 'equal', 'B'
            notes = esc(ans.get('notes', ''))
            label = DIMENSION_LABELS.get(dim, dim)

            if choice == 'A':
                choice_display = '<span style="color:#6fcf97">' + esc(file_a_name[:20]) + '</span>'
            elif choice == 'B':
                choice_display = '<span style="color:#b0a88a">' + esc(file_b_name[:20]) + '</span>'
            elif choice == 'equal':
                choice_display = '<span style="color:#a8a197">Equal / No difference</span>'
            else:
                choice_display = esc(choice)

            notes_html = (
                '<div style="font-size:11px;color:#7a7368;margin-top:3px;">' + notes + '</div>'
                if notes else ''
            )

            rows_html += (
                '<tr>'
                '<td style="padding:6px 10px;color:#a8a197;font-size:12px;width:150px;vertical-align:top;">' + esc(label) + '</td>'
                '<td style="padding:6px 10px;font-size:12px;vertical-align:top;">' + choice_display + notes_html + '</td>'
                '</tr>'
            )

        bt_submitted_raw = blind_test.get('submittedAt', '')
        bt_submitted = bt_submitted_raw[:10] if bt_submitted_raw else ''
        bt_revealed = blind_test.get('revealed', False)
        if bt_revealed:
            revealed_badge = '<span style="color:#6fcf97;font-size:10px;margin-left:8px;">REVEALED</span>'
        else:
            revealed_badge = '<span style="color:#f2c94c;font-size:10px;margin-left:8px;">NOT YET REVEALED</span>'

        submitted_note = ' on ' + bt_submitted if bt_submitted else ''

        # ── Ear training sub-section ──────────────────────────────────
        ear_training = blind_test.get('earTraining') or {}
        et_html = ''
        if ear_training:
            freq_regions = ear_training.get('frequencyRegions', [])
            reverb_type = ear_training.get('reverbType', '')
            mono_pred = ear_training.get('monoPrediction', '')

            FREQ_LABELS = {
                'sub': 'Sub bass (20–80 Hz)', 'bass': 'Bass (80–250 Hz)',
                'low_mids': 'Low mids (250–500 Hz)', 'mids': 'Mids (500–2 kHz)',
                'upper_mids': 'Upper mids (2–4 kHz)', 'presence': 'Presence (4–6 kHz)',
                'air': 'Air (6–20 kHz)'
            }
            REVERB_LABELS = {
                'plate': 'Plate', 'hall': 'Hall', 'room': 'Room',
                'spring': 'Spring', 'none': 'No noticeable reverb'
            }
            MONO_LABELS = {
                'sub_loss': 'Sub / bass energy thins out',
                'mid_fullness': 'Midrange loses body',
                'stereo_collapse': 'Stereo spread collapses to centre',
                'nothing': 'Nothing significant'
            }

            freq_display = ', '.join(FREQ_LABELS.get(f, f) for f in freq_regions) if freq_regions else '—'
            reverb_display = REVERB_LABELS.get(reverb_type, reverb_type) if reverb_type else '—'
            mono_display = MONO_LABELS.get(mono_pred, mono_pred) if mono_pred else '—'

            et_html = (
                '<div style="margin-top:14px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.05);">'
                '<div style="font-size:10px;color:#6b6560;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">Ear Training Answers</div>'
                '<table style="width:100%;border-collapse:collapse;">'
                '<tr><td style="padding:4px 10px;color:#a8a197;font-size:11px;width:180px;">Frequency regions identified</td>'
                '<td style="padding:4px 10px;font-size:11px;color:#c8c0b0;">' + esc(freq_display) + '</td></tr>'
                '<tr><td style="padding:4px 10px;color:#a8a197;font-size:11px;">Reverb type heard</td>'
                '<td style="padding:4px 10px;font-size:11px;color:#c8c0b0;">' + esc(reverb_display) + '</td></tr>'
                '<tr><td style="padding:4px 10px;color:#a8a197;font-size:11px;">Mono prediction</td>'
                '<td style="padding:4px 10px;font-size:11px;color:#c8c0b0;">' + esc(mono_display) + '</td></tr>'
                '</table>'
                '</div>'
            )

        blind_test_section = (
            '<div style="margin-bottom:28px;">'
            '<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#6b6560;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06);">'
            'Blind Test Predictions' + revealed_badge +
            '</div>'
            '<div style="font-size:11px;color:#7a7368;margin-bottom:10px;">Student submitted listening predictions before viewing measurements' + submitted_note + '.</div>'
            '<table style="width:100%;border-collapse:collapse;">'
            + rows_html +
            '</table>'
            + et_html +
            '</div>'
        )

    # ── Step Answers section (per-step notes from StudentWorkspace) ──
    step_answers = payload.get('stepAnswers') or {}
    step_answers_section = ''
    if step_answers and any(v.strip() for v in step_answers.values() if isinstance(v, str)):
        STEP_LABELS = {
            'listening':  'Step 1 — Methodology',
            'metering':   'Step 2 — Loudness',
            'breakdown':  'Step 3 — Mix Breakdown',
            'stereo':     'Step 4 — Stereo & Phase',
            'tonal':      'Step 5 — Tonal Balance',
            'dynamics':   'Step 6 — Dynamics',
            'quality':    'Step 7 — Artifact Check',
            'delivery':   'Step 8 — Delivery',
            'reflection': 'Step 9 — Reflection',
        }
        STEP_ORDER = ['listening', 'metering', 'breakdown', 'stereo', 'tonal',
                      'dynamics', 'quality', 'delivery', 'reflection']
        answer_rows = ''
        for step_id in STEP_ORDER:
            txt = step_answers.get(step_id, '').strip() if isinstance(step_answers.get(step_id), str) else ''
            if not txt:
                continue
            label = STEP_LABELS.get(step_id, step_id)
            # Preserve line breaks in student notes — convert \n to <br>
            txt_html = esc(txt).replace('\n', '<br>')
            answer_rows += (
                '<tr>'
                '<td style="padding:8px 10px;color:#a8a197;font-size:11px;width:170px;vertical-align:top;letter-spacing:0.04em;">' + esc(label) + '</td>'
                '<td style="padding:8px 10px;font-size:12px;color:#c8c0b0;vertical-align:top;line-height:1.55;">' + txt_html + '</td>'
                '</tr>'
            )
        if answer_rows:
            step_answers_section = (
                '<div style="margin-bottom:28px;">'
                '<div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#6b6560;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06);">'
                "Student's Step-by-Step Notes"
                '</div>'
                '<div style="font-size:11px;color:#7a7368;margin-bottom:10px;">Per-step observations the student typed in the Learn Mode workspace as they worked through the guided flow.</div>'
                '<table style="width:100%;border-collapse:collapse;">'
                + answer_rows +
                '</table>'
                '</div>'
            )

    # ── Recommendations (top 3) ──────────────────────────────────────
    # Sort by priority field descending; fall back to order.
    # Guard: recs may contain non-dict items (strings, etc.) — skip them
    # to prevent AttributeError on .get().
    dict_recs = [r for r in recs if isinstance(r, dict)]
    sorted_recs = sorted(dict_recs, key=lambda r: -(r.get('priority') or r.get('score') or 0))[:3]
    rec_rows = ''
    for rec in sorted_recs:
        text = esc(rec.get('text') or rec.get('message') or rec.get('description') or str(rec))
        rec_rows += f'<li>{text}</li>'

    recs_section = ''
    if rec_rows:
        recs_section = f"""
    <section>
      <h2>Top Recommendations</h2>
      <ul style="padding-left:20px; line-height:1.8">{rec_rows}</ul>
    </section>"""

    # ── Assemble HTML ────────────────────────────────────────────────
    # student_id is already esc()-processed above; build raw string from
    # the un-escaped original so we don't double-escape special chars.
    _raw_student_id = assignment.get('studentId') or ''
    student_id_str = f' ({esc(_raw_student_id)})' if _raw_student_id else ''
    genre_cell = f'<div class="meta-item"><label>Genre</label>{esc(genre)}</div>' if genre else ''

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Student Analysis Report — {title}</title>
<style>
  @page {{ size: A4; margin: 16mm 18mm; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    background: #0e0d0b;
    color: #ebe7e0;
    font-size: 13px;
    line-height: 1.5;
    padding: 24px;
  }}
  header {{
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #d0b066;
    padding-bottom: 14px;
    margin-bottom: 22px;
  }}
  .wordmark {{
    font-size: 22px;
    font-weight: 700;
    color: #d0b066;
    letter-spacing: 0.05em;
  }}
  .report-title {{
    font-size: 11px;
    color: #b0a88a;
    margin-top: 2px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }}
  .assignment-title {{
    font-size: 16px;
    font-weight: 600;
    color: #ebe7e0;
    text-align: right;
  }}
  .meta-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 24px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(208,176,102,0.15);
    border-radius: 2px;
    padding: 14px 18px;
    margin-bottom: 24px;
    font-size: 12px;
  }}
  .meta-item label {{
    color: #b0a88a;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    display: block;
    margin-bottom: 1px;
  }}
  section {{
    margin-bottom: 28px;
  }}
  h2 {{
    font-size: 13px;
    font-weight: 600;
    color: #d0b066;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 10px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(208,176,102,0.2);
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }}
  th {{
    background: rgba(208,176,102,0.08);
    color: #d0b066;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.07em;
    padding: 7px 10px;
    text-align: left;
    border-bottom: 1px solid rgba(208,176,102,0.3);
  }}
  td {{
    padding: 7px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    color: #ebe7e0;
    vertical-align: top;
  }}
  tr:last-child td {{
    border-bottom: none;
  }}
  footer {{
    margin-top: 36px;
    padding-top: 10px;
    border-top: 1px solid rgba(208,176,102,0.15);
    font-size: 10px;
    color: #666;
    text-align: center;
    letter-spacing: 0.04em;
  }}
</style>
</head>
<body>

<header>
  <div>
    <div class="wordmark">RTMcompare</div>
    <div class="report-title">Student Analysis Report</div>
  </div>
  <div class="assignment-title">{title}</div>
</header>

<div class="meta-grid">
  <div class="meta-item"><label>Student</label>{student_name}{student_id_str}</div>
  <div class="meta-item"><label>Course</label>{course}</div>
  <div class="meta-item"><label>Instructor</label>{instructor}</div>
  <div class="meta-item"><label>Due Date</label>{due_date}</div>
  <div class="meta-item"><label>Reference (File A)</label>{file_a}</div>
  <div class="meta-item"><label>Mix (File B)</label>{file_b}</div>
  <div class="meta-item"><label>Exported</label>{esc(date_str)}</div>
  {genre_cell}
</div>

{rubric_section}

{teacher_feedback_section}

{genre_note_html}

<section>
  <h2>Key Metrics Summary</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th style="text-align:center">Reference (A)</th>
        <th style="text-align:center">Mix (B)</th>
      </tr>
    </thead>
    <tbody>{metrics_rows}
    </tbody>
  </table>
</section>

{encode_risk}

{tech_qc_section}

{mastering_chain_section}

{annotations_section}

{blind_test_section}

{step_answers_section}

{recs_section}

<footer>
  Generated with RTMcompare v5.7.2 &middot; Learn Mode &middot; {esc(date_str)}
  <div style="font-size:9px;color:#4a4540;margin-top:6px;">Grade CSV export is compatible with Canvas LMS import format (Student Name / Student ID / Score columns).</div>
</footer>

</body>
</html>"""

    return html


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        sys.stderr.write(f'student_report: JSON parse error: {exc}\n')
        payload = {}

    try:
        html = build_html(payload)
        sys.stdout.write(html)
    except Exception as exc:
        sys.stderr.write(f'student_report: render error: {exc}\n')
        sys.exit(1)
