#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "RpcServer.h"

#if RTM_ARA_ENABLED
  #include <juce_audio_processors/juce_audio_processors.h>
  #include "RtmAraDocumentController.h"
#endif

// 5.8.0 (audit P0 #4 hardening): O_NOFOLLOW / O_EXCL atomic open.
// JUCE's FileOutputStream calls fopen()/CreateFile() internally and
// cannot carry O_NOFOLLOW.  We replace it with an fd-backed OutputStream
// so the open, exclusive-create, and symlink-rejection are one syscall.
#if ! JUCE_WINDOWS
  #include <fcntl.h>    // O_WRONLY / O_CREAT / O_EXCL / O_NOFOLLOW
  #include <sys/stat.h> // S_IRUSR / S_IWUSR
  #include <unistd.h>   // write / close / fsync
#endif

RtmSendAudioProcessor::RtmSendAudioProcessor()
    : AudioProcessor(BusesProperties()
                         .withInput ("Input",  juce::AudioChannelSet::stereo(), true)
                         .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    // Overridden from the editor; placeholder until then.
    sessionName = "Untitled session";

    // 1.1.0 spike: register the plug-in formats we host. JUCE 8 swapped
    // `addDefaultFormats()` (deleted) for the free function
    // `juce::addDefaultFormatsToManager(...)`, which pulls in VST3
    // unconditionally and AU on Apple targets, gated by the
    // JUCE_PLUGINHOST_* defines we set in CMakeLists.txt. Cache the
    // previously-scanned plugin list so the picker doesn't have to
    // rescan every launch.
    juce::addDefaultFormatsToManager(pluginFormatManager);
    loadKnownPluginListCache();

    // 1.1.0: spin up the JSON-RPC server so RTMcompare can push EQ
    // values into the hosted plugin. Bound to localhost only; the
    // chosen port is written to ~/.rtm/rtmsend.port for discovery.
    rpcServer = std::make_unique<RpcServer>(*this);
    rpcServer->start();

#if RTM_ARA_ENABLED
    // ARA factory registration happens via IS_ARA_EFFECT=TRUE in the
    // CMake. The extension isn't live yet at ctor time - we pick up
    // the DocumentController in prepareToPlay.
#endif
}

RtmSendAudioProcessor::~RtmSendAudioProcessor()
{
    // Stop the scan thread FIRST — it holds a raw `this` pointer. Any
    // other member it accesses (pluginFormatManager, knownPluginList,
    // hostingEnabled) must still be alive when we call stopThread, so
    // this must happen before any other teardown. threadShouldExit()
    // causes the scan loop to break after the current scanNextFile call
    // (≤ a few seconds). The 5 s timeout is generous on purpose.
    if (pluginScanThread && pluginScanThread->isThreadRunning())
        pluginScanThread->stopThread (5000);

    // 5.7.x audit fix: explicit teardown order. Stop the RPC server
    // first so no incoming call can land on a half-destructed
    // processor. Then close any hosted-plugin window before the
    // hostedPlugin itself is released — the window's editor calls
    // back into the processor's hostedPluginWindow lambda on close,
    // which would otherwise dereference a freed `this`. Member
    // declaration order matters: rpcServer destructs first naturally,
    // but the window/plugin pair needs explicit ordering because
    // the window OWNS the editor that points back into us.
    if (rpcServer) rpcServer->stop();
#if RTM_ARA_ENABLED
    araRegionsModel.reset();
#endif
    hostedPluginWindow.reset();  // closes editor before plugin destructs
    hostedPlugin.reset();        // now safe to release
}

int RtmSendAudioProcessor::getRpcPort() const noexcept
{
    return rpcServer ? rpcServer->getPort() : 0;
}

void RtmSendAudioProcessor::prepareToPlay(double sr, int samplesPerBlock)
{
    sampleRateHz = sr;
    numChannels = std::max(1, getTotalNumInputChannels());
    allocateRing();

    // 1.1.0 spike: relay prepareToPlay into the hosted plugin so its
    // internal buffers / oversamplers / state are sized for this host
    // session.
    //
    // 5.7.x audit fix: serialise this against our own audio-thread
    // processBlock via getCallbackLock(). The pre-fix hostingEnabled
    // atomic-exchange only stopped *new* dispatches into hp->processBlock;
    // it did NOT wait for an in-flight call to drain. Hosts that call
    // prepareToPlay on a worker thread while processBlock is running
    // (Reaper, Bitwig, some Studio One revisions) could therefore land
    // setPlayConfigDetails / prepareToPlay on the hosted plugin while
    // the audio thread was inside its processBlock — UB on most
    // commercial plugins (Pro-Q rebuilds its lattice in prepareToPlay).
    // getCallbackLock() is the JUCE idiom: the host's audio thread
    // already holds it across processBlock calls into us, so acquiring
    // it on the message thread guarantees the audio thread is parked.
    if (hostedPlugin)
    {
        const juce::ScopedLock sl(getCallbackLock());
        hostedPlugin->setPlayConfigDetails(numChannels, numChannels, sr, samplesPerBlock);
        hostedPlugin->prepareToPlay(sr, samplesPerBlock);
    }

#if RTM_ARA_ENABLED
    // When ARA is active on this instance, grab the DocumentController
    // and copy its regions-model pointer so the UI polls the same
    // catalogue. Idempotent; safe to run every prepareToPlay.
    //
    // Note: in Wavelab Pro 13's clip-effects panel, the ARA bind path
    // never fires for third-party VST3 plugins — the host loads us as
    // a regular Fx and getDocumentController() always returns null.
    // The ARA code below remains in place so DAWs that do support
    // third-party ARA (Studio One, Cubase/Nuendo, Reaper, Bitwig) get
    // the full region-aware behaviour. Wavelab users get the 30-second
    // ring buffer model, which is the explicit non-ARA fallback.
    if (auto* dc = ARA::PlugIn::PlugInExtension::getDocumentController())
    {
        if (auto* spec = juce::ARADocumentControllerSpecialisation::getSpecialisedDocumentController<RtmAraDocumentController>(dc))
        {
            araRegionsModel = spec->getModel();
            araAttached.store(true, std::memory_order_release);
        }
    }
#endif
}

void RtmSendAudioProcessor::allocateRing()
{
    const int cap = static_cast<int>(std::round(bufferSeconds * sampleRateHz));
    ring.prepare(numChannels, cap);
    // Pre-size the loop + triggered capture buffers to the ring's
    // capacity too, so the audio thread's insert() calls don't have
    // to reallocate on the hot path.  std::vector::insert still
    // _may_ allocate, but this pre-reserve covers the common case
    // (a 30-second loop in a 30-second ring), which is the one that
    // used to glitch.
    loopCapture.samples.assign(static_cast<size_t>(numChannels), {});
    triggered.samples.assign(static_cast<size_t>(numChannels), {});
    for (auto& ch : loopCapture.samples) ch.reserve(static_cast<size_t>(cap));
    for (auto& ch : triggered.samples)   ch.reserve(static_cast<size_t>(cap));
}

void RtmSendAudioProcessor::releaseResources()
{
    // Host closing the plug-in window or deactivating the bus - reset
    // every capture flag so a later open / activate doesn't inherit
    // stale "Rec in progress" or "loop complete" state.
    loopCapture.active.store(false,   std::memory_order_release);
    loopCapture.complete.store(false, std::memory_order_release);
    triggered.active.store(false,     std::memory_order_release);
    triggered.complete.store(false,   std::memory_order_release);
    loopPointsSeen.store(false,       std::memory_order_release);
    // Do NOT clear samples vectors here - a later getStateInformation
    // could still reference a buffered capture.  The vectors are
    // cleared on the next prepareToPlay via allocateRing().

    // 1.1.0 spike: tell the hosted plugin to release its allocations
    // so it can be re-prepared cleanly on the next prepareToPlay.
    //
    // 5.7.x audit fix: serialise via getCallbackLock() — same race as
    // prepareToPlay, see the comment there. releaseResources tears
    // down the hosted plugin's internal allocations; running it during
    // an in-flight hp->processBlock call corrupts buffers Pro-Q is
    // mid-write into.
    if (hostedPlugin)
    {
        const juce::ScopedLock sl(getCallbackLock());
        hostedPlugin->releaseResources();
    }
}

