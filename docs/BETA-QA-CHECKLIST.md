# RTM Suite 4.0 — Beta QA Checklist

Before sending a build to a beta tester (or shipping to your storefront),
walk every row below. "Fail" anywhere blocks release.

---

## Automated gates (CI-able)

Run these from the repo root before building a DMG:

- [ ] `bash scripts/qa/plugin-text-scan.sh` → PASS (zero non-ASCII in
      drawn strings, zero overflow warnings)
- [ ] `bash scripts/qa/plugin-build-validate.sh` → PASS (all 4 binaries
      exist, arm64, Info.plist consistent, pluginval clean if installed)
- [ ] `bash scripts/qa/app-integration-smoke.sh` → PASS (watcher picks
      up all three route variants)

---

## Per-format plug-in smoke (manual, 10 min)

For **every** format in **every** host you care about:

### RTM Send.app (Standalone)
- [ ] Launches from /Applications without a Gatekeeper dialog
- [ ] Audio input device picker works
- [ ] "Single" / "Compare B" / "Album" buttons all fire
- [ ] Status line updates with the sent-path confirmation
- [ ] No gibberish / box-glyphs in any text on screen
- [ ] Closing + reopening re-reads the session-name field correctly

### RTM Send.component (Audio Unit)
- [ ] Logic Pro rescan finds it
- [ ] Inserts on a Stereo Out without crashing the DAW
- [ ] `auval -v aufx RtmS Rtma` returns `passes`
- [ ] Host-hint line reads "Logic Pro: any Source works..."
- [ ] GarageBand rescan finds it, inserts, sends successfully
- [ ] MainStage rescan finds it, inserts, sends successfully

### RTM Send.vst3 (VST3)
- [ ] Ableton Live rescan finds it
- [ ] Cubase rescan finds it (check Nuendo equivalently)
- [ ] Studio One rescan finds it
- [ ] Wavelab rescan finds it (critical for mastering engineers)
- [ ] REAPER rescan finds it
- [ ] Bitwig rescan finds it
- [ ] Host-hint line matches the actual host name
- [ ] ARA region dropdown populates when host publishes regions
      (Cubase, Studio One, REAPER, Wavelab)

### RTM Send.aaxplugin (AAX)
- [ ] Pro Tools rescan finds it (trust prompt may fire — normal
      for non-PACE-signed builds; shipped commercially once Avid
      certified)
- [ ] Inserts on Master Fader
- [ ] Single / Compare / Album buttons fire

---

## Per-route integration (manual, 5 min)

With RTM Suite open and a DAW loaded:

### Source = Last N seconds
- [ ] Play 30s of audio through the insert point
- [ ] Click Single → File A slot populates, toast appears, clicking
      "Analyze Reference Only" runs to completion and shows results
- [ ] Click Compare B with File A loaded → File B slot populates, toast
      appears, clicking "Compare" runs analysis
- [ ] Click Compare B with NO File A → promotes drop to File A
      automatically; toast explains the promotion
- [ ] Click Album/Batch → File A populates + toast hints at album mode

### Source = Loop Region
- [ ] Set loop points in DAW, playback crosses them
- [ ] Click Single → captures only the loop range (verify duration in
      sidecar metadata matches loop length)

### Source = Triggered
- [ ] Click REC → status goes "capturing..."
- [ ] Play audio
- [ ] Click STOP → status goes "ready to send"
- [ ] Click Single → captures exactly the REC→STOP span

### Source = ARA Region
- [ ] In Wavelab (or Studio One): pick a region from the dropdown
- [ ] Source auto-switches to ARA
- [ ] Click Single → captures exactly that region, no playback
      required

---

## RTM Suite side (manual, 10 min)

- [ ] Incoming chip appears with session name + DAW + SR + duration
- [ ] Gold "↙ From RTM plugin" banner displays at top of single-file
      surface with the metadata
- [ ] Analyze Reference Only button triggers analysis (watch the
      processing spinner then results page)
- [ ] Compare button (when File A + File B both loaded) triggers
      analysis
- [ ] Album / Batch button (Folder drop) opens the batch table

---

## Cross-version regression (manual, 5 min)

- [ ] macOS 11 (Big Sur) — does RTM Suite.app even launch?  Check
      minimum supported macOS version in Info.plist.
- [ ] macOS 14 (Sonoma) — `com.apple.provenance` xattr doesn't block
      re-signing workflows (dev laptop only, not end-user concern)
- [ ] macOS 15 (Sequoia) — the strict "App Store & Known Developers"
      Gatekeeper setting still admits the notarized DMG

---

## Sign-off

- [ ] All automated gates PASS
- [ ] All smoke tests in at least **three** hosts PASS (pick a cross-
      section: Logic + Wavelab + Ableton)
- [ ] All four routes tested (Single / Compare B / Album / chip-click
      fallback)
- [ ] DMG mounts, drag-to-install works, app launches without any
      dialog

**Engineer:** ________________  **Date:** ______________
**Build SHA:** ______________________________
**Submitted to Apple:** id ________________________________________
