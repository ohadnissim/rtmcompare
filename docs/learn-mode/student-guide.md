# RTMcompare Learn Mode — Student Quick Start

Welcome to Learn Mode! This is your guided companion for analyzing a professional reference track against your own mix. You'll work through 9 focused steps — loudness, dynamics, stereo width, and more — and finish with a PDF report you can actually hand in. No prior mastering knowledge required. Let's go.

---

## Step 1 — Load Your Files

Drag your **reference track** onto the **left drop zone** (that's File A). Drag **your mix** onto the **right drop zone** (File B). The app will analyze both automatically.

## Step 2 — Enable Learn Mode

Find the **"Learn Mode" toggle** in the top bar and click it. The step bar will appear just below the top controls — that's your guide for the whole session.

## Step 3 — Load Your Assignment (if applicable)

If your instructor gave you an `.rtm-assignment.json` file, click **"Load Assignment"** in the Learn bar and select that file. This loads the rubric and grading criteria your instructor set up.

## Step 4 — Enter Your Student ID

In the **left sidebar** (the student info panel), enter your **Student ID** in exactly the format your instructor specifies (it matches your Canvas SIS ID — ask your instructor if you're not sure which format to use).

## Step 5 — Work Through the 9 Guided Steps

The step bar walks you through everything — loudness, dynamics, low-end, brightness, stereo width, and more. Each step has a question and tells you what to look for. Take your time, read the explanations, and take notes using the annotation tool.

## Step 6 — Try Blind Test Mode

Click **"🎧 Blind Test"** in the Learn bar. Before any meters are revealed, pick which file wins on each dimension — loudness, low-end, brightness, stereo width, dynamics, translation, and overall. Lock in your predictions, then reveal to see how your ears stack up against the measurements. This is ear training in action.

## Step 7 — Export Your Report

When you've worked through the steps, click **"Export Report"**. The app generates a PDF with your analysis, notes, and (if you loaded an assignment) your rubric scores.

## Step 8 — Submit

Hand in **two files** to your instructor — they live together in `~/Documents/RTMcompare/student-reports/`:

1. **The PDF** — your readable report with scores, notes, and charts.
2. **The `.rtm-report.json` sidecar** — the machine-readable data file that lets your instructor's Grade Book automatically import your scores. Without it, your instructor has to enter your scores manually.

Submit both via whatever method your instructor specifies (email, shared folder, LMS upload). If you only have the PDF and can't find the JSON file, re-run Export Report — both files are generated at the same time.

---

## Troubleshooting

**"Python not found" error when exporting**
Reinstall the app (it includes a bundled Python), or run this in Terminal and try again:
```
pip install reportlab pillow
```

**Export Report button is greyed out**
Complete at least Step 1 (load your files and run analysis) before exporting.

**PDF shows no scores**
Ask your instructor to share the assignment file (`.rtm-assignment.json`) — the rubric has to be loaded for scores to appear.

---

*RTMcompare Learn Mode is built for Mixing & Mastering courses.*
