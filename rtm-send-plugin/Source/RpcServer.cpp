#include "RpcServer.h"
#include "PluginProcessor.h"
#include <cmath>  // std::isfinite — sanitiseFinite()
#include <thread> // 5.7.1 v5: per-connection worker threads in run()
// 5.7.1 Tier-3: getpid() — juce::Process has no portable
// process-id helper. POSIX has getpid in <unistd.h>; on Windows we'd
// use GetCurrentProcessId from <windows.h>. RTMsend ships macOS / Linux
// today (notarised macOS bundle from CMakeLists.txt). The Windows port
// can swap this header behind a JUCE_WINDOWS guard.
#if JUCE_WINDOWS
  #define NOMINMAX          // prevent windows.h from defining min/max macros
  #include <windows.h>
#else
  #include <unistd.h>
#endif

namespace
{
    // JSON-RPC 2.0 standard error codes
    constexpr int kErrParse        = -32700;
    constexpr int kErrInvalidReq   = -32600;
    constexpr int kErrMethodMiss   = -32601;
    constexpr int kErrInvalidParam = -32602;
    constexpr int kErrInternal     = -32603;
    // Application-defined range starts at -32000.
    constexpr int kErrNoPlugin     = -32001;
    constexpr int kErrParamIndex   = -32002;
    // 5.7.1 Tier-3: semantic recommend.eq guards. -32010 means the
    // loaded plugin doesn't match the recommendation's target (so the
    // client knows to prompt the user to reload). -32011 means the
    // loaded plugin's version is outside [min, max].
    constexpr int kErrTargetMismatch  = -32010;
    constexpr int kErrVersionMismatch = -32011;

    // 5.7.1 Tier-3: build tag baked into ping responses + instance
    // metadata file. Pinned to JucePlugin_VersionString so a CMake
    // version bump propagates without source edits.
    constexpr const char* kRtmSendBuildTag = JucePlugin_VersionString;

    // 5.7.1 Tier-3: per-connection inactivity deadline. 30s is comfortably
    // above worst-case round-trip (clients send a request then think for a
    // few seconds before the next, e.g. user reads a recommendation and
    // hits "apply"). Anything stuck for longer is a client crash or a
    // hung TCP — close the socket so the listener stays available for
    // healthy clients. Without this, a crashed RTMcompare leaves us
    // wedged in `read(blocking=true)` until the OS times out (~2 hours).
    constexpr int kConnectionInactivityMs = 30'000;

    // Resolve the AudioProcessor that the loaded plugin exposes. We
    // cast through to AudioProcessor because both AudioPluginInstance
    // and AudioProcessor share the same parameter-tree API.
    // 5.7.1 Tier-3 fix: return concrete AudioPluginInstance* not the
    // base AudioProcessor*. The Tier-3 fingerprint/version code calls
    // hp->getPluginDescription(), which only exists on AudioPluginInstance.
    juce::AudioPluginInstance* hostedProcessor (RtmSendAudioProcessor& p) noexcept
    {
        return p.getHostedPlugin();
    }

    // Marshal a write onto the JUCE message thread and wait for it.
    // Parameter writes can fire host listeners that touch other JUCE
    // GUI state, which is only safe on the message thread.
    template <typename Fn>
    void runOnMessageThreadSync (Fn&& fn)
    {
        if (juce::MessageManager::existsAndIsCurrentThread()) { fn(); return; }
        juce::WaitableEvent done;
        juce::MessageManager::callAsync ([fn = std::forward<Fn>(fn), &done]() mutable
        {
            fn();
            done.signal();
        });
        done.wait();
    }

    // Read a line (terminated by \n) from a StreamingSocket. Returns
    // empty String on disconnect / error / inactivity timeout. Builds
    // up across reads if the line spans multiple TCP packets.
    //
    // 5.7.1 Tier-3: replaced unconditional blocking reads with
    // waitUntilReady polled at 250ms ticks so the per-connection
    // inactivity deadline can fire. Pre-Tier-3 we'd sit in a blocking
    // read forever if a crashed client never closed cleanly — the
    // listener thread couldn't accept new connections.
    juce::String readLine (juce::StreamingSocket& s,
                           std::atomic<bool>& shouldExit,
                           int inactivityMs)
    {
        juce::String out;
        char ch = 0;
        const auto startTicks = juce::Time::getMillisecondCounter();
        while (! shouldExit.load(std::memory_order_acquire))
        {
            // 5.7.1 Tier-3: 250ms wait granularity. Short enough that
            // shouldExit / inactivity check stays responsive, long
            // enough that we're not busy-spinning. waitUntilReady(true)
            // returns 1 on ready-to-read, 0 on timeout, -1 on error.
            const int ready = s.waitUntilReady(true, 250);
            if (ready < 0) return {};  // socket error → drop connection
            if (ready == 0)
            {
                // Timed out at 250ms granularity; check absolute deadline.
                const auto elapsed = juce::Time::getMillisecondCounter() - startTicks;
                if ((int) elapsed >= inactivityMs) return {};
                continue;
            }
            const int got = s.read (&ch, 1, /*shouldBlock*/ true);
            if (got <= 0) return {};
            if (ch == '\n') return out;
            if (ch != '\r') out += ch;
        }
        return {};
    }

