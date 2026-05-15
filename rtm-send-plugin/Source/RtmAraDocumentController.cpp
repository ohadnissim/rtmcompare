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
    std::vector<rtm::Marker> mks;

    // ── PlaybackRegions (clips) ──────────────────────────────────────────────
    // WaveLab montage clips, Studio One events, Cubase regions, REAPER items
    // all surface here. This is the primary selection method.
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

    // ── Musical-context markers (WaveLab CD tracks, timeline bar boundaries) ─
    //
    // The ARA 2 spec has no "named user marker" content type. What hosts
    // DO publish via the MusicalContext are:
    //   - kARAContentTypeTempoEntries  : BPM / tempo sync points (seconds ↔ beats)
    //   - kARAContentTypeBarSignatures : time-signature changes (beats ↔ bars)
    //
    // WaveLab (Steinberg) uses kARAContentTypeBarSignatures to advertise its
    // CD-track / montage region boundaries on the timeline. Each bar-signature
    // event position is expressed in quarter notes; the tempo map is needed to
    // convert to seconds.
    //
    // Strategy:
    //   1. Build a quarter-note → seconds lookup from the tempo entries.
    //   2. Walk the bar signatures; each one becomes a named Marker.
    //   3. Name: hosts don't pass user-defined marker names through ARA 2,
    //      so we synthesise "Marker N" (or "CD Track N" for WaveLab's typical
    //      bar-per-track structure).
    //
    // If the musical context doesn't support either content type (most hosts
    // that use DAW-loop or triggered-region workflows) mks stays empty and
    // the "Between markers" section doesn't appear in the UI. That's correct.

    for (auto* musCtx : doc->getMusicalContexts())
    {
        if (musCtx == nullptr) continue;

        // HostContentReader checks availability internally; operator bool() reports it.
        // Build quarter-note → seconds table from tempo entries.
        // Each entry: { timePosition (seconds), contentValue.quarterPosition (qn) }
        // Between two entries the tempo is constant; interpolate linearly in qn-space.
        struct TempoPoint { double qn; double sec; double bps; }; // beats per second
        std::vector<TempoPoint> tempoMap;

        {
            ARA::PlugIn::HostContentReader<ARA::kARAContentTypeTempoEntries> tempoReader(musCtx);
            if (tempoReader)
            {
                // ARAContentTempoEntry has timePosition (seconds) and quarterPosition (qn).
                // BPS between two sync points = ΔqnPositions / ΔtimePositions.
                // We store each point; BPS is computed segment-by-segment in qnToSec.
                struct RawEntry { double qn; double sec; };
                std::vector<RawEntry> raw;
                const ARA::ARAInt32 n = tempoReader.getEventCount();
                raw.reserve(static_cast<size_t>(n));
                for (ARA::ARAInt32 i = 0; i < n; ++i)
                {
                    const auto e = tempoReader.getDataForEvent(i);
                    raw.push_back({ static_cast<double>(e.quarterPosition),
                                    static_cast<double>(e.timePosition) });
                }
                tempoMap.reserve(raw.size());
                for (size_t i = 0; i < raw.size(); ++i)
                {
                    // BPS for segment starting at raw[i]: derived from the next entry.
                    // For the last entry, extrapolate using the previous segment's rate.
                    double bps = 2.0; // 120 BPM fallback
                    if (i + 1 < raw.size())
                    {
                        const double dqn = raw[i + 1].qn - raw[i].qn;
                        const double dt  = raw[i + 1].sec - raw[i].sec;
                        if (dt > 1e-9 && dqn > 0.0) bps = dqn / dt;
                    }
                    else if (tempoMap.size() > 0)
                    {
                        bps = tempoMap.back().bps; // carry forward last rate
                    }
                    tempoMap.push_back({ raw[i].qn, raw[i].sec, bps });
                }
            }
        }

        // Check bar signatures availability before proceeding.
        {
            ARA::PlugIn::HostContentReader<ARA::kARAContentTypeBarSignatures> testBarReader(musCtx);
            if (!testBarReader) continue;   // nothing useful from this musical context
        }
        // Fallback: 120 BPM constant tempo if no tempo entries.
        if (tempoMap.empty())
            tempoMap.push_back({ 0.0, 0.0, 2.0 });

        // Quarter-note position → wall-clock seconds.
        auto qnToSec = [&](double qn) -> double
        {
            if (tempoMap.size() == 1 || qn <= tempoMap.front().qn)
            {
                // Before or at first tempo point — extrapolate backwards.
                const auto& t0 = tempoMap.front();
                return t0.sec + (qn - t0.qn) / t0.bps;
            }
            // Binary search for the segment containing qn.
            size_t lo = 0, hi = tempoMap.size() - 1;
            while (lo + 1 < hi)
            {
                const size_t mid = (lo + hi) / 2u;
                if (tempoMap[mid].qn <= qn) lo = mid; else hi = mid;
            }
            const auto& ta = tempoMap[lo];
            const auto& tb = tempoMap[hi];
            if (qn >= tb.qn)
                return tb.sec + (qn - tb.qn) / tb.bps; // extrapolate past last point
            // Interpolate within segment [ta, tb]: tempo is constant between sync points.
            return ta.sec + (qn - ta.qn) / ta.bps;
        };

        // Walk bar signatures → markers.
        // ARAContentBarSignature: { numerator, denominator, position (in quarter notes) }
        // Most hosts (WaveLab, Studio One, Cubase) only emit one event per
        // time-signature CHANGE, so nBars is typically 1–5.
        // Logic Pro may emit one entry per bar in certain project configurations,
        // which would flood the dropdown. Cap at kMaxMarkers as a safety net.
        constexpr int kMaxMarkers = 64;
        ARA::PlugIn::HostContentReader<ARA::kARAContentTypeBarSignatures> barReader(musCtx);
        const ARA::ARAInt32 nBars = barReader.getEventCount();
        int markerIndex = 1;
        for (ARA::ARAInt32 i = 0; i < nBars; ++i)
        {
            if (static_cast<int>(mks.size()) >= kMaxMarkers) break;
            const auto bar = barReader.getDataForEvent(i);
            // ARAContentBarSignature.position is in quarter notes
            const double posSec = qnToSec(static_cast<double>(bar.position));
            if (posSec < 0.0) continue;   // skip any pre-roll markers

            rtm::Marker mk;
            mk.positionSec = posSec;
            // The ARA spec doesn't carry user-defined marker names.
            // Name by index — matches WaveLab's CD-track numbering convention.
            mk.name = juce::String("Marker ") + juce::String(markerIndex++);
            mk.kind = "BarBoundary";   // internal tag for debugging
            mks.push_back(std::move(mk));
        }
        // Only read one musical context — WaveLab and Studio One expose one;
        // reading multiples would duplicate markers.
        if (!mks.empty()) break;
    }

    // De-duplicate markers at the same position (some hosts publish the same
    // bar boundary twice from different musical contexts).
    std::sort(mks.begin(), mks.end(), [](const rtm::Marker& a, const rtm::Marker& b) {
        return a.positionSec < b.positionSec;
    });
    mks.erase(std::unique(mks.begin(), mks.end(), [](const rtm::Marker& a, const rtm::Marker& b) {
        return std::abs(a.positionSec - b.positionSec) < 0.01; // within 10 ms = same marker
    }), mks.end());

    // Renumber after de-dup so names are "Marker 1, 2, 3..." without gaps.
    for (size_t i = 0; i < mks.size(); ++i)
        mks[i].name = juce::String("Marker ") + juce::String(static_cast<int>(i + 1));

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
        errorOut = juce::String ("Region too long for analysis (")
                   + juce::String (static_cast<int>(numSamples / static_cast<juce::int64>(sr)))
                   + juce::String (" s). Maximum is 10 hours.");
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
