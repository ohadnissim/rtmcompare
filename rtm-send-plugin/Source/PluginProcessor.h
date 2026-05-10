#pragma once

#include <JuceHeader.h>
#include <optional>
#include "RingBuffer.h"
#include "RtmAraRegionsModel.h"
#if RTM_ARA_ENABLED
  #include "RtmAraDocumentController.h"
#endif

class RpcServer;

// Floating window that hosts a third-party plugin's editor as native
// OS-level chrome. This is the canonical JUCE pattern for plugin-in-
// plugin hosting (mirrors juce::AudioPluginHost's PluginWindow):
//
//   - Owned by the PROCESSOR, not the editor. Survives RTMsend's
//     editor being destroyed when the user closes RTMsend's window
//     in Wavelab. The plugin keeps running and its window stays
//     visible with all its state intact.
//
//   - setContentOwned(editor, true): the DocumentWindow takes over
//     the editor's lifetime. When this DocumentWindow is destroyed,
//     it deletes the editor. The editor's destructor calls
//     plugin->editorBeingDeleted() automatically — clean handshake.
//
//   - closeButtonPressed: the user clicked X on the plugin's own
//     window (NOT RTMsend's). We call back to the processor so it
//     can reset its unique_ptr to this window. Deferred via
//     callAsync to avoid deleting ourselves while we're still on
//     the message stack.
class HostedPluginWindow : public juce::DocumentWindow
{
public:
    HostedPluginWindow(juce::AudioPluginInstance& plugin,
                       std::function<void()> onUserClose)
        : juce::DocumentWindow(plugin.getName(),
                               juce::Colours::black,
                               juce::DocumentWindow::closeButton),
          onUserClose(std::move(onUserClose))
    {
        setUsingNativeTitleBar(true);
        if (auto* ed = plugin.hasEditor() ? plugin.createEditorIfNeeded() : nullptr)
        {
            // Window now owns the editor's lifetime. When this window
            // is destroyed it deletes ed, ed's destructor calls
            // plugin.editorBeingDeleted(ed), plugin.activeEditor goes
            // null. No leaks, no dangling pointers, no 250ms band-aid.
            setContentOwned(ed, /*resizeToFit*/ true);
            setResizable(ed->isResizable(), /*useBottomRightCornerResizer*/ false);
        }
        centreWithSize(getWidth() > 0 ? getWidth() : 640,
                       getHeight() > 0 ? getHeight() : 480);
        setVisible(true);
        toFront(true);
    }

    void closeButtonPressed() override
    {
        // Defer so we don't delete ourselves mid-callback. The
        // processor's lambda will reset the unique_ptr on the next
        // message-thread tick.
        if (onUserClose)
            juce::MessageManager::callAsync(onUserClose);
    }

private:
    std::function<void()> onUserClose;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(HostedPluginWindow)
};

// Master-bus insert. Keeps the last N seconds in a lock-free ring,
// and on Send writes WAV + sidecar JSON into ~/.rtm/incoming/ for
// RTMcompare's receiver to pick up.
//
// Audio thread only writes the ring. UI thread reads, encodes WAV,
// and drops the .ready marker last so the watcher never reads a
// half-written file.
//
// With ARA2 on we also inherit AudioProcessorARAExtension so the
// host can attach a DocumentController; that's how Source::AraRegion
// enumerates regions and pulls samples on demand.
class RtmSendAudioProcessor : public juce::AudioProcessor
#if RTM_ARA_ENABLED
    , public juce::AudioProcessorARAExtension