    bool writeLine (juce::StreamingSocket& s, const juce::String& line)
    {
        const auto bytes = line.toUTF8();
        const int len = (int) bytes.sizeInBytes() - 1;  // drop trailing NUL
        if (len > 0 && s.write (bytes.getAddress(), len) != len) return false;
        return s.write ("\n", 1) == 1;
    }

    // 5.7.1 Tier-3: short hex string from a juce::Uuid for filename use.
    // 8 chars is enough to disambiguate per-pid (collision space ~4B,
    // and we already namespace by pid). We trim juce::Uuid::toString
    // (32 chars hex) rather than build a fresh hash because juce::Uuid
    // is already sourced from /dev/urandom on macOS / Bcrypt on Windows.
    juce::String makeUuid8()
    {
        const auto full = juce::Uuid().toString();  // 32 hex chars
        return full.substring(0, 8);
    }

    // 5.7.1 Tier-3: parse a "1.2.3"-style semver to a comparable form.
    // Returns the input verbatim — juce::String::compareNatural already
    // sorts "1.10.0" > "1.9.0" correctly because it groups digit runs.
    // Keeping this as a passthrough makes the call sites read clearly.
    juce::String normaliseSemver(const juce::String& v) { return v.trim(); }
}

// Generates a 128-bit cryptographically random token as a 32-char hex string.
// Written to the per-instance port file alongside the port number so
// RTMcompare can read both atomically. Same-user processes that don't know
// the token cannot control parameters even if they discover the port.
//
// CRIT-1 fix: use juce::Uuid which is backed by /dev/urandom on POSIX and
// BCryptGenRandom on Windows — a CSPRNG.  The previous juce::Random was an
// LCG seeded from getHighResolutionTicks() — predictable from process start
// time and NOT suitable for secret material.
/*static*/ juce::String RpcServer::generateAuthToken()
{
    // juce::Uuid uses OS-provided CSPRNG (/dev/urandom / BCryptGenRandom).
    // Its getRawData() returns 16 bytes (128 bits) of cryptographic randomness.
    const juce::Uuid uuid;
    return juce::String::toHexString (uuid.getRawData(), 16, 0);
}

RpcServer::RpcServer (RtmSendAudioProcessor& p)
    : juce::Thread ("RTMsend RPC"), processor (p)
{
    // 5.7.1 Tier-3: capture a stable uuid8 for this RpcServer's
    // lifetime so per-instance port files keep the same name across
    // start/stop. Different instances of RTMsend in the same DAW
    // session get different uuids (different processor objects →
    // different RpcServer objects).
    instanceUuid8 = makeUuid8();
}

RpcServer::~RpcServer()
{
    stop();
}

juce::File RpcServer::getPortFile() const
{
    auto dir = juce::File::getSpecialLocation (juce::File::userHomeDirectory).getChildFile (".rtm");
    if (! dir.exists()) dir.createDirectory();
    return dir.getChildFile ("rtmsend.port");
}

juce::File RpcServer::getInstancePortFile() const
{
    // 5.7.1 Tier-3: per-instance discovery file at
    // ~/.rtm/rtmsend-<pid>-<uuid8>.port. PID gives uniqueness across
    // RTMsend processes (each DAW process); uuid8 disambiguates
    // multiple RTMsend instances inside the SAME DAW process.
    auto dir = juce::File::getSpecialLocation (juce::File::userHomeDirectory).getChildFile (".rtm");
    if (! dir.exists()) dir.createDirectory();
    // 5.7.1 Tier-3 fix: juce::Process has no getCurrentProcessID() —
    // POSIX getpid() (already #included via <unistd.h> at top).
    const auto pid = (int) ::getpid();
    const auto fname = juce::String("rtmsend-") + juce::String(pid)
                     + juce::String("-") + instanceUuid8 + juce::String(".port");
    return dir.getChildFile (fname);
}

