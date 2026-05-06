# RTM Suite — cross-app protocol contract

There are three serialized contracts that travel between the three apps.
Each one is documented here so any one app can drift forward without
silently breaking the others.

## Contracts

| Contract | Writer | Reader | Field name | Current value |
|---|---|---|---|---|
| `.ready` triple sidecar JSON | RTM Send | RTMcompare | `protocolVersion` | `1` |
| Engineer profile JSON (`~/.rtm/profiles/*.json`) | RTMprofile | RTMcompare | `schema_version` | `1` |
| Album session (`*.rtmalbum.json`) | RTMcompare | RTMcompare | `version` | `1` |

## Compatibility rule

**Tolerant additive, warn on higher major.**

- Readers MUST tolerate unknown fields. New fields can be added in any
  release without bumping the version.
- Readers MUST tolerate a missing version field (treat as version 1).
- Readers MUST warn but still load when they see a `version` higher
  than they understand. The warning lands in the dev console, not in
  the user's face — the file likely still loads cleanly because the
  fields they DO understand are still there.
- A reader MAY fail-closed only on a documented breaking change. As
  of 5.3.0 there are no such changes.

The point of the field is to make a future migration possible, not to
gate today's load. If a 5.3.x reader sees `version: 2` from a 5.4
writer, the user still gets their data.

## Versioning when a field is removed

Don't. Removed fields go through deprecation — keep emitting the field
with a sensible default for at least one minor cycle, then drop. The
genre/mood removal in 5.2.3 followed this pattern: `--genres` is still
accepted by the CLI as a no-op so old shells don't break.

## When to bump

Bump the version when adding a field whose absence in older readers
would corrupt user-visible behaviour (not just hide a feature). Example
that justifies a bump: changing the meaning of `lufs_avg` from "I-LUFS
mean" to "median." Example that does NOT justify a bump: adding a new
optional `mastering_chain` field to the album session.

## Where each writer stamps the version

- **`rtm-send-plugin/Source/PluginProcessor.cpp`** — `writeSidecar()`
  emits `obj->setProperty("protocolVersion", 1)` as the very first
  property.
- **`rtm-profile-app/python/build_profile.py`** — `aggregate()` emits
  `"schema_version": 1` as the first key in the profile dict.
- **`Compare App/src/components/BatchView.tsx`** — `payload.version`
  is set from `ALBUM_SESSION_VERSION` (currently `1`) in `src/types.ts`.

## Where each reader checks the version

- **RTMcompare reading `.ready` sidecars** — `electron/main.ts`
  `readMetaSafe` is the parse point. Today it ignores the version
  entirely (tolerant). When 5.4+ ships a v2 with breaking semantics,
  add a console.warn here and any required field-rewriting.
- **RTMcompare loading a profile JSON** — `electron/main.ts`
  `load-custom-profile` validates the 31-band curve. The
  `schema_version` is currently advisory.
- **RTMcompare loading a `.rtmalbum.json`** — `App.tsx` Load Album
  Session handler now warns when `version > 1`.

## Frequently-asked

> *Why three different field names instead of a single `protocolVersion`?*

Because the three contracts evolve independently and have independent
producers. RTM Send 1.1 may bump `protocolVersion` while RTMprofile
stays on `schema_version: 1`. Sharing a name would imply lockstep.
