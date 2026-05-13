/**
 * certificate.ts — print orchestrator for the v5.2 Certificate artifact.
 *
 * Renders the four-variant <Certificate /> component into a detached print
 * root, injects an @media print stylesheet that hides the rest of the app,
 * then calls window.print(). The OS print dialog gives every platform a
 * "Save as PDF" path. Cleans up on afterprint, with a 60s safety net.
 *
 * If an Electron IPC bridge is wired (window.electronAPI.exportCertificate
 * or window.flowAPI.exportCertificate), delegate to the main process so the
 * user gets a real Save-PDF dialog instead of the system print sheet.
 *
 * Pattern lifted verbatim from src/lib/flowSheet.ts — same project, same
 * React 19 + Electron + Vite stack. Keep the two in lockstep when the IPC
 * contract changes.
 */

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  Certificate,
  type CertificateProps,
  type CertificateMetric,
  type CertificateVerdict,
  type CertificateStudent,
} from '../components/v52/Certificate'
import { v52Copy } from '../copy/v52'
import { logCertificate } from './certificateLog'

export type {
  CertificateProps,
  CertificateMetric,
  CertificateVerdict,
  CertificateStudent,
} from '../components/v52/Certificate'

const PRINT_ROOT_ID = 'certificate-print-root'
const PRINT_STYLE_ID = 'cert-print-style'

// ─────────────────────────────────────────────────────────────────────────────
// Electron IPC bridge discovery — runtime only, no compile-time contract.
// ─────────────────────────────────────────────────────────────────────────────
type ExportFn = (html: string) => Promise<void>
function getElectronExport(): ExportFn | null {
  const w = window as unknown as Record<string, any>
  const fromElectron = w.electronAPI?.exportCertificate
  if (typeof fromElectron === 'function') return fromElectron as ExportFn
  const fromFlow = w.flowAPI?.exportCertificate
  if (typeof fromFlow === 'function') return fromFlow as ExportFn
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// ID + content-hash helpers — exposed so the Certificate UI can show them
// pre-print if needed.
// ─────────────────────────────────────────────────────────────────────────────
export function generateCertId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
}

export async function generateContentHash(
  props: Pick<CertificateProps, 'trackTitle' | 'metrics' | 'timestamp'>,
): Promise<string> {
  const encoder = new TextEncoder()
  const payload = JSON.stringify({
    title: props.trackTitle,
    metrics: props.metrics.map((m) => [m.label, m.value]),
    ts: props.timestamp,
  })
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(payload))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}

/**
 * Fills in `certId`, `shaTrunc`, and `timestamp` on a partial props object
 * when the caller has not supplied them. Mutation-free.
 */
export async function prepareCertificateMeta<
  T extends Omit<CertificateProps, 'certId' | 'shaTrunc' | 'timestamp'> &
    Partial<Pick<CertificateProps, 'certId' | 'shaTrunc' | 'timestamp'>>,
>(props: T): Promise<CertificateProps> {
  const timestamp = props.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const certId = props.certId ?? generateCertId()
  const shaTrunc =
    props.shaTrunc ??
    (await generateContentHash({
      trackTitle: props.trackTitle,
      metrics: props.metrics,
      timestamp,
    }))
  return { ...props, certId, shaTrunc, timestamp } as CertificateProps
}

// ─────────────────────────────────────────────────────────────────────────────
// Print orchestration
// ─────────────────────────────────────────────────────────────────────────────
function injectPrintStyle(): HTMLStyleElement {
  const existing = document.getElementById(PRINT_STYLE_ID) as HTMLStyleElement | null
  if (existing) return existing
  const style = document.createElement('style')
  style.id = PRINT_STYLE_ID
  style.textContent = `
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body {
        background: #ebe7e0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
      #${PRINT_ROOT_ID} {
        position: static !important;
        left: 0 !important;
        top: 0 !important;
        width: 210mm !important;
      }
      #${PRINT_ROOT_ID} .certificate-page {
        box-shadow: none !important;
      }
    }
    @media screen {
      #${PRINT_ROOT_ID} {
        position: fixed;
        left: -10000px;
        top: 0;
        z-index: 99999;
        pointer-events: none;
      }
    }
  `
  document.head.appendChild(style)
  return style
}