void RpcServer::start()
{
    auto logFile = juce::File::getSpecialLocation (juce::File::userHomeDirectory)
                       .getChildFile (".rtm").getChildFile ("rtmsend.log");
    auto log = [&] (const juce::String& msg) {
        logFile.appendText (juce::Time::getCurrentTime().toISO8601(true) + " " + msg + "\n");
    };
    log ("RpcServer::start() called");
    if (isThreadRunning()) { log ("already running, skipping"); return; }
    listener = std::make_unique<juce::StreamingSocket>();
    // Port 0 → OS picks a free one. Bind to loopback only; we never
    // want this server reachable off-machine.
    if (! listener->createListener (0, "127.0.0.1"))
    {
        log ("createListener failed (port 0, 127.0.0.1)");
        listener.reset();
        return;
    }
    port.store (listener->getBoundPort(), std::memory_order_release);
    log ("listener bound on port " + juce::String (port.load (std::memory_order_acquire)));

    // Generate a fresh auth token for this start() cycle. Written to the
    // per-instance JSON port file below; every new connection must echo it
    // back as the first line before any RPC traffic is accepted.
    rpcAuthToken = generateAuthToken();

    // Publish the chosen port for the client to discover. Use a raw
    // FileOutputStream + binary write so the line ending stays "\n"
    // on every platform — replaceWithText translates to CRLF on
    // Windows, which a literal-string parser on the client side
    // turns into an invalid port number.
    //
    // 5.7.1 Tier-3: write BOTH the legacy single-port file (pre-5.7.0
    // RTMcompare clients still consume this) AND a per-instance JSON
    // file with full metadata (5.7+ clients prefer this; lets them
    // disambiguate across multiple RTMsend instances).
    auto pf = getPortFile();
    pf.deleteFile();
    {
        juce::FileOutputStream os (pf);
        if (os.openedOk())
        {
            const auto line = juce::String (port.load(std::memory_order_acquire)) + "\n";
            const auto bytes = line.toUTF8();
            os.write (bytes.getAddress(), (size_t) (bytes.sizeInBytes() - 1));
            log ("wrote legacy port file: " + pf.getFullPathName());
        }
        else
        {
            log ("FAILED to open legacy port file: " + pf.getFullPathName());
        }
    }
    // CRIT-2 fix: restrict legacy port file to owner-read/write only.
    // Default umask (022) leaves files 0644 — any local user can read
    // the port number and attempt to connect.
#if ! JUCE_WINDOWS
    ::chmod (pf.getFullPathName().toRawUTF8(), 0600);
#endif

    // 5.7.1 Tier-3: per-instance metadata file. Includes pid + uuid8
    // (matching the filename), the bound port, the host app description
    // (so a client can match "this is the Pro Tools instance"), the
    // currently-loaded plugin name (or empty), and our build tag.
    {
        auto ipf = getInstancePortFile();
        ipf.deleteFile();
        juce::DynamicObject::Ptr meta = new juce::DynamicObject();
        meta->setProperty("pid",         (int) ::getpid());
        meta->setProperty("uuid",        instanceUuid8);
        meta->setProperty("port",        port.load(std::memory_order_acquire));
        meta->setProperty("auth_token",  rpcAuthToken);
        meta->setProperty("host_app",    juce::PluginHostType().getHostDescription());
        meta->setProperty("plugin_name", processor.getHostedPluginName());
        meta->setProperty("build",       juce::String(kRtmSendBuildTag));
        const auto json = juce::JSON::toString(juce::var(meta.get()), true);
        juce::FileOutputStream os (ipf);
        if (os.openedOk())
        {
            const auto bytes = json.toUTF8();
            os.write (bytes.getAddress(), (size_t) (bytes.sizeInBytes() - 1));
            os.writeByte('\n');
            log ("wrote per-instance port file: " + ipf.getFullPathName());
        }
        else
        {
            log ("FAILED to open per-instance port file: " + ipf.getFullPathName());
        }
        // CRIT-2 fix: restrict per-instance port file (contains auth_token)
        // to owner-read/write only. The auth_token is the only secret gating
        // RPC access; it must not be readable by other local users.
#if ! JUCE_WINDOWS
        ::chmod (ipf.getFullPathName().toRawUTF8(), 0600);
#endif
    }

    startThread (juce::Thread::Priority::low);
    log ("listener thread started");
}

