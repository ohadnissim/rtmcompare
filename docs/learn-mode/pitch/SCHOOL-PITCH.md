# RTMcompare Learn Mode

## Slide 1 — THE PROBLEM

### Students Are Flying Blind

*Your students spend 14 weeks learning to mix. Then they submit a track, you listen for 8 minutes, and write "needs more low-end clarity." There is no standard. No rubric. No way for a student to know what they got right.*

Mixing and mastering education has no tool built for it. Students can't A/B their work against a reference with any rigor. Instructors have no scalable way to grade technical decisions objectively. "Good ear" is taught but never measured — and every instructor grades a little differently, every semester.

The result: students improve slowly, feedback is inconsistent, and the thing that professional engineers actually do — compare, measure, and decide — is never practiced under controlled conditions.

---

## Slide 2 — THE SOLUTION

### A Grading Tool Built for the Mixing Room

*RTMcompare Learn Mode turns every listening session into a structured lesson — with a rubric, a grade, and a student report the instructor didn't have to write.*

Guided curriculum walks students through 9 professional decision-making steps. Objective rubric scoring replaces gut-feel grading. Canvas-ready grade upload sends scores directly to your LMS. Student PDF reports document every technical choice — in a format students actually want to read.

One tool that replaces the spreadsheet, the manual listening marathon, and the "please see me after class" email.

---

## Slide 3 — THE CURRICULUM

### 9 Steps That Teach, Not Just Grade

*Learn Mode isn't a quiz. It's a guided walkthrough of every professional decision in a mix — in the order a real engineer makes them.*

The 9-step curriculum follows the actual decision tree of a working mix engineer: root cause before symptoms, translation before loudness, artifacts before delivery. Each step has curriculum content, pro tips, and a chip that navigates the student directly to the right analysis tab.

1. **Monitoring** — Check your translation chain before you trust your ears
2. **Loudness** — LUFS-I/S/M, gain staging, PLR, streaming compliance
3. **Mix Breakdown** — Element hierarchy, masking, reverb, automation doctrine
4. **Stereo & Phase** — Mono compat, M/S, Haas effect, correlation meter
5. **Tonal Balance** — EQ regions, HPF discipline, full vocal chain analysis
6. **Dynamics** — LRA, sidechain, parallel compression, saturation workflow
7. **Artifact Check** — Clicks, distortion, hum, ground loops
8. **Delivery** — True Peak, AAC penalty, dithering, platform-specific specs
9. **Reflection** — Full mastering chain review, stem workflow, M/S documentation

Each step has a "Navigate to:" chip pointing the student to the right analysis tab in real time. No hunting. No alt-tabbing. Just: read, listen, measure, answer.

---

## Slide 4 — BLIND TEST MODE

### Train the Ears, Not Just the Eyes

*Before a student sees a single number, they make 7 predictions: which file has more low-end, wider stereo, better mono translation. Then the meters reveal. The gap between prediction and measurement IS the lesson.*

The blind test is not a bonus feature — it is the core pedagogical mechanic. Predictions are locked before any measurements are shown. After the reveal, every discrepancy gets a ✓ or ↻ verdict so the student knows exactly where their ears drifted.

**7 comparative dimensions:** Low-End Energy, High-End Presence, Stereo Width, Mono Compatibility, Loudness, Dynamic Range, Translation Quality.

**3 ear training identification questions:** Frequency region identification, reverb type classification, mono compatibility prediction — referenced against the Berklee ear training canon.

Calibration score on completion. Cohort analytics in the grade book. Over a semester, you can see exactly which ear training gap your entire class shares.

---

## Slide 5 — THE RUBRIC

### 14 Metrics. Instant Scores. No Subjectivity.

*LUFS-I within spec: full marks. True peak over -1.0 dBTP: zero. Dithering applied to a 16-bit render: full marks. The rubric says what matters — the tool checks it.*

**14 scoreable metrics:** LUFS-I, LRA, True Peak, Mono Compatibility, Stereo Width, PLR, Tonal Deviation, Distortion, Masking, Clicks, Center Fill (M/S), Noise Floor, Transient Integrity, Dithering Applied.

**3 pre-built templates:** Mixing Fundamentals, Mastering Final Project, Advanced Dynamics — ready to use on day one.

**11 genre presets:** Pop, Rock, Hip-Hop, Electronic, Jazz, Classical, Metal, Country, R&B, Podcast, Film/TV — each with genre-appropriate LRA and LUFS-I targets.

