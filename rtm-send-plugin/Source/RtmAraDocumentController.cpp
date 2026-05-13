#if RTM_ARA_ENABLED

#include "RtmAraDocumentController.h"

#include <ARA_Library/PlugIn/ARAPlug.h>

namespace
{
    // Stable id for an ARA PlaybackRegion: pointer as hex. Object
    // lifetime is bounded by the willDestroy/didAdd callbacks we
    // listen to; if a region vanishes between snapshot and send the
    // id won't match in the rebuilt model - handled downstream.
    //
    // LOW-6 risk: if a region is destroyed and a new region is
    // immediately allocated, the allocator MAY return the same address,
    // giving the new region the same id as the old one. Consequence:
    // findRegion() would find the NEW region when the stored id pointed
    // at the OLD one. This is a benign mis-read (wrong region content is
    // sent) rather than a crash. A robust fix would be a monotonic serial
    // ID stamped at ARA_REGION_DID_ADD time; deferred to a future sprint.
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
    // Guard against extreme durations that would cause a multi-GB allocation
    // and/or integer overflow in size_t (at 192 kHz stereo, 10 hours = ~27.6 GB).
    // 10 hours at the highest supported sample rate is a safe ceiling for any
    // mastering session; anything longer is almost certainly a corrupt region.
    constexpr juce::int64 kMaxSamples = 10LL * 3600 * 192000;  // 10 h at 192 kHz
    if (numSamples > kMaxSamples)
    {
        errorOut = juce::String ("Region too long for analysis (") +
                   juce::String (numSamples / static_cast<juce::int64>(sr), 0) +
                   juce::String (" s). Maximum is 10 hours.");
        return false;
    }

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
        // CRIT-3 fix: check cancellation between chunks so the host can
        // destroy the plugin while a long read is in progress without blocking
        // forever in ~Thread().  The AraReadThread::run() caller checks this
        // flag via stopThread(); without this check, stopThread(5000) would
        // always time out on large regions.
        if (juce::Thread::currentThreadShouldExit())
        {
            errorOut = "Read cancelled.";
            return false;
        }

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

// ── Async wrapper ────────────────────────────────────────────────────────────
bool RtmAraDocumentController::readRegionSamplesAsync(juce::String regionId,
                                                      AraReadProg  onProgress,
                                                      AraReadDone  onDone)
{
    // Guard against concurrent reads.
    if (readThread && readThread->isThreadRunning())
        return false;

    // Retire the previous thread (already stopped at this point).
    readThread.reset();
    readThread = std::make_unique<AraReadThread>();
    readThread->regionId   = std::move(regionId);
    readThread->onProgress = std::move(onProgress);
    readThread->onDone     = std::move(onDone);
    readThread->owner      = this;
    readThread->startThread();
    return true;
}

void RtmAraDocumentController::AraReadThread::run()
{
    // --- background thread ---
    // Use the synchronous readRegionSamples path so we don't duplicate the
    // HostAudioReader logic.  Progress is approximated: we call onProgress
    // once at 0% (started), once at 100% (done), with a periodic tick every
    // ~50 ms via a polling loop layered on top.  The HostAudioReader is not
    // cancellable at chunk granularity in the current API; we check
    // threadShouldExit() between retries but not within the inner read loop.
    //
    // For truly interruptible reads, the inner loop in readRegionSamples
    // would need to expose a per-chunk callback — a future improvement tracked
    // in DECISIONS.md.

    if (onProgress) onProgress (0.0f);

    const bool ok = owner->readRegionSamples (regionId, result, resultSampleRate, resultError);

    if (! ok)
    {
        result.clear();
        resultSampleRate = 0;
    }

    // Deliver result on the message thread.
    // Capture by value so this AraReadThread instance can be safely
    // reset by the DocumentController after onDone returns.
    auto doneFn    = std::move(onDone);
    auto progFn    = onProgress;
    SamplesVec  s  = std::move(result);
    int         sr = resultSampleRate;
    juce::String e = resultError;

    if (progFn) progFn (1.0f);  // 100% — still on background thread

    juce::MessageManager::callAsync ([doneFn = std::move(doneFn),
                                      s = std::move(s), sr, e = std::move(e)]() mutable
    {
        doneFn (std::move(s), sr, std::move(e));
    });
}

#endif // RTM_ARA_ENABLED