void RpcServer::stop()
{
    signalThreadShouldExit();
    // Close every active per-connection socket so the per-connection
    // std::threads unblock from readLine (waitUntilReady returns -1 on
    // a closed socket) and exit handleConnection cleanly. Without this,
    // the detached threads keep calling this->threadShouldExit() on a
    // freed RpcServer once the destructor returns — UAF / crash in
    // Ableton and any host that destroys the plugin while a connection
    // is open.
    {
        const juce::ScopedLock sl (activeConnsMutex);
        for (auto* c : activeConns)
            c->close();
    }
    if (listener) listener->close();
    stopThread (1500);
    // Spin until all connection threads have removed themselves from
    // activeConns (max 2 s). After that the threads are guaranteed not
    // to touch `this`.
    for (int i = 0; i < 200; ++i)
    {
        {
            const juce::ScopedLock sl (activeConnsMutex);
            if (activeConns.empty()) break;
        }
        juce::Thread::sleep (10);
    }
    listener.reset();
    // 5.7.1 Tier-3: unlink ONLY the per-instance file. The legacy file
    // is shared — another RTMsend instance may have overwritten it
    // after we wrote to it, and is now the "newest one wins" owner.
    // Deleting it on stop would orphan that other instance from any
    // pre-5.7.0 client that's still mid-handshake.
    auto ipf = getInstancePortFile();
    if (ipf.existsAsFile()) ipf.deleteFile();
    port.store (0, std::memory_order_release);
}

void RpcServer::run()
{
    while (! threadShouldExit() && listener)
    {
        std::unique_ptr<juce::StreamingSocket> conn (listener->waitForNextConnection());
        if (! conn) break;

        // 5.7.1 v5 CRITICAL fix (juce-best-practices audit): detach
        // each connection onto its own worker thread instead of
        // handling them serially on the listener thread. Pre-fix the
        // listener was pinned inside handleConnection for the duration
        // of any in-flight call — when host.set_parameters held the
        // message thread for ~7s (45 Pro-Q writes), new connections
        // (pings, polls) sat unread in the kernel SYN backlog. Their
        // TCP handshake completed (so Node thought "connected"), but
        // no application reader → 1.5s ping timeout fired client-side
        // → indicator flipped offline mid-send.
        //
        // Per-connection threading + v4's lock-free handlePing means
        // a slow set_parameters now blocks ONLY its own connection,
        // and concurrent pings on other connections answer in
        // microseconds. We use std::thread::detach because: (a)
        // RpcServer::stop() doesn't currently track per-conn workers
        // (the `shouldExit` flag inside handleConnection is the
        // shutdown signal), (b) connections are short-lived (a few
        // ms to ~7s for set_parameters), so leaving them detached
        // at server-stop is acceptable — the conn->close() inside
        // stop()'s graceful path covers worst case.
        auto* connRaw = conn.release();
        // Register before launching so stop() sees the socket even if
        // the thread hasn't started running yet.
        {
            const juce::ScopedLock sl (activeConnsMutex);
            activeConns.push_back (connRaw);
        }
        std::thread perConn ([this, connRaw]
        {
            std::unique_ptr<juce::StreamingSocket> owned (connRaw);
            this->handleConnection (std::move (owned));
            // Unregister only after handleConnection returns so stop()
            // can observe the socket as closed-but-tracked and still
            // spin-wait on activeConns correctly.
            const juce::ScopedLock sl (activeConnsMutex);
            activeConns.erase (
                std::remove (activeConns.begin(), activeConns.end(), connRaw),
                activeConns.end());
        });
        perConn.detach();
    }
}

