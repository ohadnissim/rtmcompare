#pragma once

#include <JuceHeader.h>
#include <atomic>
#include <functional>
#include <memory>

class RtmSendAudioProcessor;

// 1.1.0 — localhost JSON-RPC 2.0 server. The point: let RTMcompare
// (or any other local client) push parameter values into the plugin
// hosted in our slot — so the EQ Preview's suggested move can land
// inside the engineer's FabFilter Pro-Q without copy-pasting nine
// numbers.
//
// Wire format: newline-delimited JSON-RPC 2.0 over TCP.
//   request:  {"jsonrpc":"2.0","method":"host.set_parameters","params":{"updates":[{"index":5,"value":0.42}]},"id":7}
//   response: {"jsonrpc":"2.0","result":{...},"id":7}
//   error:    {"jsonrpc":"2.0","error":{"code":-32601,"message":"..."},"id":7}
//
// Bind: the OS picks a free port on localhost; we write it to
// `~/.rtm/rtmsend.port` (legacy single-line ASCII integer) so pre-5.7.0
// RTMcompare clients still find us. New clients prefer the per-instance
// metadata file `~/.rtm/rtmsend-<pid>-<uuid8>.port` (JSON) so they can
// disambiguate when multiple RTMsend instances are loaded across DAW
// projects. Files are rewritten every launch; per-instance file is
// removed on stop(). Legacy file is intentionally NOT removed (another
// instance may have written over it and own it now).
//
// Threading:
//   - Listener thread: accepts a connection, reads requests, writes
//     responses. One client at a time (we don't need fan-out).
//   - State-changing handlers marshal onto the JUCE message thread
//     via MessageManager::callAsync so parameter writes happen on the
//     thread that owns the AudioProcessor lifecycle. Responses then
//     come back to the listener thread via a shared promise.
//
// Methods exposed at v1:
//   - host.ping                  → "pong" (sanity check, legacy)
//   - host.get_loaded_plugin     → {name, format, version, parameter_count, sample_rate}
//   - host.list_parameters       → [{index, name, label, current, default, min, max}]
//   - host.find_parameters       → filter list_parameters by name regex
//   - host.set_parameters        → batch apply [{index, value}] (value is 0..1 normalised)
//   - host.bypass                → master bypass on/off
//
// 5.7.1 Tier-3 additions:
//   - host.ping (extended)  → rich handshake payload (build, host_app, plugin_loaded, etc.)
//   - recommend.eq          → semantic update with target-fingerprint guard
//
// Not in v1 (deferred):
//   - State save/load (plugin-specific opaque blobs)
//   - Plugin scan / load / unload over RPC (stays in the editor UI)
//   - MCP-spec wrapping (tools/list, tools/call) — easy to layer
//     later because the methods are already shaped like MCP tools.
class RpcServer : private juce::Thread
{
public:
    explicit RpcServer(RtmSendAudioProcessor& processor);
    ~RpcServer() override;

    void start();
    void stop();

    int getPort() const noexcept { return port.load(std::memory_order_acquire); }
    juce::File getPortFile() const;             // legacy ~/.rtm/rtmsend.port
    juce::File getInstancePortFile() const;     // 5.7.1 Tier-3: per-instance JSON file

private:
    // Thrown by handlers to bubble a JSON-RPC error up to the
    // connection loop, which writes it into the `error` field.
    struct RpcError
    {
        int code;
        juce::String message;
    };

    void run() override;
    void handleConnection(std::unique_ptr<juce::StreamingSocket> connection);
    juce::var dispatch(const juce::String& method, const juce::var& params);

    // Method handlers — must be safe to call off the message thread.
    // Reads-only ones do their work directly; writes marshal via
    // MessageManager::callAsync and block on a juce::WaitableEvent.
    // Handlers throw RpcError on failure.
    juce::var handlePing(const juce::var& params);
    juce::var handleGetLoadedPlugin(const juce::var& params);
    juce::var handleListParameters(const juce::var& params);
    juce::var handleFindParameters(const juce::var& params);
    juce::var handleSetParameters(const juce::var& params);
    juce::var handleBypass(const juce::var& params);
    juce::var handleAraState(const juce::var& params);
    // 5.7.1 Tier-3: semantic EQ recommendation entry point. Wraps
    // host.set_parameters with target-fingerprint validation and
    // optional version-range guards so the caller can detect when
    // the loaded plugin is the wrong target before pushing values.
    juce::var handleRecommendEq(const juce::var& params);

    static juce::var makeErrorObject(int code, const juce::String& message);
    static juce::var paramSnapshot(int index, const juce::AudioProcessorParameter& p);
    // Map non-finite floats (NaN / Infinity) to 0.0 — JUCE's JSON
    // serialiser would emit them as literal "NaN"/"Infinity" which
    // breaks Node's JSON.parse on the bridge side. See RpcServer.cpp.
    static double sanitiseFinite(double v) noexcept;

    // 5.7.1 Tier-3: SHA-256 of "<format>|<plugin uid>|<plugin version>|<param count>".
    // Stable across a single hosted plugin load; recomputed each time
    // we resolve the hosted plugin so a re-load re-validates.
    juce::String computeTargetFingerprint() const;

    RtmSendAudioProcessor& processor;
    std::unique_ptr<juce::StreamingSocket> listener;
    std::atomic<int> port { 0 };

    // 5.7.1 Tier-3: per-instance discovery file. Generated once in the
    // ctor (uuid8 stays stable for this RpcServer's lifetime so the
    // filename is stable across start/stop cycles). The legacy file
    // path is the single shared file all instances overwrite.
    juce::String instanceUuid8;

    // Per-instance 128-bit random auth token (hex). Written to the
    // per-instance JSON port file on start(); every new connection must
    // send this token as its first line before any RPC traffic is
    // accepted. Regenerated on each start() call.
    juce::String rpcAuthToken;

    // Generates a 128-bit cryptographically random token as a 32-char hex string.
    static juce::String generateAuthToken();

    // Active per-connection sockets. Each is added before the connection
    // thread launches and removed when the thread exits. stop() closes
    // every socket so all connection threads unblock from readLine and
    // exit cleanly before we return — prevents UAF when the RpcServer
    // is destroyed while a connection is still open.
    juce::CriticalSection activeConnsMutex;
    std::vector<juce::StreamingSocket*> activeConns;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(RpcServer)
};