bool RtmSendAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto& in = layouts.getMainInputChannelSet();
    const auto& out = layouts.getMainOutputChannelSet();
    if (in.isDisabled() || out.isDisabled()) return false;
    // mono->mono or stereo->stereo only; don't change channel count.
    return in == out && (in == juce::AudioChannelSet::mono() || in == juce::AudioChannelSet::stereo());
}

void RtmSendAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numInput = buffer.getNumChannels();
    const int numFrames = buffer.getNumSamples();

    // 1.1.0 spike: route the bus through the hosted plugin if one is
    // loaded and hosting is enabled. We deliberately process BEFORE
    // the ring write so the captured 30 s reflects the chain - that's
    // the point of letting the user load Pro-Q here. The rawptr read
    // is safe because UI-thread load/unload pauses hosting (atomic
    // false) before swapping the unique_ptr; the audio thread either
    // sees the old instance with hosting=true or the new one with
    // hosting=true after re-enable, never a torn pointer.
    // 5.7.x audit fix: gate on BOTH hostingEnabled (user intent) AND
    // !hostedPluginFaulted (no exception in flight). Pre-fix a thrown
    // processBlock cleared hostingEnabled directly, which the UI then
    // read as "user turned hosting off" with no recovery path. Now
    // the two states are distinct.
    if (hostingEnabled.load(std::memory_order_acquire)
        && ! hostedPluginFaulted.load(std::memory_order_acquire))
    {
        if (auto* hp = hostedPlugin.get())
        {
            hostedMidiScratch.clear();
            // Wrapper try/catch - JUCE plugins can throw during init
            // weirdness. Drop the plugin from the chain instead of
            // killing the host. The UI polls didHostedPluginFault()
            // and surfaces a "Pro-Q faulted, reload it" state.
            try {
                hp->processBlock(buffer, hostedMidiScratch);
            } catch (...) {
                hostedPluginFaulted.store(true, std::memory_order_release);
            }
        }
    }

    const float* channelPtrs[32] = { nullptr };
    for (int c = 0; c < numInput && c < 32; ++c)
        channelPtrs[c] = buffer.getReadPointer(c);

    // Ring buffer - always on, no allocation on this thread.
    ring.writeBlock(channelPtrs, std::min(numInput, 32), numFrames);

    // Loop-region capture. Prefer AudioPlayHead::getPosition() (JUCE
    // 7.1+); fall back to CurrentPositionInfo on older JUCE. Hosts
    // that don't expose loop info leave loopPointsSeen false and the
    // UI disables the mode.
    if (auto* ph = getPlayHead())
    {
        bool looping = false;
        double timeSec = 0.0;
        double loopStartPpq = 0.0, loopEndPpq = 0.0, curPpq = 0.0;
        double bpm = 0.0;

#if JUCE_VERSION >= 0x070100
        if (auto pos = ph->getPosition())
        {
            looping = pos->getIsLooping();
            if (auto lp = pos->getLoopPoints())
            {
                loopStartPpq = lp->ppqStart;
                loopEndPpq = lp->ppqEnd;
                loopPointsSeen.store(true, std::memory_order_release);
            }
            if (pos->getPpqPosition())  curPpq = *pos->getPpqPosition();
            if (pos->getTimeInSeconds()) timeSec = *pos->getTimeInSeconds();
            if (pos->getBpm()) bpm = *pos->getBpm();
        }
#else
        juce::AudioPlayHead::CurrentPositionInfo info;
        if (ph->getCurrentPosition(info))
        {
            looping = info.isLooping;
            loopStartPpq = info.ppqLoopStart;
            loopEndPpq   = info.ppqLoopEnd;
            curPpq = info.ppqPosition;
            timeSec = info.timeInSeconds;
            bpm = info.bpm;
            if (loopStartPpq < loopEndPpq) loopPointsSeen.store(true, std::memory_order_release);
        }
#endif
        // Persist BPM so writeSidecar can tag captures with the project tempo.
        if (bpm > 0.0) lastBpm.store(bpm, std::memory_order_relaxed);

        const Source curSource = source.load(std::memory_order_acquire);
        if (curSource == Source::LoopRegion && looping && loopStartPpq < loopEndPpq)
        {
            // 5.3.0 (audit P0 #1) - sample-accurate boundary trim.
            // Pre-5.3 we copied the whole input block from sample 0
            // whenever curPpq >= loopStartPpq. That misses up to one
            // full block at each boundary (~10.7 ms at 48k/512), enough
            // to ruin a phase-cancel A/B against the source.
            //
            // The fix: PPQ → samples conversion via host BPM, then
            // trim leading samples at loop start and trailing samples
            // at loop end. ARA path is sample-accurate by construction
            // and is unaffected; this brings the live-capture path
            // up to the same standard.
            const double samplesPerSec = sampleRateHz;
            const double samplesPerPpq = (bpm > 0.0)
                ? (samplesPerSec * 60.0 / (bpm * 1.0))  // ppq = quarter-note
                : 0.0;
            const double blockPpq = (samplesPerPpq > 0.0)
                ? (static_cast<double>(numFrames) / samplesPerPpq)
                : 0.0;
            const double curEndPpq = curPpq + blockPpq;

            const bool blockTouchesLoop =
                samplesPerPpq > 0.0 &&
                curEndPpq > loopStartPpq && curPpq < loopEndPpq;
            const bool inside = blockTouchesLoop;

            if (inside && !loopCapture.active.load(std::memory_order_acquire))
            {
                // New loop cycle - clear without reallocating.
                for (auto& ch : loopCapture.samples) ch.clear();
                loopCapture.startPpq = loopStartPpq;
                loopCapture.endPpq = loopEndPpq;
                loopCapture.startTimeSec = timeSec;
                loopCapture.complete.store(false, std::memory_order_release);
                loopCapture.active.store(true, std::memory_order_release);
            }
            if (loopCapture.active.load(std::memory_order_acquire))
            {
                // Sub-block offsets - both clamped to [0, numFrames].
                const double leadPpq = std::max(0.0, loopStartPpq - curPpq);
                const double tailPpq = std::max(0.0, curEndPpq - loopEndPpq);
                int offsetIn = static_cast<int>(std::round(leadPpq * samplesPerPpq));
                int trim     = static_cast<int>(std::round(tailPpq * samplesPerPpq));
                offsetIn = std::min(std::max(0, offsetIn), numFrames);
                trim     = std::min(std::max(0, trim),     numFrames);
                const int copyLen = std::max(0, numFrames - offsetIn - trim);

                for (int c = 0; c < std::min(numInput, numChannels); ++c)
                {
                    // Guard against processBlock firing before prepareToPlay
                    // has allocated the channel vectors (can happen in some
                    // hosts including Ableton on project load).
                    if (static_cast<size_t>(c) >= loopCapture.samples.size()) continue;
                    auto& dest = loopCapture.samples[static_cast<size_t>(c)];
                    const size_t headroom = dest.capacity() - dest.size();
                    const size_t toCopy = std::min<size_t>(static_cast<size_t>(copyLen), headroom);
                    if (toCopy > 0) {
                        const float* src = buffer.getReadPointer(c) + offsetIn;
                        dest.insert(dest.end(), src, src + toCopy);
                    }
                }

                // Block contains the loop end → close the capture.
                const bool blockEndsLoop = (curEndPpq >= loopEndPpq);
                if (blockEndsLoop)
                {
                    loopCapture.endTimeSec = timeSec;
                    loopCapture.active.store(false, std::memory_order_release);
                    loopCapture.complete.store(true, std::memory_order_release);
                }
            }
        }
    }

    // Triggered-region capture. Accumulates while active, ignores
    // host transport entirely. Works in any DAW.
    if (triggered.active.load(std::memory_order_acquire))
    {
        for (int c = 0; c < std::min(numInput, numChannels); ++c)
        {
            if (static_cast<size_t>(c) >= triggered.samples.size()) continue;
            auto& dest = triggered.samples[static_cast<size_t>(c)];
            // Same headroom discipline as the loop path - never
            // reallocate on the audio thread.
            const size_t headroom = dest.capacity() - dest.size();
            const size_t toCopy = std::min<size_t>(static_cast<size_t>(numFrames), headroom);
            if (toCopy > 0) {
                dest.insert(dest.end(), buffer.getReadPointer(c),
                             buffer.getReadPointer(c) + toCopy);
            }
        }
    }
    // Signal passes through untouched.
}