void RpcServer::handleConnection (std::unique_ptr<juce::StreamingSocket> conn)
{
    std::atomic<bool> shouldExit { false };

    // Auth handshake: the very first line the client sends must be the
    // per-instance auth token written to the port file. We close silently
    // on mismatch — no error response, no status code — so an attacker
    // scanning for open ports gets no confirmation that this socket is live.
    // A short inactivity deadline (same as normal RPC traffic) prevents a
    // half-open connection from wedging the thread indefinitely.
    {
        const auto firstLine = readLine (*conn, shouldExit, kConnectionInactivityMs).trim();
        if (firstLine != rpcAuthToken)
            return;  // close silently — do not respond
    }

    while (! threadShouldExit())
    {
        // 5.7.1 Tier-3: pass the inactivity deadline so a crashed/hung
        // client doesn't wedge this listener thread indefinitely.
        const auto line = readLine (*conn, shouldExit, kConnectionInactivityMs);
        if (line.isEmpty()) break;

        juce::var req = juce::JSON::parse (line);
        juce::var responseId;
        juce::var result;
        juce::var error;

        bool haveError = false;
        if (auto* obj = req.getDynamicObject())
        {
            responseId = obj->getProperty ("id");
            const auto method = obj->getProperty ("method").toString();
            const auto params = obj->getProperty ("params");
            if (method.isEmpty())
            {
                error = makeErrorObject (kErrInvalidReq, "Missing 'method'");
                haveError = true;
            }
            else
            {
                try {
                    result = dispatch (method, params);
                } catch (const RpcError& e) {
                    error = makeErrorObject (e.code, e.message);
                    haveError = true;
                } catch (const std::exception& e) {
                    error = makeErrorObject (kErrInternal, juce::String ("std::exception: ") + e.what());
                    haveError = true;
                } catch (...) {
                    error = makeErrorObject (kErrInternal, "Handler threw unknown exception");
                    haveError = true;
                }
            }
        }
        else
        {
            error = makeErrorObject (kErrParse, "Could not parse JSON");
            haveError = true;
        }

        juce::DynamicObject::Ptr resp = new juce::DynamicObject();
        resp->setProperty ("jsonrpc", "2.0");
        resp->setProperty ("id", responseId);
        if (haveError) resp->setProperty ("error", error);
        else           resp->setProperty ("result", result);

        if (! writeLine (*conn, juce::JSON::toString (juce::var (resp.get()), true)))
            break;
    }
    conn->close();
}

juce::var RpcServer::dispatch (const juce::String& method, const juce::var& params)
{
    if (method == "host.ping")               return handlePing (params);
    if (method == "host.get_loaded_plugin")  return handleGetLoadedPlugin (params);
    if (method == "host.list_parameters")    return handleListParameters (params);
    if (method == "host.find_parameters")    return handleFindParameters (params);
    if (method == "host.set_parameters")     return handleSetParameters (params);
    if (method == "host.bypass")             return handleBypass (params);
    if (method == "host.ara_state")          return handleAraState (params);
    // 5.7.1 Tier-3: semantic EQ recommendation entry point.
    if (method == "recommend.eq")            return handleRecommendEq (params);

    throw RpcError { kErrMethodMiss, "Unknown method: " + method };
}

// Diagnostic: report whether ARA is engaged on this RTMsend instance
// (i.e. the host attached us as an ARA effect and the JUCE wrapper
// instantiated our DocumentController), and how many regions our
// model currently knows about. Used to disambiguate "I added the
// plugin to a clip but the picker is empty" — we need to know if
// the host attached us as ARA at all, vs if it did but hasn't pushed
// region data yet.
juce::var RpcServer::handleAraState (const juce::var&)
{
    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
#if RTM_ARA_ENABLED
    obj->setProperty ("ara_compiled_in", true);
    // Live check, not cached. The araAttached flag only updates in
    // prepareToPlay; Wavelab can bind ARA AFTER prepareToPlay so the
    // cached flag goes stale. Asking the JUCE ARA extension directly
    // is the source of truth.
    const bool boundNow = processor.isBoundToARA();
    obj->setProperty ("controller_attached", boundNow);
    obj->setProperty ("attached_at_prepare", processor.isAraAttached());
    auto model = processor.getAraRegionsModel();
    if (model)
    {
        const auto snap = model->getRegionsSnapshot();
        obj->setProperty ("region_count", static_cast<int> (snap.size()));
        obj->setProperty ("revision", static_cast<int64_t> (model->getRevision()));
        juce::Array<juce::var> names;
        for (const auto& r : snap) names.add (r.name);
        obj->setProperty ("region_names", names);
    }
    if (! boundNow)
        obj->setProperty ("note", "Host did not attach RTMsend as an ARA effect. In Wavelab: 1) right-click the plugin in Clip Effects → look for an ARA-enable option, OR 2) the plugin must be inserted into the clip via the host's ARA-aware path (sometimes via a separate menu).");
#else
    obj->setProperty ("ara_compiled_in", false);
    obj->setProperty ("note", "RTMsend was built with RTM_ARA_ENABLED=0. Rebuild with the ARA SDK present.");
#endif
    return juce::var (obj.get());
}

