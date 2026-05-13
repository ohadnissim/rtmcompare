#pragma once

#if RTM_ARA_ENABLED

#include <JuceHeader.h>
#include "RtmAraRegionsModel.h"

// ARA2 document controller (JUCE 8).
//
// Inherits juce::ARADocumentControllerSpecialisation. We only
// override the listener hooks we care about - the rest stay as
// no-op defaults.
//
// Read-only: we never mutate the host document. Any host-side
// edit (clip added, region renamed, source loaded) triggers a
// rebuildSnapshot() into RegionsModel for the processor + editor
// to poll.
//
// Sample reads go through ARA::PlugIn::HostAudioReader - the
// SDK's supported non-realtime path. Can block on host disk I/O;
// we call it from the UI thread, before the WAV write.
class RtmAraDocumentController : public juce::ARADocumentControllerSpecialisation
{
public:
    RtmAraDocumentController(const ARA::PlugIn::PlugInEntry* entry,
                             const ARA::ARADocumentControllerHostInstance* instance)
        : juce::ARADocumentControllerSpecialisation(entry, instance) {}

    // CRIT-3 fix: explicitly stop any running background ARA read thread
    // before this DocumentController is destroyed.  Without this, the host
    // destroying the plugin while a read is in progress causes:
    //  - debug builds: juce::Thread::~Thread() assertion ("Thread still running")
    //  - release builds: stopThread(-1) which blocks forever because the inner
    //    chunk loop never checks threadShouldExit().
    // stopThread(5000) signals exit AND waits up to 5 s; the inner loop now
    // checks threadShouldExit() between chunks so it can actually respond.
    ~RtmAraDocumentController()
    {
        if (readThread && readThread->isThreadRunning())
            readThread->stopThread (5000);
    }

    std::shared_ptr<rtm::RegionsModel> getModel() const { return model; }

    // Synchronous version — kept for internal use only; see async below.
    bool readRegionSamples(const juce::String& regionId,
                           std::vector<std::vector<float>>& outByChannel,
                           int& outSampleRate,
                           juce::String& errorOut);

    // Async wrapper: spins a background juce::Thread so the UI thread is not
    // blocked during HostAudioReader disk I/O (can take seconds for long regions
    // on slow media).  All callbacks fire on the MESSAGE thread.
    //
    // onProgress(0..1f) — called ~every 3% of samples read.  Do not touch
    //   UI components directly; call juce::MessageManager::callAsync if needed.
    // onDone(samples, sampleRate, error) — empty error string on success.
    //   Samples vector is empty and sampleRate is 0 on failure.
    //
    // Only one concurrent async read is supported per DocumentController
    // instance.  Calling again before the previous completes is a no-op
    // (returns false).  Use the returned shared_ptr to cancel: set its
    // cancellation flag before the read finishes to abort mid-loop.
    using SamplesVec   = std::vector<std::vector<float>>;
    using AraReadDone  = std::function<void(SamplesVec, int, juce::String)>;
    using AraReadProg  = std::function<void(float)>;

    bool readRegionSamplesAsync(juce::String regionId,
                                AraReadProg  onProgress,
                                AraReadDone  onDone);

protected:
    // ── juce::ARADocumentListener ──────────────────────────────────
    void willBeginEditing        (juce::ARADocument*) override {}
    void didEndEditing           (juce::ARADocument*) override { rebuildSnapshot(); }
    void didAddAudioSourceToDocument     (juce::ARADocument*, juce::ARAAudioSource*) override { rebuildSnapshot(); }
    void willRemoveAudioSourceFromDocument (juce::ARADocument*, juce::ARAAudioSource*) override { rebuildSnapshot(); }
    void didAddRegionSequenceToDocument   (juce::ARADocument*, juce::ARARegionSequence*) override { rebuildSnapshot(); }
    void willRemoveRegionSequenceFromDocument (juce::ARADocument*, juce::ARARegionSequence*) override { rebuildSnapshot(); }

    // ── juce::ARAAudioSourceListener ────────────────────────────────
    void doUpdateAudioSourceContent (juce::ARAAudioSource*, juce::ARAContentUpdateScopes) override { rebuildSnapshot(); }
    void willDestroyAudioSource (juce::ARAAudioSource*) override { rebuildSnapshot(); }

    // ── juce::ARAPlaybackRegionListener ─────────────────────────────
    void didUpdatePlaybackRegionProperties (juce::ARAPlaybackRegion*) override { rebuildSnapshot(); }
    void willDestroyPlaybackRegion          (juce::ARAPlaybackRegion*) override { rebuildSnapshot(); }

    // ── juce::ARARegionSequenceListener ─────────────────────────────
    void didAddPlaybackRegionToRegionSequence    (juce::ARARegionSequence*, juce::ARAPlaybackRegion*) override { rebuildSnapshot(); }
    void willRemovePlaybackRegionFromRegionSequence (juce::ARARegionSequence*, juce::ARAPlaybackRegion*) override { rebuildSnapshot(); }

    // Required abstract overrides. Read-only plugin - nothing to archive.
    bool doRestoreObjectsFromStream (juce::ARAInputStream&, const juce::ARARestoreObjectsFilter*) override { return true; }
    bool doStoreObjectsToStream     (juce::ARAOutputStream&, const juce::ARAStoreObjectsFilter*) override { return true; }

    // Required for hosts to engage ARA mode. Wavelab Pro 13 (and per
    // JUCE's juce_ARADocumentController.h:75 comment, all ARA-aware
    // hosts) check that the DocumentController declares at least the
    // PlaybackRenderer role before binding ARA. Without this, Wavelab
    // silently falls back to non-ARA insert mode and our region
    // picker stays empty.
    //
    // RTMsend doesn't actually need to RENDER audio via ARA — we keep
    // the regular processBlock path for the live audio chain, and
    // only use ARA to read region samples on demand from the editor.
    // So we return a default-behaviour ARAPlaybackRenderer; its base
    // processBlock is a no-op (fine since the host's regular insert
    // chain already routes audio through us).
    juce::ARAPlaybackRenderer* doCreatePlaybackRenderer() noexcept override
    {
        return new juce::ARAPlaybackRenderer (getDocumentController());
    }

private:
    void rebuildSnapshot();
    std::shared_ptr<rtm::RegionsModel> model { std::make_shared<rtm::RegionsModel>() };

    // Background read thread — at most one alive at a time.
    struct AraReadThread : juce::Thread
    {
        AraReadThread() : juce::Thread ("RTMsend ARA reader") {}
        // Inputs:
        juce::String       regionId;
        AraReadProg        onProgress;
        AraReadDone        onDone;
        RtmAraDocumentController* owner { nullptr };
        // Output:
        SamplesVec         result;
        int                resultSampleRate { 0 };
        juce::String       resultError;

        void run() override;
    };
    std::unique_ptr<AraReadThread> readThread;
};

#endif // RTM_ARA_ENABLED