#endif
{
public:
    static constexpr double kDefaultBufferSeconds = 30.0;
    static constexpr double kMaxBufferSeconds = 120.0;

    RtmSendAudioProcessor();
    ~RtmSendAudioProcessor() override;

    // ── AudioProcessor overrides ───────────────────────────────────
    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    // releaseResources resets the capture state machines so a closed-
    // then-reopened instance doesn't inherit a stale "Rec" / "loop
    // complete" flag from the previous session.
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    // -- UI-thread API ----------------------------------------------
    // Which RTM surface the drop lands on. The receiver reads this tag
    // from the sidecar so we don't need a second click.
    //   single   - Single-file analysis (RefOnly view).
    //   compareB - Compare mode File B.
    //   batch    - Album / batch table (v4.0+).
    enum class Route { Single, CompareB, Batch };

    // Which audio goes out on Send.
    //   LastNSeconds    - ring tail. Always available.
    //   LoopRegion      - DAW cycle region. Needs the host to expose
    //                     AudioPlayHead loop points; hosts that don't
    //                     leave loopPointsSeen false and the UI greys
    //                     this out.
    //   TriggeredRegion - between Rec/Stop clicks. Host-agnostic.
    //   AraRegion       - a specific clip / montage track published
    //                     via ARA2. Lets us send "Track 03" out of a
    //                     Wavelab montage without master-bus playback.
    enum class Source { LastNSeconds, LoopRegion, TriggeredRegion, AraRegion };

    // Snapshots the current source, writes WAV + sidecar + .ready.
    // Returns the wav path on success, empty string on failure.
    juce::String sendSnapshotToRtm(Route route, juce::String& errorMsgOut);

    Source getSource() const noexcept { return source.load(std::memory_order_acquire); }
    void setSource(Source s) noexcept { source.store(s, std::memory_order_release); }
    void startTriggeredCapture();
    void stopTriggeredCapture();
    bool isTriggeredCapturing() const noexcept { return triggered.active.load(std::memory_order_acquire); }
    // Did the host expose loop points this block? UI greys out Loop
    // Region mode when this is false.
    bool hostHasLoopPoints() const noexcept { return loopPointsSeen.load(std::memory_order_acquire); }

    // ARA regions catalogue. Empty on non-ARA hosts (we never
    // attached a controller there). UI polls this for the dropdown.
    std::shared_ptr<rtm::RegionsModel> getAraRegionsModel() const { return araRegionsModel; }
    /** True iff the host attached this RTMsend instance as an ARA effect
     *  AND the JUCE wrapper successfully resolved our DocumentController.
     *  Diagnostic only — used by `host.ara_state` RPC to disambiguate
     *  "not attached" vs "attached but no regions yet". */
    bool isAraAttached() const noexcept { return araAttached.load(std::memory_order_acquire); }

    // 5.7.x audit fix: lock-protected — see stringFieldsLock comment.
    // The ARA region picker, sendSnapshotToRtm, and the state
    // serialiser all touch this string; today they all run on the
    // message thread but locking removes that as an invariant the
    // caller must remember.
    juce::String getSelectedAraRegionId() const   { const juce::ScopedLock sl (stringFieldsLock); return selectedAraRegionId; }
    void setSelectedAraRegionId (juce::String id) { const juce::ScopedLock sl (stringFieldsLock); selectedAraRegionId = std::move (id); }

    // Reallocates the ring when the length changes.
    double getBufferSeconds() const noexcept { return bufferSeconds; }
    void setBufferSeconds(double s);

    // Goes into the sidecar. Defaults to the host project name when
    // we can get one.
    // 5.7.x audit fix: lock the non-atomic juce::String getters/setters.
    // juce::String is copy-on-write with an atomic refcount but the
    // POINTER itself is not atomic — a concurrent read while another
    // thread reassigns the field is UB on the pointer load. All callers
    // today happen to be on the message thread, but the public API
    // doesn't enforce that, so a future RPC path (or third-party
    // wrapper-host quirk) could land off-thread. CriticalSection is
    // cheap (uncontended fast path is a single CAS) and bullet-proofs
    // the contract.
    juce::String getSessionName() const   { const juce::ScopedLock sl (stringFieldsLock); return sessionName; }
    void setSessionName (juce::String s)  { const juce::ScopedLock sl (stringFieldsLock); sessionName = std::move (s); }

    juce::String getLastStatus() const    { const juce::ScopedLock sl (stringFieldsLock); return lastStatus; }

    // ── 1.1.0 spike: plugin-host slot ──────────────────────────────
    // RTMsend hosts a single third-party VST3/AU plugin inline so the
    // user can drop FabFilter Pro-Q (etc.) onto the bus as part of
    // their existing workflow, then have RTMcompare push EQ values
    // into it via the localhost RPC the next phase adds.
    //
    // Threading model (spike scope — single-slot, no hot-swap during
    // playback):
    //   - UI thread:     loadHostedPlugin / unloadHostedPlugin / scan
    //   - Audio thread:  reads `hostingEnabled` (atomic); when true
    //                    routes the buffer through `hostedPlugin->
    //                    processBlock` before the ring write so the
    //                    captured WAV reflects the chain.
    //   - Load sequence pauses audio (sets hostingEnabled=false),
    //     swaps the unique_ptr, runs prepareToPlay on the new
    //     instance, then re-enables. Caller is expected to gate this
    //     while transport is stopped.
    juce::AudioPluginFormatManager& getPluginFormatManager() { return pluginFormatManager; }
    juce::KnownPluginList& getKnownPluginList() { return knownPluginList; }
    juce::AudioPluginInstance* getHostedPlugin() noexcept { return hostedPlugin.get(); }
    juce::String getHostedPluginName() const;
    void scanForPluginsAsync(std::function<void()> onDone);
    juce::String loadHostedPlugin(const juce::PluginDescription& desc);
    void unloadHostedPlugin();
    bool isHostingEnabled() const noexcept { return hostingEnabled.load(std::memory_order_acquire); }
    /** 5.7.x audit fix: distinguish "user toggled hosting off" from "the
     *  hosted plugin threw inside processBlock and we drop-routed it for
     *  safety". The UI uses this to surface "plugin faulted, reload it"
     *  rather than silently appearing disabled. Cleared on load/unload. */
    bool didHostedPluginFault() const noexcept { return hostedPluginFaulted.load(std::memory_order_acquire); }
    /** 5.7.1 v4: lock-free check used by host.ping. Mirrors hostedPlugin
     *  presence so the RPC can answer in microseconds without queueing
     *  behind a message-thread-bound set_parameters call. */
    bool isHostedPluginPresent() const noexcept { return hostedPluginPresent.load(std::memory_order_acquire); }

    // Hosted plugin's floating editor window. Lives on the processor
    // so it survives RTMsend's own editor being destroyed (Wavelab
    // window close). The user toggles it via the editor's "Open"/
    // "Close" button; clicking X on the plugin's own window also
    // hides it (deferred destruction via the closeButtonPressed
    // callback in HostedPluginWindow).
    void showHostedPluginWindow();
    void hideHostedPluginWindow();
    bool isHostedPluginWindowOpen() const noexcept { return hostedPluginWindow != nullptr; }
    juce::File getKnownPluginListCacheFile() const;
    void saveKnownPluginListCache();
    void loadKnownPluginListCache();

    // 1.1.0: localhost JSON-RPC server. Owns its own thread; started
    // in the ctor, stopped in the dtor. Exposes the RPC port so the
    // editor's status line can show it.
    int getRpcPort() const noexcept;

private:
    RingBuffer ring;
    double sampleRateHz { 48000.0 };
    int numChannels { 2 };
    double bufferSeconds { kDefaultBufferSeconds };

    // Atomic so processBlock (audio thread) and the UI mode picker
    // (setSource) don't race on a non-atomic enum read/write — the
    // codex P0 plugin audit flagged the prior plain-enum field.
    std::atomic<Source> source { Source::LastNSeconds };

    // ── Region-capture state (Loop and Triggered modes share it) ───
    // Single-writer (audio thread). UI thread only reads / flips the
    // flags.
    struct RegionBuffer {
        std::vector<std::vector<float>> samples;  // de-interleaved
        std::atomic<bool> active { false };
        std::atomic<bool> complete { false };
        double startPpq { -1.0 };
        double endPpq { -1.0 };
        double startTimeSec { -1.0 };
        double endTimeSec { -1.0 };
    };
    RegionBuffer loopCapture;
    RegionBuffer triggered;
    std::atomic<bool> loopPointsSeen { false };

    // One place for the UI to poll. Points at the DocumentController's
    // model under ARA; otherwise an empty model so UI code stays
    // branch-free on ARA availability.
    std::shared_ptr<rtm::RegionsModel> araRegionsModel { std::make_shared<rtm::RegionsModel>() };
    std::atomic<bool> araAttached { false };
    juce::String selectedAraRegionId;

    juce::String sessionName;
    juce::String lastStatus;
    // 5.7.x audit fix: guards sessionName, lastStatus, hostedPluginName.
    // Mutable so const getters can lock. Held only briefly across the
    // assignment / read; never held across other locks.
    mutable juce::CriticalSection stringFieldsLock;

    // 1.1.0 spike: host slot members. See public-section comment for
    // the threading model.
    juce::AudioPluginFormatManager pluginFormatManager;
    juce::KnownPluginList knownPluginList;
    std::unique_ptr<juce::AudioPluginInstance> hostedPlugin;
    juce::String hostedPluginName;
    std::atomic<bool> hostingEnabled { false };
    // 5.7.x audit fix: separate "plugin threw on processBlock" flag from
    // hostingEnabled. Pre-fix the catch block called
    // hostingEnabled.store(false) — which the UI then read as "user turned
    // hosting off" with no way to learn the plugin had faulted. Now the
    // audio thread sets hostedPluginFaulted on throw and the UI surfaces
    // a distinct error state. Cleared in loadHostedPlugin / unloadHostedPlugin.
    std::atomic<bool> hostedPluginFaulted { false };
    // 5.7.1 v4 fix: atomic mirror of `hostedPlugin != nullptr` so RPC
    // handlers (host.ping in particular) can answer without taking the
    // message-thread lock. Pre-fix host.ping ran inside runOnMessageThreadSync
    // — same lock host.set_parameters held while writing 45 Pro-Q
    // parameters (~7 seconds). Polling pings queued behind the writes,
    // exceeded the bridge's 1.5s ping timeout, and the connection
    // indicator flipped to offline mid-send. Updated under the same
    // callback lock that swaps hostedPlugin.
    std::atomic<bool> hostedPluginPresent { false };

    // Plugin's floating editor window. May be null when no plugin is
    // loaded or when the user explicitly closed the window.
    std::unique_ptr<HostedPluginWindow> hostedPluginWindow;

    // Deferred plugin retirement. Synchronously deleting the previous
    // hosted plugin on Pick/Eject was crashing Wavelab inside
    // Kirchhoff-EQ's queued CFRunLoop source0 callbacks (their
    // OpenGL renderer / JUCE Timer / HighResolutionTimer threads
    // post message-thread work that fired AFTER the plugin had been
    // released → null deref at offset 0xcd8). retireHostedPluginAsync
    // hands the unique_ptr to a Timer::callAfterDelay lambda; the
    // plugin survives ~250 ms longer, by which time all in-flight
    // runloop sources have either run against a still-valid `this`
    // or been removed. Keep this even after we've notified the
    // hosted-editor holder — the runloop drain time matters more
    // than the editor detach.
    void retireHostedPluginAsync(std::unique_ptr<juce::AudioPluginInstance> p);
    // Scratch MIDI buffer for the hosted plugin — RTMsend itself does
    // not pass MIDI through, but JUCE plugins universally expect a
    // MidiBuffer arg even when they don't read it.
    juce::MidiBuffer hostedMidiScratch;

    std::unique_ptr<RpcServer> rpcServer;

    void allocateRing();

    // 5.7.x audit fix: lock-protected setter for lastStatus. Inline call
    // sites used to do `lastStatus = ...;` directly, but with
    // stringFieldsLock now guarding the getter, the writer must take
    // the same lock or a torn-pointer race is still possible. Used
    // only inside sendSnapshotToRtm and the triggered-capture paths.
    void setLastStatusLocked (juce::String s);

    // ~/.rtm/incoming/ - created on first use.
    juce::File incomingFolder() const;

    bool writeWav(const juce::File& out,
                  const std::vector<std::vector<float>>& samplesByChannel,
                  double sr) const;

    bool writeSidecar(const juce::File& out, int channels, double sr, int frames, Route route) const;

    // 5.7.x audit fix: WeakReferenceable so deferred lambdas (X-button
    // close handler in HostedPluginWindow, retireHostedPluginAsync timer)
    // can safely no-op when the processor has been torn down before
    // their callback fires. Pre-fix the lambda captured `this` directly
    // — if Wavelab destroyed our processor between user-click and the
    // message-thread tick, the callback derefed a freed pointer.
    JUCE_DECLARE_WEAK_REFERENCEABLE (RtmSendAudioProcessor)
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(RtmSendAudioProcessor)
};
