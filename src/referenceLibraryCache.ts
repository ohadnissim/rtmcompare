import { useEffect, useState, useCallback } from 'react'
import { ReferenceRecord } from './types'

/**
 * Module-level in-memory cache of the Reference Library. The modal
 * opens many times per session; re-pulling the JSON over IPC on every
 * open was visibly slow past ~50 references.
 * We now prefer the cache and only refetch when:
 * - The cache is empty (first open)
 * - The mutation ops (add / update / delete) bumped the revision
 * - The user explicitly requested a refresh
 *
 * The cache is invalidated, not discarded, on mutation — we
 * optimistically apply the mutation locally and then refetch to
 * confirm. Works because the file is single-writer (only this app).
 */

let cachedRecords: ReferenceRecord[] | null = null
let revision = 0
const listeners = new Set<(records: ReferenceRecord[], rev: number) => void>()

function notify() {
 if (cachedRecords) {
 for (const fn of listeners) fn(cachedRecords, revision)
 }
}

/** Force a refetch from disk. Pending reads coalesce. */
let inflight: Promise<ReferenceRecord[]> | null = null
async function refetch(): Promise<ReferenceRecord[]> {
 if (!window.electronAPI?.referencesList) {
 cachedRecords = []
 revision++
 notify()
 return cachedRecords
 }
 if (inflight) return inflight
 inflight = (async () => {
 try {
 const list = await window.electronAPI!.referencesList!()
 cachedRecords = list || []
 revision++
 notify()
 return cachedRecords
 } catch (err) {
 console.error('[reference-library-cache] refetch failed:', err)
 cachedRecords = cachedRecords || []
 return cachedRecords
 } finally {
 inflight = null
 }
 })()
 return inflight
}

export function useReferenceLibrary(): {
 records: ReferenceRecord[]
 loading: boolean
 refresh: () => Promise<void>
 /** Optimistically inserts a record + triggers a refetch to reconcile.
 * Used by Add flows so the UI updates instantly. */
 mutate: (nextList: ReferenceRecord[]) => void
} {
 const [records, setRecords] = useState<ReferenceRecord[]>(() => cachedRecords || [])
 const [loading, setLoading] = useState<boolean>(() => cachedRecords === null)

 useEffect(() => {
 const listener = (list: ReferenceRecord[]) => {
 setRecords(list)
 setLoading(false)
 }
 listeners.add(listener)
 if (cachedRecords === null) {
 setLoading(true)
 refetch().finally(() => setLoading(false))
 } else {
 setRecords(cachedRecords)
 }
 return () => {
 listeners.delete(listener)
 }
 }, [])

 const refresh = useCallback(async () => {
 setLoading(true)
 await refetch()
 setLoading(false)
 }, [])

 const mutate = useCallback((next: ReferenceRecord[]) => {
 cachedRecords = next
 revision++
 notify()
 }, [])

 return { records, loading, refresh, mutate }
}

/** Invalidate the cache from anywhere (useful after an external mutation). */
export function invalidateReferenceLibraryCache() {
 cachedRecords = null
 revision++
}
