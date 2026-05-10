#pragma once

#include <atomic>
#include <vector>
#include <cstring>

// Lock-free SPSC ring for audio samples.
// Producer: processBlock (audio thread).
// Consumer: sendSnapshotToRtm (UI thread).
//
// Interleaved storage, channel count fixed at prepareToPlay. No
// reallocation on the audio thread.
//
// writeIndex is atomic/relaxed on write, acquire on read. The reader
// snapshots the index then reads backwards; if the producer has
// lapped during the snapshot, the reader still gets the most recent
// N seconds because the buffer is circular.
//
// Not a general FIFO - this is a "capture last N seconds" trace
// buffer. Never blocks, allocates, or signals.
class RingBuffer
{
public:
    RingBuffer() = default;

    void prepare(int numChannels, int capacitySamples)
    {
        jassert(numChannels > 0 && capacitySamples > 0);
        channels = numChannels;
        capacity = capacitySamples;
        data.assign(static_cast<size_t>(capacity) * static_cast<size_t>(channels), 0.0f);
        writeIndex.store(0, std::memory_order_relaxed);
    }

    // Audio-thread. channelPtrs[c] is JUCE's getReadPointer(c).
    void writeBlock(const float* const* channelPtrs, int numChannels, int numFrames)
    {
        if (capacity == 0 || channels == 0) return;
        const int ch = std::min(numChannels, channels);
        int w = writeIndex.load(std::memory_order_relaxed);
        for (int i = 0; i < numFrames; ++i)
        {
            for (int c = 0; c < ch; ++c)
            {
                data[static_cast<size_t>(w) * static_cast<size_t>(channels) + static_cast<size_t>(c)] = channelPtrs[c][i];
            }
            // Zero-fill when input has fewer channels than our layout.
            for (int c = ch; c < channels; ++c)
            {
                data[static_cast<size_t>(w) * static_cast<size_t>(channels) + static_cast<size_t>(c)] = 0.0f;
            }
            w = (w + 1) % capacity;
        }
        writeIndex.store(w, std::memory_order_release);
    }

    // UI-thread. Snapshots the last wantFrames into outByChannel
    // (de-interleaved). Returns the count actually copied - less
    // than wantFrames if the buffer hasn't filled yet.
    int readLastFrames(std::vector<std::vector<float>>& outByChannel, int wantFrames) const
    {
        if (capacity == 0 || channels == 0) return 0;
        const int w = writeIndex.load(std::memory_order_acquire);
        const int n = std::min(wantFrames, capacity);
        outByChannel.assign(static_cast<size_t>(channels), {});
        for (auto& ch : outByChannel) ch.resize(static_cast<size_t>(n), 0.0f);

        int r = (w - n + capacity) % capacity;  // start index
        for (int i = 0; i < n; ++i)
        {
            for (int c = 0; c < channels; ++c)
            {
                outByChannel[static_cast<size_t>(c)][static_cast<size_t>(i)] =
                    data[static_cast<size_t>(r) * static_cast<size_t>(channels) + static_cast<size_t>(c)];
            }
            r = (r + 1) % capacity;
        }
        return n;
    }

    int getNumChannels() const noexcept { return channels; }
    int getCapacitySamples() const noexcept { return capacity; }

private:
    std::vector<float> data;
    int channels { 0 };
    int capacity { 0 };
    std::atomic<int> writeIndex { 0 };
};