Instructors build a custom rubric in 2 minutes and distribute it as a `.rtm-assignment.json` file. Students double-click the file to load the assignment. No configuration, no setup, no classroom time spent on software.

---

## Slide 6 — THE STUDENT REPORT

### A PDF the Student Actually Learns From

*Not a grade. A document. Rubric scorecard, instructor feedback, genre context, technical QC, blind test predictions vs. reality, mastering chain documentation, top 3 recommendations — all in one printable PDF.*

What's inside:

- **Rubric scorecard** — full/partial/zero per criterion, total score, grade percentage
- **Instructor feedback block** — written inline in the grade book, printed here
- **Genre verdicts** — LRA and LUFS-I checked against genre targets with ✓/⚠ marks
- **Technical QC** — sample rate, bit depth, noise floor, dithering status, center fill M/S
- **Blind test recap** — student predictions vs. actual measurements with ✓/↻ verdicts
- **Mastering chain documentation** — what the student built, step by step
- **Top 3 recommendations** — actionable, specific, prioritized

The student submits one PDF. The instructor scans a folder and has the whole class graded.

---

## Slide 7 — THE GRADE BOOK

### 30 Students. 5 Minutes. Done.

*Scan the submissions folder. Color-coded scores appear — green above 90%, yellow above 50%, red below. Class Insights shows which criterion the whole cohort missed. Teacher feedback types inline and saves automatically.*

The grade book is designed for the end of a submission deadline, not a 3-hour grading session.

- **Folder scan** of `.rtm-report.json` sidecars — one click loads every submission
- **Sortable table** — sort by score, name, submission date, any rubric criterion
- **Class Insights panel** — per-criterion averages across the cohort, with a MOST MISSED badge on the criterion that hurt the most grades
- **Blind test calibration stats** per student — who has calibrated ears, who doesn't yet
- **Inline feedback textarea** — types directly in the table, saves to `.rtm-feedback.json` sidecar
- **Revision detection** — v1/v2 badges and draft/final toggle for iterative submissions
- **CSV export** — compatible with any LMS

---

## Slide 8 — CANVAS INTEGRATION

### Grades in Canvas in One Click

*Configure your Canvas URL and API token once. Pick the assignment. Preview: 28 ready, 2 missing SIS ID. Upload. Done. No spreadsheet. No copy-paste. No manual entry.*

Direct Canvas REST API integration — no third-party relay, no data leaving your institution.

- API token encrypted at rest via macOS Keychain or Windows DPAPI — never stored in plaintext, never visible after entry
- Course and assignment selection pulled directly from Canvas — no manual ID lookup
- Scores map 0–100% to Canvas assignment points automatically
- Students missing a SIS ID are counted and skipped with a clear report
- CSV export as fallback for Blackboard, Moodle, or any other LMS

---

## Slide 9 — PRIVACY & DEPLOYMENT

### Local. Private. No Cloud.

*Your students' unreleased work stays on their machine. Always. There is no server. There is no account. There is no upload.*

RTMcompare is not a SaaS product. It is an installed application that runs entirely on the student's own hardware.

- Fully offline analysis — every measurement, every score, every report is computed locally
- Canvas upload is the only network call — and it goes to your institution's own Canvas instance
- **macOS:** notarized by Apple, drag-to-Applications install, no Gatekeeper warnings
- **Windows:** NSIS installer with silent install support for lab imaging
- Student data lives in `~/Library/Application Support/RTMcompare` — no admin rights needed after install
- FERPA-compliant by architecture: student audio and grade data never touches a third-party server

IT deployment note covers: system requirements, Python resolution order, Canvas token security model, lab imaging instructions, and silent install commands for both platforms.

---

## Slide 10 — DOCUMENTATION

### Ready to Hand to IT on Monday

*Three documents. Student quick-start (one page). Teacher setup guide (two pages). IT deployment note (everything your sysadmin needs).*

**Student Quick-Start (1 page):**
Load files → enable Learn Mode → load `.rtm-assignment.json` → work through 9 steps → complete blind test → export PDF → submit.

**Teacher Setup Guide (2 pages):**
Create assignment → set rubric and genre preset → export `.rtm-assignment.json` → distribute to class → scan submissions folder → write feedback → upload to Canvas.