void RtmSendAudioProcessor::startTriggeredCapture()
{
    // Mutating triggered.samples while the audio thread may be inside
    // its insert path is the data race the codex audit flagged. Take
    // the host's audio-callback lock so processBlock can't be running
    // concurrently - JUCE's VST3/AU/AAX wrappers each acquire this
    // lock around processBlock (juce_VST3_Wrapper.cpp / juce_AU_Wrapper.mm).
    const juce::ScopedLock sl(getCallbackLock());

    if (triggered.samples.size() != static_cast<size_t>(numChannels))
    {
        // Sample-rate change grew channel count mid-session - rebuild.
        const int cap = static_cast<int>(std::round(bufferSeconds * sampleRateHz));
        triggered.samples.assign(static_cast<size_t>(numChannels), {});
        for (auto& ch : triggered.samples) ch.reserve(static_cast<size_t>(cap));
    }
    else
    {
        for (auto& ch : triggered.samples) ch.clear();
    }
    triggered.complete.store(false, std::memory_order_release);
    triggered.active.store(true, std::memory_order_release);
    setLastStatusLocked ("Triggered capture running...");
}

void RtmSendAudioProcessor::stopTriggeredCapture()
{
    triggered.active.store(false, std::memory_order_release);
    triggered.complete.store(true, std::memory_order_release);
    setLastStatusLocked ("Triggered capture stopped.");
}

void RtmSendAudioProcessor::setBufferSeconds(double s)
{
    // 5.2.2 (audit P1 #12): explicit NaN guard. jlimit doesn't catch it.
    if (!std::isfinite(s)) s = 30.0;
    s = juce::jlimit(1.0, kMaxBufferSeconds, s);
    if (std::abs(s - bufferSeconds) < 0.01) return;
    // The ring (and pre-sized region buffers) reallocate inside
    // allocateRing(); processBlock is reading/writing those vectors.
    // Hold the audio-callback lock so the host can't dispatch a block
    // while we're swapping storage out from under it. Codex audit P0.
    const juce::ScopedLock sl(getCallbackLock());
    bufferSeconds = s;
    allocateRing();
}

// ── Atomic exclusive file creation with symlink rejection ──────────────
//
// JUCE's FileOutputStream calls fopen()/CreateFile() internally and cannot
// carry O_NOFOLLOW, leaving a TOCTOU window between writeTargetIsSafe's
// lstat() check and the subsequent open.  The fix: open with
// O_CREAT|O_EXCL|O_NOFOLLOW in a single syscall so that:
//   - O_EXCL  → the file must not pre-exist (atomic check+create)
//   - O_NOFOLLOW → the kernel rejects the open if the last path
//                  component is a symlink (errno ELOOP on Linux, macOS)
//
// Windows note: CreateFile with FILE_FLAG_OPEN_REPARSE_POINT gives
// equivalent protection, but the timestamp+serial naming makes pre-
// planting a named file very hard on Windows and symlink attacks there
// require admin privileges by default, so we keep the stat-based fallback
// for now.  See DECISIONS.md item 7 if a Windows O_NOFOLLOW equivalent
// is needed.

#if ! JUCE_WINDOWS

// Opens `f` exclusively for writing in one atomic syscall.
// Returns a valid fd (>= 0) on success, -1 on failure.
//   EEXIST → path already exists (collision or pre-planted file/symlink)
//   ELOOP  → O_NOFOLLOW fired: the last path component is a symlink
//   ENOENT → parent directory missing (shouldn't happen — incomingFolder()
//             creates it, but a concurrent rmdir could race)
static int openAtomicExcl (const juce::File& f) noexcept
{
    return ::open (f.getFullPathName().toRawUTF8(),
                   O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                   S_IRUSR | S_IWUSR);
}

// POSIX-fd-backed OutputStream so AudioFormatWriter can write to an fd
// that was opened with O_NOFOLLOW.  Owns the fd; closes on destruction.
class FdOutputStream final : public juce::OutputStream
{
public:
    explicit FdOutputStream (int fd_) noexcept : fd (fd_) {}
    ~FdOutputStream() override { if (fd >= 0) ::close (fd); }
    bool openedOk() const noexcept { return fd >= 0; }
    void flush() override { if (fd >= 0) ::fsync (fd); }
    juce::int64 getPosition() override { return pos; }
    bool setPosition (juce::int64 newPos) override
    {
        if (fd < 0) return false;
        const auto r = ::lseek (fd, static_cast<off_t> (newPos), SEEK_SET);
        if (r < 0) return false;
        pos = static_cast<juce::int64> (r);
        return true;
    }
    bool write (const void* data, size_t n) override
    {
        if (fd < 0 || n == 0) return n == 0;
        const auto r = ::write (fd, data, n);
        if (r < 0) return false;
        pos += static_cast<juce::int64> (r);
        return static_cast<size_t> (r) == n;
    }
private:
    int fd;
    juce::int64 pos { 0 };
    JUCE_DECLARE_NON_COPYABLE (FdOutputStream)
};

#else // JUCE_WINDOWS — stat-based fallback (pre-5.8 behaviour)

// 5.3.0 (audit P0 #4): refuse to write to a path another process
// pre-planted with a symlink. The timestamp+serial naming makes
// pre-planting hard; this is a best-effort check, not atomic.
static bool writeTargetIsSafe (const juce::File& f)
{
    if (! f.exists())       return true;   // fresh write
    if (f.isSymbolicLink()) return false;  // attacker-pre-planted
    return false;                          // any other pre-existing file is suspect
}

#endif // ! JUCE_WINDOWS

juce::File RtmSendAudioProcessor::incomingFolder() const
{
    // 5.2.2 (audit P1 #11): handle macOS App Sandbox + locked-down
    // Windows. Logic Pro X is sandboxed so writes to $HOME go to the
    // container rather than real ~. We surface a clear error in
    // lastStatus instead of silently writing to a folder RTMcompare
    // can't see.
    auto home = juce::File::getSpecialLocation(juce::File::userHomeDirectory);
    auto folder = home.getChildFile(".rtm").getChildFile("incoming");
    // 5.3.0 (audit P0 #4): refuse if the parent path itself is a
    // symbolic link - receiver-side `read-audio-file` realpath-resolves,
    // so an attacker symlinking ~/.rtm/incoming → /tmp/their-folder
    // would otherwise win the receiver's trust.
    if (folder.exists() && folder.isSymbolicLink()) {
        return juce::File(); // empty File → caller's exists() check fails
    }
    if (!folder.exists())
    {
        const auto result = folder.createDirectory();
        if (result.failed())
        {
            // No way to log from a const method without mutable state;
            // the WAV write that follows will surface a generic
            // "Could not write" - at least the folder is created if
            // possible on the next attempt.
        }
    }
    return folder;
}

// 5.2.2 (audit P0 #3): host-supplied strings (sessionName, regionName,
// audioSourceName, host description) are written into the JSON sidecar.
// A malicious DAW project could craft these to be JSON-escape-safe but
// content-malicious - the receiver (RTMcompare) renders them in panels
// and tooltips; if any path ever does dangerouslySetInnerHTML this is
// XSS into the analyser. Cap length + strip control chars / non-printable.
static juce::String sanitiseHostString(const juce::String& s, int maxLen = 200)
{
    juce::String out;
    out.preallocateBytes((size_t) std::min(maxLen, s.length()) * 4);
    int kept = 0;
    for (auto ch : s)
    {
        if (kept >= maxLen) break;
        // Allow printable ASCII + common Latin extended; strip control
        // chars, NULs, and structural-looking sequences.
        if (ch < 0x20 || ch == 0x7F) continue;
        // Strip Unicode BiDi control characters — these can visually
        // reorder text in rendered UI panels and terminals without
        // appearing in the raw string, enabling spoofing attacks
        // (CVE-2021-42574 "Trojan Source" class). Strip the full
        // Unicode Bidirectional control set:
        //   U+200E LEFT-TO-RIGHT MARK … U+200F RIGHT-TO-LEFT MARK
        //   U+202A–U+202E embedding/override controls
        //   U+2066–U+2069 isolate controls
        //   U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM
        if ((ch >= 0x200E && ch <= 0x202E) ||
            (ch >= 0x2066 && ch <= 0x2069) ||
            ch == 0xFEFF) continue;
        out += ch;
        kept++;
    }
    return out;
}

