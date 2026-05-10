#if RTM_ARA_ENABLED

#include "RtmAraDocumentController.h"

#include <ARA_Library/PlugIn/ARAPlug.h>

namespace
{
    // Stable id for an ARA PlaybackRegion: pointer as hex. Object
    // lifetime is bounded by the willDestroy/didAdd callbacks we
    // listen to; if a region vanishes between snapshot and send the
    // id won't match in the rebuilt model - handled downstream.
    juce::String idForRegion(const juce::ARAPlaybackRegion* r)
    {
        return juce::String::toHexString(reinterpret_cast<juce::pointer_sized_int>(r));
    }

    // OptionalProperty<ARAUtf8String> -> juce::String (empty on nullptr).
    juce::String optionalToString(const ARA::PlugIn::OptionalProperty<ARA::ARAUtf8String>& opt)
    {
        const char* raw = opt;  // implicit conversion operator
        return raw != nullptr ? juce::String::fromUTF8(raw) : juce::String();
    }
}

void RtmAraDocumentController::rebuildSnapshot()
{
    auto* doc = getDocument();
    if (doc == nullptr)
    {
        model->clear();
        return;
    }

    std::vector<rtm::Region> regs;
    std::vector<rtm::Marker> mks;  // TODO: named-marker extraction

    int autoIndex = 0;
    for (auto* seq : doc->getRegionSequences())
    {
        if (seq == nullptr) continue;
        for (auto* region : seq->getPlaybackRegions())
        {
            if (region == nullptr) continue;
            ++autoIndex;

            auto* modification = region->getAudioModification();
            auto* source = modification ? modification->getAudioSource() : nullptr;

            rtm::Region r;
            r.id = idForRegion(region);

            // Name cascade: region -> modification -> source ->
            // synthesised index. Hosts set names at different levels.
            auto name = optionalToString(region->getName());
            if (name.isEmpty() && modification != nullptr)
                name = optionalToString(modification->getName());
            if (name.isEmpty() && source != nullptr)
                name = optionalToString(source->getName());
            r.name = name.isNotEmpty() ? name : juce::String("Region ") + juce::String(autoIndex);

            r.startSec = region->getStartInPlaybackTime();
            r.endSec   = r.startSec + region->getDurationInPlaybackTime();

            if (source != nullptr)
            {
                r.audioSourceName = optionalToString(source->getName());
                // getPersistentID() returns std::string, not OptionalProperty.
                r.audioSourcePath = juce::String(source->getPersistentID().c_str());
                r.numChannels = source->getChannelCount();
                r.sampleRate  = source->getSampleRate();
            }

            regs.push_back(std::move(r));
        }
    }

    std::sort(regs.begin(), regs.end(), [](const rtm::Region& a, const rtm::Region& b) {
        if (a.startSec < b.startSec) return true;
        if (a.startSec > b.startSec) return false;
        return a.name < b.name;
    });

    model->setRegions(std::move(regs), std::move(mks));
}

bool RtmAraDocumentController::readRegionSamples(const juce::String& regionId,
                                                 std::vector<std::vector<float>>& outByChannel,
                                                 int& outSampleRate,
                                                 juce::String& errorOut)
{
    auto rec = model->findRegion(regionId);
    if (!rec)
    {
        errorOut = "Region not found - it may have been deleted since you opened the menu.";
        return false;
    }

    // Match the live PlaybackRegion against our opaque id.
    auto* doc = getDocument();
    if (doc == nullptr) { errorOut = "No ARA document attached."; return false; }

    juce::ARAPlaybackRegion* target = nullptr;
    for (auto* seq : doc->getRegionSequences())
    {
        if (seq == nullptr) continue;
        for (auto* region : seq->getPlaybackRegions())
        {
            if (region == nullptr) continue;
            if (idForRegion(region) == regionId) { target = region; break; }
        }
        if (target != nullptr) break;
    }

    if (target == nullptr) { errorOut = "Region no longer present in the ARA document."; return false; }

    auto* modification = target->getAudioModification();
    auto* source = modification ? modification->getAudioSource() : nullptr;
    if (source == nullptr) { errorOut = "Region's audio source vanished."; return false; }

    if (!source->isSampleAccessEnabled())
    {
        errorOut = "Host has sample access disabled for this source - unusual; try again once the host finishes loading / editing.";
        return false;
    }

    const double sr = source->getSampleRate();
    const int channels = source->getChannelCount();
    if (channels <= 0 || sr <= 0.0) { errorOut = "Source has no valid sample rate / channel count."; return false; }

    const juce::int64 startSample = static_cast<juce::int64>(target->getStartInAudioModificationTime() * sr);
    const juce::int64 numSamples  = static_cast<juce::int64>(target->getDurationInAudioModificationTime() * sr);
    if (numSamples <= 0) { errorOut = "Region has zero duration."; return false; }

    // HostAudioReader is the supported non-realtime read path. It
    // can block on the host's disk I/O - fine on the UI thread.
    ARA::PlugIn::HostAudioReader reader(source, /*use64BitSamples=*/false);

    outByChannel.assign(static_cast<size_t>(channels),
                        std::vector<float>(static_cast<size_t>(numSamples), 0.0f));

    constexpr juce::int64 chunk = 1 << 15;   // 32768 samples per read
    std::vector<float*> ptrs(static_cast<size_t>(channels));
    juce::int64 pos = 0;
    while (pos < numSamples)
    {
        const juce::int64 want = juce::jmin<juce::int64>(chunk, numSamples - pos);
        for (int c = 0; c < channels; ++c)
            ptrs[static_cast<size_t>(c)] = outByChannel[static_cast<size_t>(c)].data() + pos;
        const bool ok = reader.readAudioSamples(static_cast<ARA::ARASamplePosition>(startSample + pos),
                                                static_cast<ARA::ARASampleCount>(want),
                                                reinterpret_cast<void* const*>(ptrs.data()));
        if (!ok)
        {
            errorOut = "Host returned an error mid-read. File may have moved.";
            return false;
        }
        pos += want;
    }

    outSampleRate = static_cast<int>(sr);
    return true;
}

#endif // RTM_ARA_ENABLED