**IT Deployment Note:**
macOS 12+ / Windows 10+, 4 GB RAM minimum, Python 3.8+ for PDF export (or bundled binary), silent install commands for both platforms, Canvas token security model, FERPA data handling summary (all local + Canvas only).

In-app `?` help button gives students the quick-start guide without leaving the app. No PDF hunting, no Slack message to the instructor at 11pm the night before the deadline.

---

## Slide 11 — WHAT A PILOT LOOKS LIKE

### One Class. One Semester. Zero Risk.

*Pick your Mixing 301 or Mastering Fundamentals section. Load the Mastering Final Project template. Give students the `.rtm-assignment.json` file and the one-page guide. At the end of the semester: every submission graded, Canvas updated, and a cohort insights report telling you exactly which concept your class didn't get.*

**What you need from IT:** install on student machines via silent installer, or let students install on personal laptops — no admin rights required after install.

**What students need:** the app (free download) + their instructor's `.rtm-assignment.json` file.

**What the instructor needs:** 30 minutes to set up the assignment, a Canvas API token from your Canvas admin, and a submissions folder.

**What comes out:** objective rubric grades for every student, blind test calibration data, cohort analytics showing class-wide gaps, and Canvas grade upload in one click.

---

## Slide 12 — FEATURES AT A GLANCE

### Everything in the Box

**Learn Mode Curriculum**
- 9 guided steps covering the full Mixing & Mastering workflow
- Each step has curriculum content, proTips, and a "Navigate to" tab chip
- Step order: Mix Breakdown before Tonal/Dynamics (root-cause first)
- Mastering chain documentation step with M/S, parallel, and stem workflow

**Blind Test & Ear Training**
- 7 comparative predictions locked before meters reveal
- 3 ear training questions: frequency regions, reverb type, mono prediction
- ✓/↻ verdict comparison: your ears vs. the measurements
- Calibration score and cohort analytics in the grade book

**Assignment & Rubric System**
- 14 scoreable metrics with per-criterion full/partial/zero scoring
- 3 pre-built templates: Mixing Fundamentals, Mastering Final Project, Advanced Dynamics
- 11 genre presets with LRA + LUFS-I targets
- Export/import `.rtm-assignment.json` for distribution

**Student Report PDF**
- Rubric scorecard + instructor feedback block
- Genre context with ✓/⚠ verdicts
- Technical QC (sample rate, bit depth, noise floor, dithering, center fill M/S)
- Blind test predictions vs. measurements
- Mastering chain documentation block
- Top 3 actionable recommendations

**Teacher Grade Book**
- Folder scan of `.rtm-report.json` sidecars
- Color-coded scores (green/yellow/red)
- Class Insights: per-criterion averages + MOST MISSED badge
- Blind test calibration stats per student
- Inline feedback textarea → `.rtm-feedback.json` sidecar
- Revision detection: v1/v2 badges, draft/final toggle
- Canvas-compatible CSV export

**Canvas LMS Integration**
- Direct Canvas REST API grade upload
- API token encrypted at rest (macOS Keychain / Windows DPAPI)
- Course + assignment selection from Canvas data
- SIS ID mapping with skipped-student report

**Documentation**
- Student quick-start guide (one page)
- Teacher setup guide (two pages)
- IT deployment note (system requirements, silent install, Canvas security)
- In-app ? help modal with full student quick-start

**Privacy & Deployment**
- Fully offline — no cloud, no account, no telemetry
- macOS (Apple Silicon + Intel universal, notarized) and Windows 10/11
- Silent install on both platforms
- No admin rights required post-installation
- All student data stays on-device except Canvas upload (to your own institution)

---

## Slide 13 — THE ASK

### Let's Run a Pilot

*One section. One semester. We'll be there for every question.*

We're looking for 2–3 partner institutions for a pilot this semester. The bar to get started is low on purpose.

**What we ask of you:** one Mixing & Mastering course, IT clearance to install on student or lab machines, a Canvas API token from your Canvas admin.

**What you get:** full access to the tool at no cost during the pilot, direct support for every question that comes up during the semester, cohort data and analytics at the end, and a co-authored case study if the pilot goes the way we expect it to.

At the end of the semester you will know exactly which mixing and mastering concepts your students struggle with most — measured across every submission, not inferred from a handful of office hours conversations.

That data is yours.

**Get in touch:** [your name] / [email] / rtmcompare.com
