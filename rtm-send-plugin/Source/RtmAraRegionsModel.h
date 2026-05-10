#pragma once

#include <JuceHeader.h>
#include <atomic>
#include <mutex>
#include <vector>

// Thread-safe catalogue of the regions + markers the ARA controller
// found in the host. UI reads it for the dropdown; processor reads
// it on Send to resolve which region to snapshot.
//
// Sources:
//   - ARAPlaybackRegion: Wavelab montage clips, Studio One clips,
//     Cubase events all materialise as PlaybackRegions.
//   - Host-level markers: hosts that expose named markers (Wavelab
//     Generic/CD markers) surface them through ARAAudioSource
//     content readers with type kARAContentTypeMarkers. We
//     aggregate distinct ones here.
//
// Plain structs, copied on snapshot. ARA document models can
// mutate from the host thread at any moment - walking POD copies
// lets UI code skip lifetime concerns.

namespace rtm
{
    struct Region
    {
        juce::String id;           // stable opaque id (ARA ref as hex)
        juce::String name;         // host-supplied, falls back to "Region N"
        double startSec { 0.0 };
        double endSec { 0.0 };
        juce::String audioSourceName;
        juce::String audioSourcePath;   // when the host exposes it
        int numChannels { 2 };
        double sampleRate { 48000.0 };

        double durationSec() const noexcept { return juce::jmax(0.0, endSec - startSec); }
    };

    struct Marker
    {
        juce::String name;
        double positionSec { 0.0 };
        juce::String kind;   // host-specific: "CD", "Generic", "Loop", ...
    };

    class RegionsModel
    {
    public:
        // Atomic catalogue replacement from the document controller.
        void setRegions(std::vector<Region> regionsIn, std::vector<Marker> markersIn)
        {
            std::lock_guard<std::mutex> lock(mutex);
            regions = std::move(regionsIn);
            markers = std::move(markersIn);
            revision.fetch_add(1, std::memory_order_release);
        }

        std::vector<Region> getRegionsSnapshot() const
        {
            std::lock_guard<std::mutex> lock(mutex);
            return regions;
        }

        std::vector<Marker> getMarkersSnapshot() const
        {
            std::lock_guard<std::mutex> lock(mutex);
            return markers;
        }

        std::optional<Region> findRegion(const juce::String& id) const
        {
            std::lock_guard<std::mutex> lock(mutex);
            for (const auto& r : regions)
                if (r.id == id) return r;
            return std::nullopt;
        }

        // Bumped on every setRegions / clear. UI polls this.
        uint64_t getRevision() const noexcept { return revision.load(std::memory_order_acquire); }

        bool empty() const
        {
            std::lock_guard<std::mutex> lock(mutex);
            return regions.empty() && markers.empty();
        }

        void clear()
        {
            std::lock_guard<std::mutex> lock(mutex);
            regions.clear();
            markers.clear();
            revision.fetch_add(1, std::memory_order_release);
        }

    private:
        mutable std::mutex mutex;
        std::vector<Region> regions;
        std::vector<Marker> markers;
        std::atomic<uint64_t> revision { 0 };
    };
}
