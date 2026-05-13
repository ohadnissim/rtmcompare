import React from 'react'
import { useAudience, useV52Surface } from '../../AudienceContext'
import { LearnHome } from '../v52/LearnHome'
import { TeacherDashboard } from '../v52/TeacherDashboard'

/**
 * LearnCenter — top-level Learn surface mount.
 *
 * v5.2 promotion gate: when `useV52Surface('learn')` is on and the audience
 * is `student` or `teacher`, render the new editorial surfaces (LearnHome /
 * TeacherDashboard). Otherwise fall through to a thin legacy placeholder so
 * existing Learn Mode (StudentWorkspace sidebar, GuidedFlowBar in App.tsx)
 * continues to drive the experience unchanged.
 *
 * StudentWorkspace remains mounted at the App level — this surface is the
 * standalone "Learn Center" route/panel that v5.2 introduces.
 */

export interface LearnCenterProps {
  /** Optional override — useful for Storybook and tests. */
  audienceOverride?: 'pro' | 'producer' | 'student' | 'teacher'
}

export default function LearnCenter({ audienceOverride }: LearnCenterProps = {}) {
  const detected = useAudience()
  const audience = audienceOverride ?? detected
  const useV52Learn = useV52Surface('learn')

  if (useV52Learn) {
    if (audience === 'teacher') {
      return (
        <TeacherDashboard
          courseName="Mastering 301"
          teacherName="—"
          submissions={[]}
          onOpenSubmission={id => console.log('open submission', id)}
          onExportGradebook={() => console.log('export gradebook')}
        />
      )
    }
    if (audience === 'student') {
      return <LearnHome />
    }
  }

  // Legacy render — minimal placeholder. The real legacy Learn experience is
  // driven by StudentWorkspace + GuidedFlowBar at App.tsx scope; LearnCenter
  // is a v5.2 introduction and has no pre-v5.2 implementation to preserve.
  return null
}