function cleanup(
  root: Root | null,
  container: HTMLElement | null,
  style: HTMLStyleElement | null,
) {
  try {
    root?.unmount()
  } catch {
    /* noop */
  }
  if (container && container.parentNode) container.parentNode.removeChild(container)
  if (style && style.parentNode) style.parentNode.removeChild(style)
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — log every issuance. Non-throwing.
// ─────────────────────────────────────────────────────────────────────────────
function _logIssuance(props: CertificateProps): void {
  try {
    logCertificate({
      certId: props.certId,
      shaTrunc: props.shaTrunc,
      trackTitle: props.trackTitle,
      audience: props.audience,
      verdict: props.verdict,
      metrics: props.metrics.map(m => ({ label: m.label, value: m.value, unit: m.unit })),
      issuedAt: props.timestamp ?? new Date().toISOString(),
    })
  } catch { /* never block a print path */ }
}

export function printCertificate(props: CertificateProps): Promise<void> {
  return new Promise<void>((resolve) => {
    // ── Electron IPC path ────────────────────────────────────────────────
    const ipc = getElectronExport()
    if (ipc) {
      const offscreen = document.createElement('div')
      offscreen.style.position = 'fixed'
      offscreen.style.left = '-10000px'
      document.body.appendChild(offscreen)
      const root = createRoot(offscreen)
      root.render(React.createElement(Certificate, props))
      setTimeout(() => {
        const html = offscreen.innerHTML
        ipc(html)
          .catch(() => {
            /* swallow — UI surface handles errors */
          })
          .finally(() => {
            _logIssuance(props)
            cleanup(root, offscreen, null)
            resolve()
          })
      }, 50)
      return
    }

    // ── window.print() fallback ─────────────────────────────────────────
    let container: HTMLElement | null = document.createElement('div')
    container.id = PRINT_ROOT_ID
    document.body.appendChild(container)

    const style = injectPrintStyle()
    const root = createRoot(container)
    root.render(React.createElement(Certificate, props))

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      _logIssuance(props)
      window.removeEventListener('afterprint', finish)
      setTimeout(() => {
        cleanup(root, container, style)
        container = null
        resolve()
      }, 200)
    }

    window.addEventListener('afterprint', finish)

    setTimeout(() => {
      try {
        window.print()
      } catch {
        finish()
        return
      }
      // Some Electron versions don't fire afterprint reliably — safety net.
      setTimeout(finish, 60_000)
    }, 80)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Thin variant wrappers — audience-specific defaults + signature composition.
// ─────────────────────────────────────────────────────────────────────────────

interface ProArgs {
  trackTitle: string
  metaLine: string
  verdict: CertificateVerdict
  metrics: CertificateMetric[]
  issues?: string[]
  caption?: string
  engineer?: string
  version?: string
}

export async function printProCertificate(args: ProArgs): Promise<void> {
  const verdictWord = v52Copy.verdict.states.pro[args.verdict]
  const signature = v52Copy.certificate.signature.pro({
    engineer: args.engineer,
    version: args.version,
  })
  const props = await prepareCertificateMeta({
    audience: 'pro' as const,
    trackTitle: args.trackTitle,
    metaLine: args.metaLine,
    verdict: args.verdict,
    verdictWord,
    caption: args.caption,
    metrics: args.metrics,
    issues: args.issues,
    signature,
  })
  return printCertificate(props)
}

interface ProducerArgs {
  trackTitle: string
  metaLine: string
  verdict: CertificateVerdict
  metrics: CertificateMetric[]
  issues?: string[]
  caption?: string
  title?: string
  label?: string
}

export async function printReleaseCard(args: ProducerArgs): Promise<void> {
  const verdictWord = v52Copy.verdict.states.producer[args.verdict]
  const signature = v52Copy.certificate.signature.producer({
    title: args.title ?? args.trackTitle,
    label: args.label,
  })
  const props = await prepareCertificateMeta({
    audience: 'producer' as const,
    trackTitle: args.trackTitle,
    metaLine: args.metaLine,
    verdict: args.verdict,
    verdictWord,
    caption: args.caption,
    metrics: args.metrics,
    issues: args.issues,
    signature,
  })
  return printCertificate(props)
}

interface StudentArgs {
  trackTitle: string
  metaLine: string
  verdict: CertificateVerdict
  metrics: CertificateMetric[]
  issues?: string[]
  caption?: string
  studentName?: string
  assignment?: string
  grade?: string | number
}

export async function printPracticeReport(args: StudentArgs): Promise<void> {
  const verdictWord = v52Copy.verdict.states.student[args.verdict]
  const signature = v52Copy.certificate.signature.student({
    studentName: args.studentName,
    assignment: args.assignment,
    grade: args.grade,
  })
  const props = await prepareCertificateMeta({
    audience: 'student' as const,
    trackTitle: args.trackTitle,
    metaLine: args.metaLine,
    verdict: args.verdict,
    verdictWord,
    caption: args.caption,
    metrics: args.metrics,
    issues: args.issues,
    signature,
  })
  return printCertificate(props)
}

interface TeacherArgs {
  courseTitle: string
  metaLine: string
  students: CertificateStudent[]
  teacherName?: string
  course?: string
  date?: string
}

export async function printGradebookExport(args: TeacherArgs): Promise<void> {
  const signature = v52Copy.certificate.signature.teacher({
    teacherName: args.teacherName,
    course: args.course ?? args.courseTitle,
    date: args.date,
  })
  // Cohort-level verdict surfaces nothing on the cover page, but the type
  // requires `verdict` + `verdictWord` + `metrics` on the root props. Pass
  // sane defaults — the cover page renders course/cohort and ignores them.
  const props = await prepareCertificateMeta({
    audience: 'teacher' as const,
    trackTitle: args.courseTitle,
    courseTitle: args.courseTitle,
    cohortSize: args.students.length,
    metaLine: args.metaLine,
    verdict: 'ok' as const,
    verdictWord: v52Copy.verdict.states.teacher.ok,
    metrics: [],
    students: args.students,
    signature,
  })
  return printCertificate(props)
}
