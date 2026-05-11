# RTMcompare Learn Mode — Teacher Setup Guide

## Overview

RTMcompare Learn Mode gives you a structured way to run mix analysis as a graded assignment. Students load a reference track and their own mix, work through 9 guided analysis steps, and export a PDF report. You get a Grade Book that aggregates submissions, highlights class-wide weak spots, and can push grades directly to Canvas via the LMS API.

No special server infrastructure required — everything runs locally on each machine.

---

## Page 1: Creating Assignments & Understanding Submissions

### Creating an Assignment

1. Enable Learn Mode (top bar toggle), then click **"Set Up Assignment"** in the Learn bar.
2. In the Assignment panel, click **"+ New Assignment"**.
3. Fill in:
   - **Assignment name** (e.g., "Week 5 — Loudness & Dynamics")
   - **Genre** — sets genre-aware LRA targets in the dynamics step
   - **Rubric metrics** — choose which dimensions count toward the grade, and set target values/weights. Or click **Templates** to start from a preset (Pop Master, Rock Mix, Podcast, etc.)
4. Click **Export Assignment** to save the `.rtm-assignment.json` file.
5. Distribute that file to students via your LMS, email, shared drive — whatever works for your workflow.

### What Students Submit

When a student clicks "Export Report," the app generates:

- **`StudentName-Report.pdf`** — the human-readable submission with analysis charts, notes, and rubric scores
- **`StudentName-Report.rtm-report.json`** — a machine-readable sidecar file used by the Grade Book for automated scoring

Students should submit both files, or just the folder containing both. The Grade Book scan picks up `.rtm-report.json` files automatically.

---

## Page 2: Grading, Insights & Canvas Integration

### Grading with the Grade Book

1. Click **"Grade Book"** in the Learn bar (teacher role required).
2. Click **"Scan Folder"** and select the folder where students dropped their submissions.
3. The Grade Book displays each student's score color-coded:
   - **Green** — 90% or above
   - **Yellow** — 50–89%
   - **Red** — below 50%
4. The **Class Insights** panel shows per-criterion averages and flags the **MOST MISSED** criterion for the class — useful for deciding what to focus on in the next session.
5. Click any student row to open their full report. Use the **inline feedback textarea** to add written comments — saved automatically to a `.rtm-feedback.json` file alongside the report.

### Canvas Direct Upload

RTMcompare can push grades and feedback straight to Canvas without any CSV juggling.

**Setup (one time per course):**

1. In the Grade Book, open **Canvas Settings**.
2. Enter your Canvas instance URL (e.g., `https://yourschool.instructure.com`).
3. Paste your API token (see IT Deployment guide for how to generate one).
4. Enter your Course ID.
5. Click **"Test Connection"** — you should see a green confirmation.

**Uploading Grades:**

1. Select the assignment from the Canvas assignment dropdown.
2. Preview the grade mapping — RTMcompare matches each submission to a student via their Canvas SIS ID.
3. Click **"Upload Grades"**. Scores and feedback are posted to the Canvas Gradebook.

> **Tip:** Tell students to enter their Canvas SIS ID exactly in the Student ID field when they load the assignment. This is what RTMcompare uses to match submissions to Canvas roster entries. Let them know the format you use (numeric ID, email, NetID, etc.) — it varies by institution.

---

*RTMcompare Learn Mode is built for Mixing & Mastering courses.*