juce::var RpcServer::handlePing (const juce::var&)
{
    // 5.7.1 Tier-3: ping returns a rich handshake object so clients
    // can verify the connection within their 1.5s timeout AND learn
    // what they're talking to in one round trip. Pre-Tier-3 it just
    // returned the literal string "pong"; new clients still get a
    // truthy result so old behaviour is preserved if they only check
    // that result is non-null.
    //
    // 5.7.1 v4 fix: handlePing now answers WITHOUT runOnMessageThreadSync.
    // Pre-fix: a slow set_parameters (45 Pro-Q writes ≈ 7 s on the
    // message thread) blocked every concurrent ping behind it. Polls
    // exceeded the bridge's 1.5 s ping timeout, the connection
    // indicator flipped to offline, and FDs piled up on the listener.
    // Each field below is now lock-free:
    //   • isHostedPluginPresent / isHostingEnabled / didHostedPluginFault
    //     are atomic loads
    //   • getHostedPluginName is guarded by stringFieldsLock (a brief
    //     CriticalSection — never held across message-thread work).
    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
    obj->setProperty ("ok",              true);
    obj->setProperty ("build",           juce::String(kRtmSendBuildTag));
    obj->setProperty ("host_app",        juce::PluginHostType().getHostDescription());
    obj->setProperty ("plugin_name",     processor.getHostedPluginName());
    obj->setProperty ("plugin_loaded",   processor.isHostedPluginPresent());
    obj->setProperty ("hosting_enabled", processor.isHostingEnabled());
    obj->setProperty ("plugin_faulted",  processor.didHostedPluginFault());
    return juce::var (obj.get());
}

juce::var RpcServer::handleGetLoadedPlugin (const juce::var&)
{
    // 5.7.x: read-only parameter inspection MUST happen on the message
    // thread. Walking hp->getParameters() while loadHostedPlugin is
    // mid-swap (also on message thread, but mutates the unique_ptr
    // before we lock) was a UAF risk. The juce-best-practices audit
    // flagged this as CRITICAL.
    juce::var out;
    runOnMessageThreadSync ([&]() {
        auto* hp = hostedProcessor (processor);
        if (! hp) { out = juce::var(); return; }  // null = no plugin loaded
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        o->setProperty ("name", processor.getHostedPluginName());
        o->setProperty ("parameter_count", hp->getParameters().size());
        o->setProperty ("sample_rate", sanitiseFinite (hp->getSampleRate()));
        o->setProperty ("latency_samples", hp->getLatencySamples());
        // 5.7.1 Tier-3 fix: expose the same identity fields used by
        // computeTargetFingerprint() (format / fileOrIdentifier as "uid"
        // / version) so the CLIENT can hash the same blob and produce
        // a matching fingerprint. Pre-fix the server hashed
        // "<format>|<file>|<version>|<count>" while the client only had
        // <count>, so the SHA-256 never matched and every recommend.eq
        // failed with -32010 E_TARGET_MISMATCH.
        const auto desc = hp->getPluginDescription();
        o->setProperty ("format",  desc.pluginFormatName);
        o->setProperty ("uid",     desc.fileOrIdentifier);
        o->setProperty ("version", desc.version);
        out = juce::var (o.get());
    });
    return out;
}

// 5.7.x: sanitise float values before stuffing into juce::var. Some
// plugins return NaN or Infinity for uninitialised / invalid parameter
// states; juce::JSON::toString emits the literal `NaN`/`Infinity` which
// Node's JSON.parse rejects with "Unexpected token N", surfacing as the
// opaque "failed to send" error users were seeing in RTMcompare. Map
// non-finite values to 0.0 — better than killing the call.
double RpcServer::sanitiseFinite (double v) noexcept
{
    return std::isfinite (v) ? v : 0.0;
}

juce::var RpcServer::paramSnapshot (int index, const juce::AudioProcessorParameter& p)
{
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("index", index);
    o->setProperty ("name", p.getName (256));
    o->setProperty ("label", p.getLabel());
    o->setProperty ("current", sanitiseFinite (p.getValue()));        // 0..1 normalised
    o->setProperty ("default", sanitiseFinite (p.getDefaultValue())); // 0..1 normalised
    o->setProperty ("text", p.getText (p.getValue(), 256));
    return juce::var (o.get());
}

juce::var RpcServer::handleListParameters (const juce::var&)
{
    juce::var out;
    runOnMessageThreadSync ([&]() {
        auto* hp = hostedProcessor (processor);
        if (! hp) { out = juce::var(); return; }  // signal no-plugin via null
        juce::Array<juce::var> arr;
        const auto& ps = hp->getParameters();
        for (int i = 0; i < ps.size(); ++i)
            if (auto* p = ps[i]) arr.add (paramSnapshot (i, *p));
        out = juce::var (std::move (arr));
    });
    if (out.isVoid()) throw RpcError { kErrNoPlugin, "No plugin loaded" };
    return out;
}

