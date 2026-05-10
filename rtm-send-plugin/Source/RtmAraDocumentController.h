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

    std::shared_ptr<rtm::RegionsModel> getModel() const { return model; }

    // Pulls regionId's samples via HostAudioReader. UI thread.
    bool readRegionSamples(const juce::String& regionId,
                           std::vector<std::vector<float>>& outByChannel,
                           int& outSampleRate,
                           juce::String& errorOut);

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
};

#endif // RTM_ARA_ENABLED