bool RtmSendAudioProcessor::writeWav(const juce::File& out,
                                     const std::vector<std::vector<float>>& samplesByChannel,
                                     double sr) const
{
    if (samplesByChannel.empty()) return false;
    const int channels = static_cast<int>(samplesByChannel.size());
    const int frames   = static_cast<int>(samplesByChannel[0].size());

    juce::AudioBuffer<float> buf(channels, frames);
    for (int c = 0; c < channels; ++c)
        buf.copyFrom(c, 0, samplesByChannel[static_cast<size_t>(c)].data(), frames);

    juce::WavAudioFormat format;

#if ! JUCE_WINDOWS
    // 5.8.0: O_CREAT|O_EXCL|O_NOFOLLOW — atomic exclusive create with
    // symlink rejection.  Eliminates the TOCTOU race that existed between
    // writeTargetIsSafe()'s lstat() and the subsequent fopen() inside
    // JUCE's FileOutputStream.  If the path was pre-planted (symlink or
    // any other file), ::open returns -1 and we bail before allocating
    // the AudioFormatWriter.
    const int fd = openAtomicExcl (out);
    auto stream  = std::make_unique<FdOutputStream> (fd);
    if (! stream->openedOk()) return false;
#else
    if (! writeTargetIsSafe (out)) return false;
    std::unique_ptr<juce::FileOutputStream> stream (out.createOutputStream());
    if (! stream) return false;
#endif

    std::unique_ptr<juce::AudioFormatWriter> writer (
        format.createWriterFor (stream.get(), sr,
                                static_cast<unsigned int>(channels), 32, {}, 0));
    // Only release stream ownership after we know the writer accepted it.
    if (! writer) return false;
    stream.release();  // writer takes ownership
    const bool ok = writer->writeFromAudioSampleBuffer (buf, 0, frames);
    writer.reset();    // flush + close fd
    return ok;
}

bool RtmSendAudioProcessor::writeSidecar(const juce::File& out,
                                         int channels, double sr, int frames, Route route,
                                         const juce::String& capturedAt) const
{
    // 5.3.0 (audit P0 #4): same symlink-safety as writeWav.
    if (! writeTargetIsSafe(out)) return false;
    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
    // 5.3.0: explicit protocol version on every sidecar. Tolerant
    // additive - receiver ignores unknown fields but treats a
    // higher major as "warn but still ingest." See docs/protocol.md.
    obj->setProperty("protocolVersion", 1);
    // 5.2.2 (audit P0 #3): sanitise + length-cap every host-supplied
    // string before it lands in the sidecar JSON. Stops a malicious
    // DAW project from injecting weird content the receiver might
    // render unsafely.
    obj->setProperty("sessionName", sanitiseHostString(sessionName));
    obj->setProperty("daw", sanitiseHostString(juce::PluginHostType().getHostDescription()));
    obj->setProperty("sampleRate", sr);
    obj->setProperty("channels", channels);
    obj->setProperty("durationSec", static_cast<double>(frames) / sr);
    obj->setProperty("createdAt",
                     juce::Time::getCurrentTime().toISO8601(true));
    obj->setProperty("pluginVersion", JucePlugin_VersionString);
    // Wire-format values read by RtmIncomingBanner.tsx. Unknown
    // values fall back to the notification chip picker.
    const char* routeTag = "single";
    switch (route) {
        case Route::Single:   routeTag = "single";   break;
        case Route::CompareB: routeTag = "compareB"; break;
        case Route::Batch:    routeTag = "batch";    break;
    }
    obj->setProperty("route", juce::String(routeTag));

    // Capture-source tag for the notification chip:
    // "ring" | "loop" | "triggered" | "ara".
    const Source srcSnapshot = source.load(std::memory_order_acquire);
    const char* sourceTag = "ring";
    switch (srcSnapshot) {
        case Source::LoopRegion:      sourceTag = "loop";      break;
        case Source::TriggeredRegion: sourceTag = "triggered"; break;
        case Source::AraRegion:       sourceTag = "ara";       break;
        case Source::LastNSeconds:
        default:                       sourceTag = "ring";     break;
    }
    obj->setProperty("source", juce::String(sourceTag));

    // BPM: set from the last processBlock that had a valid playhead.
    // Omitted if the host never reported BPM (stand-alone use, etc.).
    const double bpmSnap = lastBpm.load(std::memory_order_relaxed);
    if (bpmSnap > 0.0)
        obj->setProperty("bpm", bpmSnap);

    // Whether the hosted EQ plugin was bypassed at capture time.
    // If no plugin is loaded, omit the field rather than writing false
    // (the receiver can distinguish "bypassed" from "no plugin").
    if (hostingEnabled.load(std::memory_order_acquire))
        obj->setProperty("hostedPluginBypassed",
                         hostedPluginBypassed.load(std::memory_order_acquire));

    // capturedAt: actual moment the audio content was captured, which
    // differs from createdAt (the file-write time) by up to bufferSeconds
    // for ring-buffer grabs.
    obj->setProperty("capturedAt", capturedAt);

    // ARA drops carry region name + time bounds so the banner can
    // show "From: Wavelab - Track 03 - 2:14-5:31".
#if RTM_ARA_ENABLED
    // 5.7.x audit fix: snapshot under the lock, use the local. We
    // can't hold the lock across findRegion (model traversal — unbounded).
    juce::String araIdSnap;
    {
        const juce::ScopedLock sl (stringFieldsLock);
        araIdSnap = selectedAraRegionId;
    }
    if (srcSnapshot == Source::AraRegion && araIdSnap.isNotEmpty())
    {
        if (auto region = araRegionsModel->findRegion(araIdSnap))
        {
            juce::DynamicObject::Ptr araObj = new juce::DynamicObject();
            araObj->setProperty("regionName", sanitiseHostString(region->name));
            araObj->setProperty("regionStartSec", region->startSec);
            araObj->setProperty("regionEndSec", region->endSec);
            araObj->setProperty("regionSourceName", sanitiseHostString(region->audioSourceName));
            obj->setProperty("ara", juce::var(araObj.get()));
        }
    }
#endif

    const auto json = juce::JSON::toString (juce::var (obj.get()), true);

#if ! JUCE_WINDOWS
    // 5.8.0: atomic exclusive write with O_NOFOLLOW — same rationale as writeWav.
    const int fd = openAtomicExcl (out);
    if (fd < 0) return false;
    const juce::CharPointer_UTF8 utf8 = json.toUTF8();
    const auto len = static_cast<ssize_t> (strlen (utf8.getAddress()));
    const bool ok = (len == 0) || (::write (fd, utf8.getAddress(), static_cast<size_t>(len)) == len);
    ::close (fd);
    return ok;
#else
    // MED-5: write-to-tmp then atomic rename to close TOCTOU window.
    {
        auto tmp = out.getSiblingFile (out.getFileName() + ".tmp");
        tmp.deleteFile();
        if (!tmp.replaceWithText (json)) return false;
        if (!tmp.moveFileTo (out)) { tmp.deleteFile(); return false; }
        return true;
    }
#endif
}