juce::var RpcServer::handleFindParameters (const juce::var& params)
{
    const auto pattern = params.getProperty ("pattern", "").toString();
    if (pattern.isEmpty()) throw RpcError { kErrInvalidParam, "Missing 'pattern'" };

    juce::var out;
    runOnMessageThreadSync ([&]() {
        auto* hp = hostedProcessor (processor);
        if (! hp) { out = juce::var(); return; }
        juce::Array<juce::var> arr;
        const auto& ps = hp->getParameters();
        for (int i = 0; i < ps.size(); ++i)
            if (auto* p = ps[i])
                if (p->getName (256).containsIgnoreCase (pattern))
                    arr.add (paramSnapshot (i, *p));
        out = juce::var (std::move (arr));
    });
    if (out.isVoid()) throw RpcError { kErrNoPlugin, "No plugin loaded" };
    return out;
}

juce::var RpcServer::handleSetParameters (const juce::var& params)
{
    const auto updates = params.getProperty ("updates", juce::var());
    if (! updates.isArray()) throw RpcError { kErrInvalidParam, "Expected 'updates' array" };

    juce::Array<juce::var> applied;
    juce::Array<juce::var> rejected;
    bool noPlugin = false;

    auto* allUpdates = updates.getArray();
    const int totalUpdates = allUpdates ? allUpdates->size() : 0;

    // 5.8.0: coalesce ALL writes into a single runOnMessageThreadSync
    // dispatch.  Previous approach (v5, kChunkSize=6) still made up to
    // N/6 message-thread round-trips — 8 round-trips for a full Pro-Q
    // 45-band update, each introducing a scheduler round-trip overhead
    // (~10 ms on macOS) for a total of ~80 ms of overhead on top of the
    // write time.  loadHostedPlugin / unloadHostedPlugin also run on the
    // message thread, but they cannot interleave with this lambda because
    // both parties go through the message thread serialisation; there is
    // no "between chunks" race to protect against any more.
    // updateHostDisplay + repaint fire once at the end so Pro-Q paints
    // the settled lattice rather than redrawing mid-batch.
    if (totalUpdates > 0)
    {
        runOnMessageThreadSync ([&]()
        {
            auto* hp = hostedProcessor (processor);
            if (! hp) { noPlugin = true; return; }
            const auto& ps = hp->getParameters();
            for (int i = 0; i < totalUpdates; ++i)
            {
                auto& u = (*allUpdates).getReference (i);
                const int idx = (int) u.getProperty ("index", -1);
                const float val = (float) (double) u.getProperty ("value", 0.0);
                if (idx < 0 || idx >= ps.size() || ps[idx] == nullptr)
                {
                    juce::DynamicObject::Ptr r = new juce::DynamicObject();
                    r->setProperty ("index", idx);
                    r->setProperty ("error", "out_of_range");
                    rejected.add (juce::var (r.get()));
                    continue;
                }
                const auto clamped = juce::jlimit (0.0f, 1.0f, val);
                ps[idx]->beginChangeGesture();
                ps[idx]->setValueNotifyingHost (clamped);
                ps[idx]->endChangeGesture();
                ps[idx]->sendValueChangedMessageToListeners (clamped);
                juce::DynamicObject::Ptr r = new juce::DynamicObject();
                r->setProperty ("index", idx);
                r->setProperty ("value", ps[idx]->getValue());
                applied.add (juce::var (r.get()));
            }
            // Single updateHostDisplay + repaint after all writes settle.
            hp->updateHostDisplay();
            if (auto* ed = hp->getActiveEditor()) ed->repaint();
        });
    }

    if (noPlugin) throw RpcError { kErrNoPlugin, "No plugin loaded" };

    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("applied", juce::var (std::move (applied)));
    o->setProperty ("rejected", juce::var (std::move (rejected)));
    return juce::var (o.get());
}

juce::var RpcServer::handleBypass (const juce::var& params)
{
    const bool on = (bool) params.getProperty ("enabled", false);
    runOnMessageThreadSync ([&]()
    {
        // Toggle the host-slot's audio gate. False stops processBlock
        // from routing through the hosted plugin without ejecting it.
        if (on) processor.unloadHostedPlugin();  // hard for v1; refine later
    });
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("bypassed", on);
    return juce::var (o.get());
}

