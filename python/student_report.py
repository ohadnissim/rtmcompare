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
        return overall.get('dynamics_b') or overall.get('lra_b') or overall.get('lra')
    if metric == 'true_peak_dbtp':
        # Try headroom first, then true_peaks array, then overall
        headroom = overall.get('headroom_b') or overall.get('headroom')
        if headroom is not None:
            return headroom
        true_peaks = result.get('true_peaks', {})
        if isinstance(true_peaks, dict):
            return true_peaks.get('b') or true_peaks.get('a')
        return overall.get('true_peak_b') or overall.get('true_peak')
    if metric == 'mono_compat':
        mono = result.get('mono_compat', {}) if result else {}
        return mono.get('mono_loss_b_pct') or mono.get('mono_loss_pct')
    if metric == 'stereo_width':
        return overall.get('width_b') or overall.get('width')
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
    'lufs_i': 'Integrated Loudness',
    'lra': 'Loudness Range (LRA)',
    'true_peak_dbtp': 'True Peak',
    'mono_compat': 'Mono Compatibility',
    'stereo_width': 'Stereo Width',
}

METRIC_UNITS = {
    'lufs_i': ' LUFS',
    'lra': ' LU',
    'true_peak_dbtp': ' dBTP',
    'mono_compat': '%',
    'stereo_width': '',
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

    # ── Recommendations (top 3) ──────────────────────────────────────
    # Sort by priority field descending; fall back to order.
    sorted_recs = sorted(recs, key=lambda r: -(r.get('priority') or r.get('score') or 0))[:3]
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
    student_id_str = f' ({student_id})' if student_id else ''

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
  <div class="meta-item"><label>Student</label>{student_name}{esc(student_id_str)}</div>
  <div class="meta-item"><label>Course</label>{course}</div>
  <div class="meta-item"><label>Instructor</label>{instructor}</div>
  <div class="meta-item"><label>Due Date</label>{due_date}</div>
  <div class="meta-item"><label>Reference (File A)</label>{file_a}</div>
  <div class="meta-item"><label>Mix (File B)</label>{file_b}</div>
  <div class="meta-item"><label>Exported</label>{esc(date_str)}</div>
</div>

{rubric_section}

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

{annotations_section}

{recs_section}

<footer>
  Generated with RTMcompare v5.7.2 &middot; Learn Mode &middot; {esc(date_str)}
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