juce::String RtmSendAudioProcessor::sendSnapshotToRtm(Route route, juce::String& errorMsgOut)
{
    errorMsgOut = {};

    std::vector<std::vector<float>> snapshot;

    // ARA regions carry their own SR (the source's), which may
    // differ from the plugin's prepareToPlay rate - hosts can
    // reconfigure freely.
    double snapshotSr = sampleRateHz;

    // Each branch yields a de-interleaved snapshot; the WAV +
    // sidecar + .ready write is shared below.
    const Source curSource = source.load(std::memory_order_acquire);
    switch (curSource)
    {
        case Source::AraRegion:
        {
#if RTM_ARA_ENABLED
            // 5.7.x audit fix: snapshot the ARA id once under the lock.
            // readRegionSamples is heavy; we must not hold the lock
            // across it.
            juce::String araIdSnap;
            {
                const juce::ScopedLock sl (stringFieldsLock);
                araIdSnap = selectedAraRegionId;
            }
            if (araIdSnap.isEmpty())
            {
                errorMsgOut = "Pick a region from the dropdown first.";
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            auto* dc = ARA::PlugIn::PlugInExtension::getDocumentController();
            if (dc == nullptr)
            {
                errorMsgOut = "ARA not active in this host - dropdown should be greyed out.";
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            auto* spec = juce::ARADocumentControllerSpecialisation::getSpecialisedDocumentController<RtmAraDocumentController>(dc);
            if (spec == nullptr)
            {
                errorMsgOut = "ARA document controller not available.";
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            int sr = 0;
            juce::String err;
            if (!spec->readRegionSamples(araIdSnap, snapshot, sr, err))
            {
                errorMsgOut = err.isNotEmpty() ? err : juce::String("Failed to read region samples.");
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            snapshotSr = static_cast<double>(sr);
            break;
#else
            errorMsgOut = "This build doesn't include ARA2 - rebuild with the ARA SDK present.";
            setLastStatusLocked (errorMsgOut);
            return {};
#endif
        }

        case Source::LoopRegion:
        {
            if (!loopCapture.complete.load(std::memory_order_acquire) || loopCapture.samples.empty())
            {
                errorMsgOut = "No loop region captured yet - set loop points in your DAW and play through the loop at least once.";
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            snapshot = loopCapture.samples;
            break;
        }
        case Source::TriggeredRegion:
        {
            if (triggered.active.load(std::memory_order_acquire))
            {
                errorMsgOut = "Stop the triggered capture first - click Stop, then Send.";
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            if (triggered.samples.empty() || !triggered.complete.load(std::memory_order_acquire))
            {
                errorMsgOut = "No region captured - hit Record, let audio play, then Stop.";
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            snapshot = triggered.samples;
            break;
        }
        case Source::LastNSeconds:
        default:
        {
            const int wantFrames = static_cast<int>(std::round(bufferSeconds * sampleRateHz));
            const int got = ring.readLastFrames(snapshot, wantFrames);
            if (got < static_cast<int>(std::round(0.5 * sampleRateHz)))
            {
                errorMsgOut = "Not enough audio buffered yet - let the track play for a few seconds.";
                setLastStatusLocked (errorMsgOut);
                return {};
            }
            // 5.2.2 (audit P0 #2): the previous code computed
            // `drop = wantFrames - got` and erased `drop` samples off
            // the FRONT of the snapshot. But `readLastFrames` already
            // returns exactly `n = min(want, capacity)` samples sized
            // to `n` with leading silence padding. Erasing the head
            // discards real audio. The shipped WAV was both shorter
            // than requested AND missing its earliest content. Fix:
            // trust readLastFrames' return - no drop, no erase.
            break;
        }
    }
    // capturedAt: for ring-buffer grabs the audio content started
    // `bufferSeconds` ago; for ARA / loop / triggered captures the
    // content IS the current moment (read or just completed).
    const juce::String capturedAt =
        (curSource == Source::LastNSeconds)
        ? (juce::Time::getCurrentTime() - juce::RelativeTime(bufferSeconds)).toISO8601(true)
        : juce::Time::getCurrentTime().toISO8601(true);

    return finishSendFromSamples (std::move(snapshot), snapshotSr, route, errorMsgOut, capturedAt);
}

juce::String RtmSendAudioProcessor::finishSendFromSamples(
    std::vector<std::vector<float>> samples,
    double sampleRate,
    Route route,
    juce::String& errorMsgOut,
    const juce::String& capturedAt)
{
    const int finalFrames = static_cast<int>(samples.empty() ? 0 : samples[0].size());
    // 0.5 s minimum: BS.1770-4 integrated loudness requires at least ~400 ms
    // of un-gated audio for a meaningful LUFS-I reading.  Anything shorter
    // produces unreliable loudness / LRA / spectral analysis.
    if (finalFrames < static_cast<int>(std::round(0.5 * sampleRate)))
    {
        errorMsgOut = "Captured region too short (< 0.5 s) — LUFS measurement requires at least 0.5 s.";
        setLastStatusLocked (errorMsgOut);
        return {};
    }

    // Sortable base name: timestamp + sanitised session.  Millisecond
    // precision on the stamp + a per-process counter so two sends in
    // the same second don't overwrite each other.
    const auto now   = juce::Time::getCurrentTime();
    const auto stamp = now.formatted("%Y%m%d-%H%M%S")
                     + juce::String::formatted("-%03d", now.getMilliseconds());
    // LOW-5: use the class member (not a function-local static) so each
    // plugin instance has its own counter.
    const int serial = sendCounter.fetch_add(1, std::memory_order_relaxed);
    juce::String safeSession;
    {
        const juce::ScopedLock sl (stringFieldsLock);
        safeSession = sessionName.retainCharacters(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_");
    }
    const auto base = juce::String("rtm-") + stamp
                    + "-" + juce::String::formatted("%04d", serial & 0xFFFF)
                    + "-" + safeSession;

    auto folder  = incomingFolder();
    auto wav     = folder.getChildFile(base + ".wav");
    auto sidecar = folder.getChildFile(base + ".rtm.json");
    auto ready   = folder.getChildFile(base + ".ready");

    // Audio first, then sidecar, .ready last.  The watcher keys on
    // .ready so it never opens a half-written WAV.  Any failure along
    // the way cleans up the partial artefacts so a retry lands clean.
    if (!writeWav(wav, samples, sampleRate))
    {
        errorMsgOut = "Could not write WAV to " + wav.getFullPathName();
        setLastStatusLocked (errorMsgOut);
        return {};
    }
    const juce::String capturedAtVal = capturedAt.isNotEmpty()
        ? capturedAt
        : juce::Time::getCurrentTime().toISO8601(true);
    if (!writeSidecar(sidecar, static_cast<int>(samples.size()), sampleRate, finalFrames,
                      route, capturedAtVal))
    {
        wav.deleteFile();
        sidecar.deleteFile(); // MED-6: clean up any partial sidecar created before failure
        errorMsgOut = "Could not write sidecar JSON to " + sidecar.getFullPathName();
        setLastStatusLocked (errorMsgOut);
        return {};
    }

    // .ready marker binds WAV + sidecar via SHA-256 so the receiver can
    // verify the files weren't substituted between write and pickup.
    juce::var readyObj;
    {
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty("protocolVersion", 1);
        juce::FileInputStream wavIn(wav);
        juce::FileInputStream jsonIn(sidecar);
        if (wavIn.openedOk())
            o->setProperty("wavSha256", juce::SHA256(wavIn).toHexString());
        if (jsonIn.openedOk())
            o->setProperty("jsonSha256", juce::SHA256(jsonIn).toHexString());
        o->setProperty("createdAt", juce::Time::getCurrentTime().toISO8601(true));
        readyObj = juce::var(o.get());
    }
    const auto readyJson = juce::JSON::toString (readyObj, true);
    bool readyOk = false;
#if ! JUCE_WINDOWS
    {
        const int rfd = openAtomicExcl (ready);
        if (rfd >= 0)
        {
            const juce::CharPointer_UTF8 rb = readyJson.toUTF8();
            const auto rlen = static_cast<ssize_t> (strlen (rb.getAddress()));
            readyOk = (rlen == 0) ||
                      (::write (rfd, rb.getAddress(), static_cast<size_t>(rlen)) == rlen);
            ::close (rfd);
        }
    }
#else
    // MED-5: avoid TOCTOU between writeTargetIsSafe check and write.
    // Write to a sibling .tmp file then atomically rename — NTFS rename
    // is single-syscall and immune to the check-then-act race.
    {
        auto tmpReady = ready.getSiblingFile (ready.getFileName() + ".tmp");
        tmpReady.deleteFile();
        if (tmpReady.replaceWithText (readyJson))
            readyOk = tmpReady.moveFileTo (ready);
        if (!readyOk) tmpReady.deleteFile();
    }
#endif
    if (! readyOk)
    {
        wav.deleteFile();
        sidecar.deleteFile();
        errorMsgOut = "Could not write .ready marker to " + ready.getFullPathName();
        setLastStatusLocked (errorMsgOut);
        return {};
    }

    juce::String routeStr;
    switch (route) {
        case Route::Single:   routeStr = "Single-file";       break;
        case Route::CompareB: routeStr = "Compare (File B)";  break;
        case Route::Batch:    routeStr = "Album batch";       break;
    }
    setLastStatusLocked ("Sent to RTM — " + routeStr + " — " + wav.getFileName());
    return wav.getFullPathName();
}

void RtmSendAudioProcessor::sendSnapshotToRtmAsync(
    Route route, std::function<void(juce::String, juce::String)> onDone)
{
#if RTM_ARA_ENABLED
    if (source.load(std::memory_order_acquire) == Source::AraRegion)
    {
        // Snapshot the region ID under the lock, then release.
        juce::String araIdSnap;
        {
            const juce::ScopedLock sl (stringFieldsLock);
            araIdSnap = selectedAraRegionId;
        }
        if (araIdSnap.isEmpty())
        {
            const juce::String err = "Pick a region from the dropdown first.";
            setLastStatusLocked (err);
            onDone ({}, err);
            return;
        }
        auto* dc = ARA::PlugIn::PlugInExtension::getDocumentController();
        if (dc == nullptr)
        {
            const juce::String err = "ARA not active in this host.";
            setLastStatusLocked (err);
            onDone ({}, err);
            return;
        }
        auto* spec = juce::ARADocumentControllerSpecialisation
            ::getSpecialisedDocumentController<RtmAraDocumentController>(dc);
        if (spec == nullptr)
        {
            const juce::String err = "ARA document controller not available.";
            setLastStatusLocked (err);
            onDone ({}, err);
            return;
        }

        setLastStatusLocked ("Reading ARA region…");

        // Keep a weak reference so the completion lambda is safe if the
        // processor is destroyed before the background read finishes.
        juce::WeakReference<RtmSendAudioProcessor> weakThis (this);

        const bool started = spec->readRegionSamplesAsync (
            araIdSnap,
            // onProgress — background thread; post status updates safely
            [weakThis] (float p)
            {
                const int pct = static_cast<int>(p * 100.0f);
                juce::MessageManager::callAsync ([weakThis, pct]
                {
                    if (auto* self = weakThis.get())
                        self->setLastStatusLocked ("Reading ARA region… " +
                                                   juce::String(pct) + "%");
                });
            },
            // onDone — message thread
            [weakThis, route, onDone = std::move(onDone)]
            (RtmAraDocumentController::SamplesVec samples, int sr, juce::String readErr) mutable
            {
                auto* self = weakThis.get();
                if (self == nullptr) { onDone ({}, "Plugin was unloaded."); return; }
                if (readErr.isNotEmpty()) { onDone ({}, readErr); return; }

                // Finish the send with the collected samples.
                // Re-use the existing sync path for the write half only:
                // temporarily inject the samples via the triggered-region
                // buffer, flip the source flag, then restore everything.
                // Simpler: just call the common write helper inline here.
                juce::String err;
                juce::String path = self->finishSendFromSamples (
                    std::move(samples), static_cast<double>(sr), route, err);
                onDone (path, err);
            });

        if (! started)
        {
            const juce::String err = "An ARA read is already in progress — please wait.";
            setLastStatusLocked (err);
            onDone ({}, err);
        }
        return;
    }
#endif

    // Non-ARA sources: synchronous send, call onDone immediately.
    juce::String err;
    juce::String path = sendSnapshotToRtm (route, err);
    onDone (path, err);
}

void RtmSendAudioProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
    obj->setProperty("bufferSeconds", bufferSeconds);
    // 5.7.x audit fix: snapshot the locked-string fields once for the
    // serialiser. Avoids holding the lock across JSON encoding.
    juce::String sessionNameSnap, araIdSnap;
    {
        const juce::ScopedLock sl (stringFieldsLock);
        sessionNameSnap = sessionName;
        araIdSnap = selectedAraRegionId;
    }
    obj->setProperty("sessionName", sessionNameSnap);
    obj->setProperty("source", static_cast<int>(source.load(std::memory_order_acquire)));
    // Persist the ARA region the user had selected. Without this, a
    // session saved with Source=ARA + "Track 03" selected would come
    // back with Source=ARA but an empty region id, and the next Send
    // would fail with "pick a region first."
    obj->setProperty("selectedAraRegionId", araIdSnap);

    // 1.1.0+: persist the hosted plugin so Wavelab restoring a
    // session brings back the user's loaded EQ. Without this, any
    // host operation that destroys+recreates RTMsend's processor
    // (window close in some configs, "Apply Master Section" preset
    // load, plugin chain reorder) silently empties our slot and
    // the user has to re-pick. We save the plugin's identifier
    // string + its own state blob; setStateInformation re-creates
    // the instance and pumps the blob back in.
    if (hostedPlugin)
    {
        const auto desc = hostedPlugin->getPluginDescription();
        obj->setProperty("hostedPluginId", desc.createIdentifierString());
        obj->setProperty("hostedPluginName", desc.descriptiveName.isNotEmpty()
                                                 ? desc.descriptiveName : desc.name);
        juce::MemoryBlock hostedState;
        hostedPlugin->getStateInformation(hostedState);
        obj->setProperty("hostedPluginState", hostedState.toBase64Encoding());
    }

    const auto json = juce::JSON::toString(juce::var(obj.get()), false);
    destData.append(json.toRawUTF8(), json.getNumBytesAsUTF8());
}

void RtmSendAudioProcessor::setStateInformation(const void* data, int size)
{
    // Wavelab (and other Steinberg hosts) sometimes call this from a
    // worker thread during project recall. The hosted-plugin operations
    // below - loadHostedPlugin → createPluginInstance → prepareToPlay,
    // and the subsequent plugin->setStateInformation - all assume the
    // message thread. Take the lock once at the top so the whole
    // restore sequence runs message-thread-safe.
    // (juce-best-practices skill: Thread Communication. The same
    // pattern appears in juce::AudioPluginHost when reloading a
    // saved plugin graph.)
    //
    // 5.7.x audit fix: pass juce::Thread::getCurrentThread() to the
    // MessageManagerLock so the wait honours threadShouldExit(). Pre-
    // fix the bare MessageManagerLock() constructor blocks indefinitely
    // — if the host's message thread were stuck (modal dialog from
    // another plugin, deadlocked auval pass, etc.) the worker thread
    // calling setStateInformation would hang forever, producing a
    // never-loads-projects bug that's near-impossible to reproduce
    // outside the customer's exact session. With a Thread* the wait
    // bails on shutdown signals.
    std::optional<juce::MessageManagerLock> mmLock;
    if (auto* mm = juce::MessageManager::getInstanceWithoutCreating();
        mm == nullptr || ! mm->isThisTheMessageThread())
    {
        if (auto* curThread = juce::Thread::getCurrentThread())
            mmLock.emplace(curThread);
        else
            mmLock.emplace();  // No JUCE thread context (foreign worker);
                               // accept the bare wait — alternative is
                               // dropping state restore entirely.
        if (! mmLock->lockWasGained())
            return;  // App / thread shutting down - nothing to restore.
    }

    auto parsed = juce::JSON::parse(juce::String::fromUTF8(static_cast<const char*>(data), size));
    if (auto* obj = parsed.getDynamicObject())
    {
        if (obj->hasProperty("bufferSeconds"))
        {
            // 5.2.2 (audit P1 #12): NaN slips through `jlimit` because
            // NaN compares false to everything. Guard explicitly so a
            // malformed preset doesn't push NaN through allocateRing.
            const double s = static_cast<double>(obj->getProperty("bufferSeconds"));
            setBufferSeconds(std::isfinite(s) ? s : 30.0);
        }
        if (obj->hasProperty("sessionName")) {
            // 5.7.x audit fix: lock the write — paired with getSessionName().
            const juce::ScopedLock sl (stringFieldsLock);
            sessionName = sanitiseHostString(obj->getProperty("sessionName").toString());
        }
        if (obj->hasProperty("source")) {
            const int v = static_cast<int>(obj->getProperty("source"));
            // Bounds match the full Source enum (0..3 including AraRegion).
            // The previous v <= 2 check silently dropped ARA-selected saves
            // back to LastNSeconds.
            if (v >= 0 && v <= 3) source.store(static_cast<Source>(v), std::memory_order_release);
        }
        if (obj->hasProperty("selectedAraRegionId")) {
            // 5.7.x audit fix: lock the write — paired with getSelectedAraRegionId().
            const juce::ScopedLock sl (stringFieldsLock);
            selectedAraRegionId = obj->getProperty("selectedAraRegionId").toString();
        }

        // Restore the hosted plugin saved by a previous getStateInformation.
        // Match the saved plugin id against KnownPluginList; if found,
        // load it and pump its state blob back in. Failures here are
        // never fatal - the slot just stays empty and the user can
        // re-pick. We do this AFTER the rest of state is restored so
        // sample rate / block size are settled before prepareToPlay.
        if (obj->hasProperty("hostedPluginId"))
        {
            const auto savedId = obj->getProperty("hostedPluginId").toString();
            if (savedId.isNotEmpty())
            {
                const auto types = knownPluginList.getTypes();
                for (const auto& t : types)
                {
                    if (t.createIdentifierString() == savedId)
                    {
                        const auto err = loadHostedPlugin(t);
                        if (err.isEmpty() && hostedPlugin
                            && obj->hasProperty("hostedPluginState"))
                        {
                            juce::MemoryBlock hostedState;
                            hostedState.fromBase64Encoding(
                                obj->getProperty("hostedPluginState").toString());
                            if (hostedState.getSize() > 0)
                                hostedPlugin->setStateInformation(
                                    hostedState.getData(),
                                    static_cast<int>(hostedState.getSize()));
                        }
                        break;
                    }
                }
            }
        }
    }
}

juce::AudioProcessorEditor* RtmSendAudioProcessor::createEditor()
{
    return new RtmSendAudioProcessorEditor(*this);
}

// ─── 1.1.0 spike: plug-in host slot ───────────────────────────────
// Implementation notes are on the public-section declarations in the
// header. This block is the audio-thread-safe load/unload + a small
// async scan that JUCE's KnownPluginList drives.

juce::String RtmSendAudioProcessor::getHostedPluginName() const
{
    // 5.7.x audit fix: lock the read — see header comment on stringFieldsLock.
    const juce::ScopedLock sl (stringFieldsLock);
    return hostedPluginName;
}

void RtmSendAudioProcessor::setLastStatusLocked (juce::String s)
{
    // 5.7.x audit fix: see header — paired with the lock on getLastStatus()
    // so concurrent readers never observe a torn juce::String pointer.
    const juce::ScopedLock sl (stringFieldsLock);
    lastStatus = std::move (s);
}

juce::File RtmSendAudioProcessor::getKnownPluginListCacheFile() const
{
    auto dir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
        .getChildFile("RTMcompare").getChildFile("rtmsend");
    if (! dir.exists()) dir.createDirectory();
    return dir.getChildFile("known-plugins.xml");
}

void RtmSendAudioProcessor::loadKnownPluginListCache()
{
    auto f = getKnownPluginListCacheFile();
    if (! f.existsAsFile()) return;
    if (auto xml = juce::XmlDocument::parse(f))
        knownPluginList.recreateFromXml(*xml);
}

void RtmSendAudioProcessor::saveKnownPluginListCache()
{
    auto xml = knownPluginList.createXml();
    if (! xml) return;
    xml->writeTo(getKnownPluginListCacheFile());
}

void RtmSendAudioProcessor::scanForPluginsAsync(std::function<void()> onDone)
{
    // Scan the standard search paths for every registered format.
    // Runs on a background thread so the audio thread stays unblocked.
    //
    // 5.7.x crash fix: suspend hostingEnabled for the duration of the
    // scan. JUCE's PluginDirectoryScanner instantiates each candidate
    // plugin in-process to read its descriptor. If the audio thread is
    // simultaneously calling our hostedPlugin->processBlock — and the
    // candidate plugin happens to grab a system audio resource on
    // construction (some CoreAudio-aware AUs, some plugins with global
    // SDK init) — the resulting reentrancy can crash the host.
    // Suspending hosting drops us to silent pass-through for the scan
    // duration, after which we restore the previous routing. Audio
    // keeps flowing; the hosted plugin just doesn't process anything
    // for the ~10–60 s scan window. Plus a try/catch around each
    // scanNextFile so a single bad plugin can't bring the rest down.
    //
    // Ableton UAF fix: use a proper JUCE Thread (pluginScanThread) that
    // the destructor can stop cleanly. juce::Thread::launch created a
    // fully detached std::thread that captured `this` raw — removing
    // the plugin from the chain while the scan ran caused a use-after-
    // free crash. The PluginScanThread's threadShouldExit() is checked
    // between each scanNextFile call; stopThread(5000) in the dtor
    // gives the scan at most 5 s to reach a check point before giving up.

    // Stop any previous scan before starting a new one.
    if (pluginScanThread && pluginScanThread->isThreadRunning())
        pluginScanThread->stopThread (5000);

    pluginScanThread = std::make_unique<PluginScanThread>();
    const bool hostingWasEnabled = hostingEnabled.exchange(false, std::memory_order_acq_rel);
    juce::Thread* scanThread = pluginScanThread.get();

    pluginScanThread->work = [this, hostingWasEnabled, scanThread, onDone = std::move(onDone)]() mutable
    {
        auto logFile = juce::File::getSpecialLocation (juce::File::userHomeDirectory)
                           .getChildFile (".rtm").getChildFile ("rtmsend.log");
        auto log = [&] (const juce::String& msg) {
            logFile.appendText (juce::Time::getCurrentTime().toISO8601 (true) + " scan: " + msg + "\n");
        };

        log (hostingWasEnabled ? "starting (hosting suspended for duration)"
                                : "starting (hosting was already off)");

        for (auto* fmt : pluginFormatManager.getFormats())
        {
            if (scanThread->threadShouldExit()) break;

            // 5.7.x: skip Audio Unit format on macOS. JUCE's AU scanner
            // forces plugin instantiation onto the main thread (CoreAudio
            // requirement), which means a crashing AU constructor takes
            // down the host process — including the user's DAW. We saw
            // this in the wild with iZotope's iZRX11De-reverbAUHook
            // throwing an unhandled C++ exception during
            // AudioComponentInstanceNew, which propagated past JUCE's
            // message-thread dispatch and hit std::terminate, aborting
            // Wavelab. JUCE's dead-mans-pedal file is supposed to skip
            // such plugins on retry, but the crash happens before the
            // pedal file gets fsync'd to disk.
            //
            // VST3 doesn't have this failure mode — its instantiation
            // path runs on the worker thread and our try/catch around
            // scanNextFile catches any exceptions. All 16 EQ profiles
            // we ship are available as VST3, so users won't see missing
            // plugins.
            //
            // AU returns in a future release once we wire up
            // out-of-process scanning (juce::ChildProcessCoordinator).
            if (fmt->getName() == "AudioUnit")
            {
                log ("skipping AudioUnit format (in-process AU scan can crash host; see PluginProcessor.cpp comment)");
                continue;
            }

            const auto paths = fmt->getDefaultLocationsToSearch();
            juce::PluginDirectoryScanner scanner(knownPluginList,
                                                 *fmt,
                                                 paths,
                                                 /*recursive*/ true,
                                                 /*deadMansPedalFile*/ getKnownPluginListCacheFile().withFileExtension("dead"));
            juce::String pluginBeingScanned;
            for (;;)
            {
                if (scanThread->threadShouldExit()) break;
                bool more = false;
                try
                {
                    more = scanner.scanNextFile(true, pluginBeingScanned);
                }
                catch (const std::exception& e)
                {
                    log (juce::String ("exception while scanning '") + pluginBeingScanned + "': " + e.what());
                    more = true;  // keep going — dead-man's-pedal will skip this one next time
                }
                catch (...)
                {
                    log (juce::String ("unknown exception while scanning '") + pluginBeingScanned + "'");
                    more = true;
                }
                if (! more) break;
            }
        }

        if (! scanThread->threadShouldExit())
        {
            saveKnownPluginListCache();
            log ("complete");
        }
        else
        {
            log ("aborted (plugin removed from chain mid-scan)");
        }

        // Restore the prior hosting state. Audio thread sees the
        // store after release, picks up where it left off.
        hostingEnabled.store(hostingWasEnabled, std::memory_order_release);

        if (! scanThread->threadShouldExit())
            if (onDone) juce::MessageManager::callAsync(std::move(onDone));
    };

    pluginScanThread->startThread (juce::Thread::Priority::background);
}

juce::String RtmSendAudioProcessor::loadHostedPlugin(const juce::PluginDescription& desc)
{
    // CONTRACT: caller MUST already be on the message thread (or hold
    // a MessageManagerLock). createPluginInstance, setPlayConfigDetails
    // and prepareToPlay all assume message-thread context. This is
    // satisfied for our two real callers:
    //   - openPluginPicker (UI click → menu callback runs on message thread)
    //   - setStateInformation (which takes a MessageManagerLock at the top
    //     of itself before calling us - see below)
    // We deliberately DON'T re-lock here; recursive MessageManagerLock
    // from a worker thread that already holds the lock would deadlock.

    juce::String error;
    auto instance = pluginFormatManager.createPluginInstance(
        desc,
        sampleRateHz,
        /*estimatedBlockSize*/ 1024,
        error);
    if (! instance)
        return error.isEmpty() ? juce::String("createPluginInstance returned null") : error;

    instance->setPlayConfigDetails(numChannels, numChannels, sampleRateHz, 1024);
    instance->prepareToPlay(sampleRateHz, 1024);

    // 5.7.x audit fix: hold getCallbackLock() across the unique_ptr
    // swap. Pre-fix the audio thread could read the unique_ptr's
    // raw pointer mid-write (operator= on unique_ptr is not atomic),
    // potentially observing a torn pointer between the moved-from
    // and moved-to states. The lock guarantees processBlock either
    // finishes before the swap or waits until after — no in-flight
    // pointer read. Standard JUCE pattern; same lock used implicitly
    // around processBlock by the host wrapper.
    hostingEnabled.store(false, std::memory_order_release);

    // Remember whether the previous plugin's window was open, so we
    // can reopen the new plugin's window automatically - the user
    // expects "I had Pro-Q open, I picked Kirchhoff, now Kirchhoff's
    // window opens" rather than having to click Open again.
    const bool reopenWindow = (hostedPluginWindow != nullptr);

    // Close the OLD plugin's window before swapping - this triggers
    // editorBeingDeleted on the OLD AudioPluginInstance via
    // DocumentWindow's setContentOwned cleanup. Doing this BEFORE
    // we move-out the unique_ptr is critical: at this point the
    // OLD plugin is still reachable via hostedPlugin.get(), so the
    // editor's destructor finds a live processor to call back into.
    hostedPluginWindow.reset();

    std::unique_ptr<juce::AudioPluginInstance> previous;
    {
        const juce::ScopedLock sl(getCallbackLock());
        previous = std::move(hostedPlugin);
        hostedPlugin = std::move(instance);
    }
    // 5.7.x audit fix: take stringFieldsLock for the name write so
    // getHostedPluginName() (called from anywhere) is consistent.
    // Done OUTSIDE the callback lock to avoid lock-ordering hazards.
    {
        const juce::ScopedLock sl (stringFieldsLock);
        hostedPluginName = desc.descriptiveName.isNotEmpty() ? desc.descriptiveName : desc.name;
    }
    // 5.7.x audit fix: clear any prior fault state — the user just
    // re-loaded a plugin, give it a clean slate. Order: clear fault
    // BEFORE re-enabling hosting so the audio thread's two-flag check
    // never sees enabled+faulted simultaneously.
    hostedPluginFaulted.store(false, std::memory_order_release);
    // 5.7.1 v4: signal that a plugin is present so handlePing can
    // answer without the message-thread lock.
    hostedPluginPresent.store(true, std::memory_order_release);
    hostingEnabled.store(true, std::memory_order_release);

    // Defer the previous plugin's destructor (see header note).
    retireHostedPluginAsync(std::move(previous));

    if (reopenWindow)
        showHostedPluginWindow();
    return {};
}

void RtmSendAudioProcessor::unloadHostedPlugin()
{
    hostingEnabled.store(false, std::memory_order_release);
    // 5.7.x audit fix: also clear fault state so the next load starts
    // clean. Without this, a plugin that faulted then was unloaded
    // would leave hostedPluginFaulted=true into the next load until
    // loadHostedPlugin clears it — narrow window, but the explicit
    // clear keeps the invariant tidy.
    hostedPluginFaulted.store(false, std::memory_order_release);
    // 5.7.1 v4: clear the present flag in lockstep with the actual unload.
    hostedPluginPresent.store(false, std::memory_order_release);
    // Destroy the plugin window FIRST. The window owns the plugin's
    // editor; resetting it triggers the editorBeingDeleted handshake
    // before we touch the AudioPluginInstance itself. Order matters
    // here - releasing the plugin first would leave the window with
    // a dangling editor pointer.
    hostedPluginWindow.reset();
    // 5.7.x audit fix: hold getCallbackLock() across the move. Same
    // rationale as loadHostedPlugin — operator= on unique_ptr is not
    // atomic, audio thread must not observe a torn pointer.
    std::unique_ptr<juce::AudioPluginInstance> previous;
    {
        const juce::ScopedLock sl(getCallbackLock());
        previous = std::move(hostedPlugin);
    }
    // 5.7.x audit fix: same lock-order discipline as loadHostedPlugin —
    // stringFieldsLock taken OUTSIDE the callback lock.
    {
        const juce::ScopedLock sl (stringFieldsLock);
        hostedPluginName = {};
    }
    retireHostedPluginAsync(std::move(previous));
}

void RtmSendAudioProcessor::showHostedPluginWindow()
{
    if (! hostedPlugin) return;

    // Already open? Just bring to front.
    if (hostedPluginWindow)
    {
        hostedPluginWindow->setVisible(true);
        hostedPluginWindow->toFront(true);
        return;
    }

    // Create a fresh floating window. Capture a WeakReference so the
    // user's X-click closes the window via callAsync (deferred
    // destruction - see HostedPluginWindow::closeButtonPressed) WITHOUT
    // dereferencing a freed processor if the host tore us down between
    // the click and the message-thread tick.
    //
    // 5.7.x audit fix: was `[this]() { hostedPluginWindow.reset(); }`.
    // If Wavelab destroyed RtmSendAudioProcessor (e.g. user removed
    // RTMsend from the chain) while a callAsync was in flight, the
    // lambda would null-deref or worse. WeakReference is the canonical
    // JUCE pattern for "I might outlive my owner."
    juce::WeakReference<RtmSendAudioProcessor> weakSelf (this);
    hostedPluginWindow = std::make_unique<HostedPluginWindow>(
        *hostedPlugin,
        [weakSelf]() {
            if (auto* self = weakSelf.get())
                self->hostedPluginWindow.reset();
        });
}

void RtmSendAudioProcessor::hideHostedPluginWindow()
{
    // Destroying the window triggers the editorBeingDeleted handshake
    // through DocumentWindow's setContentOwned ownership. After this
    // returns, the plugin's activeEditor is back to null and we can
    // safely re-create the window later.
    hostedPluginWindow.reset();
}

void RtmSendAudioProcessor::retireHostedPluginAsync(
    std::unique_ptr<juce::AudioPluginInstance> p)
{
    if (! p) return;

    // releaseResources synchronously - this is the contract the
    // plugin expects when its audio path is being shut down. The
    // deferral is only for the C++ destructor (which tears down
    // editor + threads).
    p->releaseResources();

    // Capture the unique_ptr by-move into the lambda. Timer holds
    // the lambda; when the lambda fires (250 ms later) it executes
    // empty-bodied and is then destroyed, which invokes the
    // unique_ptr destructor → AudioPluginInstance destructor →
    // editor + thread shutdown. By then any CFRunLoop source0
    // callbacks the plugin had queued before we let go of it have
    // either run (against a still-valid plugin) or been cancelled
    // by a thread join, and we don't crash dereferencing a deleted
    // `this`. 250 ms is empirical - Kirchhoff and Pro-Q both clear
    // their pending GUI work in well under that window.
    juce::Timer::callAfterDelay(250,
        [keepalive = std::shared_ptr<juce::AudioPluginInstance>(p.release())]() mutable
        {
            keepalive.reset();
        });
}

// ─── JUCE factory entry-point ─────────────────────────────────────
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new RtmSendAudioProcessor();
}

#if RTM_ARA_ENABLED
// ─── ARA factory entry-point ──────────────────────────────────────
// Host calls this to get the ARA factory. The JUCE helper wires up
// the callback table against our RtmAraDocumentController.
const ARA::ARAFactory* JUCE_CALLTYPE createARAFactory()
{
    return juce::ARADocumentControllerSpecialisation::createARAFactory<RtmAraDocumentController>();
}
#endif
