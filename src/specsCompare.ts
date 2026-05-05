import { SPECS, SPECS_VERSION } from './specs'
import type { SpecSnapshot, SpecVersions } from './types'

export const currentSpecsVersion: number = SPECS_VERSION

type CurrentSpec = Omit<SpecSnapshot, 'references'> & { references: readonly string[] }

export interface SpecDelta {
 id: string
 name: string
 changed: string[]
 oldSpec?: SpecSnapshot
 newSpec?: CurrentSpec
}

const CURRENT_SPECS = SPECS as unknown as Record<string, CurrentSpec>

export function diffSpecVersions(stamped?: SpecVersions | null): SpecDelta[] {
 if (!stamped?.specs) return []
 const out: SpecDelta[] = []
 const ids = new Set([...Object.keys(stamped.specs), ...Object.keys(CURRENT_SPECS)])

 for (const id of ids) {
 const oldSpec = stamped.specs[id]
 const newSpec = CURRENT_SPECS[id]
 const name = newSpec?.name || oldSpec?.name || id
 const changed: string[] = []

 if (!oldSpec && newSpec) {
 changed.push('added to current registry')
 } else if (oldSpec && !newSpec) {
 changed.push('removed from current registry')
 } else if (oldSpec && newSpec) {
 if (oldSpec.version !== newSpec.version) changed.push(`version ${oldSpec.version} -> ${newSpec.version}`)
 if (oldSpec.published !== newSpec.published) changed.push(`published ${oldSpec.published} -> ${newSpec.published}`)
 if ((oldSpec.revised || '') !== (newSpec.revised || '')) changed.push(`revised ${oldSpec.revised || 'none'} -> ${newSpec.revised || 'none'}`)
 if (oldSpec.provisional !== newSpec.provisional) changed.push(`provisional ${oldSpec.provisional ? 'yes' : 'no'} -> ${newSpec.provisional ? 'yes' : 'no'}`)

 const targetKeys = new Set([...Object.keys(oldSpec.targets || {}), ...Object.keys(newSpec.targets || {})])
 for (const key of targetKeys) {
 const before = normaliseValue((oldSpec.targets || {})[key])
 const after = normaliseValue((newSpec.targets || {})[key])
 if (before !== after) changed.push(`${key} ${before} -> ${after}`)
 }
 }

 if (changed.length > 0) out.push({ id, name, changed, oldSpec, newSpec })
 }

 return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function specDriftSummary(stamped?: SpecVersions | null): string {
 const deltas = diffSpecVersions(stamped)
 if (deltas.length === 0) return 'Global spec version changed; no per-spec target delta found.'
 return deltas.map(d => `${d.name}: ${d.changed.join('; ')}`).join('\n')
}

function normaliseValue(value: unknown): string {
 if (value == null) return 'missing'
 if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
 if (typeof value === 'string') return value
 if (typeof value === 'boolean') return value ? 'true' : 'false'
 return JSON.stringify(value)
}