// 5.7.1 Tier-3: compute the canonical fingerprint for the currently
// loaded plugin. Format: sha256(UTF-8 of "<format>|<plugin uid>|<plugin
// version>|<param count>"). Stable across a single load; recomputed on
// each call so a re-load (different plugin, or different version of the
// same plugin) gets a fresh fingerprint.
//
// We compose from the PluginDescription rather than the runtime instance
// so any quirky state inside the plugin (e.g. dynamic parameter sets)
// doesn't make the same plugin produce different fingerprints across
// sessions. Param count is read from the live instance because that's
// the one bit of state callers care about — they're sending parameter
// indices, and a parameter-count mismatch invalidates the indices.
//
// MUST be called on the message thread (touches hostedPlugin pointer).
juce::String RpcServer::computeTargetFingerprint() const
{
    auto* hp = processor.getHostedPlugin();
    if (! hp) return {};
    // PluginDescription is a struct held by the AudioPluginInstance —
    // safe to copy, no thread concerns inside this single call.
    const auto desc = hp->getPluginDescription();
    const auto material = desc.pluginFormatName + juce::String("|")
                        + desc.fileOrIdentifier  + juce::String("|")
                        + desc.version           + juce::String("|")
                        + juce::String(hp->getParameters().size());
    juce::SHA256 hash (material.toRawUTF8(), (size_t) material.getNumBytesAsUTF8());
    return hash.toHexString();
}

juce::var RpcServer::handleRecommendEq (const juce::var& params)
{
    // 5.7.1 Tier-3: semantic EQ recommendation entry point. Wraps
    // host.set_parameters with two optional guards:
    //
    //   target_fingerprint  — caller's hash of the plugin they computed
    //                         the recommendation against. Mismatch means
    //                         a different plugin is loaded now (e.g. user
    //                         swapped Pro-Q for Kirchhoff between request
    //                         and apply). Reject with -32010.
    //
    //   min_version/max_version — semver range the recommendation is valid
    //                         for. If hosted plugin's version is outside
    //                         the range, reject with -32011.
    //
    // After both guards pass, the body is treated as a host.set_parameters
    // payload and applied identically. Backwards-compatible: pre-5.7.0
    // clients can either call host.set_parameters directly OR call
    // recommend.eq with no fingerprint/version fields and get the same
    // semantics as set_parameters.
    if (! params.isObject())
        throw RpcError { kErrInvalidParam, "Expected object payload" };

    const auto callerFingerprint = params.getProperty ("target_fingerprint", "").toString();
    const auto minVersionRaw = params.getProperty ("min_version", "").toString();
    const auto maxVersionRaw = params.getProperty ("max_version", "").toString();

    juce::String localFingerprint;
    juce::String pluginVersion;
    bool noPlugin = false;
    runOnMessageThreadSync ([&]() {
        auto* hp = hostedProcessor (processor);
        if (! hp) { noPlugin = true; return; }
        localFingerprint = computeTargetFingerprint();
        pluginVersion    = hp->getPluginDescription().version;
    });
    if (noPlugin) throw RpcError { kErrNoPlugin, "No plugin loaded" };

    if (callerFingerprint.isNotEmpty()
        && callerFingerprint.compareIgnoreCase(localFingerprint) != 0)
    {
        // 5.7.1 Tier-3: distinct error so the client UI can prompt
        // "the loaded plugin doesn't match — reload the matching plugin
        // and try again" rather than the generic "send failed" path.
        throw RpcError { kErrTargetMismatch,
            "Loaded plugin doesn't match the recommendation target. "
            "Reload the matching plugin and try again." };
    }

    if (minVersionRaw.isNotEmpty() && maxVersionRaw.isNotEmpty()
        && pluginVersion.isNotEmpty())
    {
        // 5.7.1 Tier-3: natural-string compare (juce::String::compareNatural)
        // groups digit runs and sorts "1.10" > "1.9" correctly. This is
        // the JUCE idiom for semver-ish comparisons without pulling in a
        // dependency.
        const auto minV = normaliseSemver(minVersionRaw);
        const auto maxV = normaliseSemver(maxVersionRaw);
        const auto pv   = normaliseSemver(pluginVersion);
        if (pv.compareNatural(minV) < 0 || pv.compareNatural(maxV) > 0)
        {
            throw RpcError { kErrVersionMismatch,
                juce::String("Hosted plugin version ") + pv
                + juce::String(" is outside [") + minV
                + juce::String(", ") + maxV + juce::String("].") };
        }
    }

    // 5.7.1 Tier-3: forward to set_parameters with the same `updates`
    // shape — additive, no incompatible schema change. This means an
    // old client that doesn't know about recommend.eq can just keep
    // calling host.set_parameters and lose only the validation guards.
    return handleSetParameters (params);
}

juce::var RpcServer::makeErrorObject (int code, const juce::String& message)
{
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("code", code);
    o->setProperty ("message", message);
    return juce::var (o.get());
}
