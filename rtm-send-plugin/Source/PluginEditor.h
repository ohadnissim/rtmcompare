#pragma once

#include <JuceHeader.h>
#include "PluginProcessor.h"
#include "ConsoleDidoneLookAndFeel.h"

// Editor: title, three Send buttons (Single / Compare / Batch),
// status line, source + region dropdowns, trigger button, buffer
// slider, session-name input, host hint. Deliberately sparse -
// this plugin is a one-button bridge. All drawn strings are
// ASCII-only so JUCE's default font renders them on every macOS.
class RtmSendAudioProcessorEditor : public juce::AudioProcessorEditor,
                                    private juce::Timer
{
public:
    explicit RtmSendAudioProcessorEditor(RtmSendAudioProcessor& p);
    ~RtmSendAudioProcessorEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;
    // Pro Tools (AAX) crashes when a plugin NSView uses CoreAnimation
    // layer backing (the JUCE 8 default on macOS 10.14+). Return false
    // to force synchronous CoreGraphics rendering, which PT supports.
    bool wantsLayerBackedView() const override { return false; }
    void visibilityChanged() override;

private:
    void timerCallback() override;
    void onSendClicked(RtmSendAudioProcessor::Route route);

    RtmSendAudioProcessor& processor;

    // 5.2.4 — Console Didone shell aesthetic. setLookAndFeel(&lookAndFeel)
    // in the ctor; setLookAndFeel(nullptr) in the dtor (JUCE best
    // practice — avoids dangling pointer when this editor outlives
    // the look). Buttons that should carry the single gold gesture
    // opt in via setComponentID("rtm-primary").
    ConsoleDidoneLookAndFeel lookAndFeel;

    juce::Label titleLabel;
    juce::Label subtitleLabel;
    // Same snapshot, three RTM surfaces.
    juce::TextButton sendSingleButton;
    juce::TextButton sendCompareButton;
    juce::TextButton sendBatchButton;
    juce::Label statusLabel;

    juce::Label sessionLabel;
    juce::TextEditor sessionInput;

    juce::Label bufferLabel;
    juce::Label signalDotLabel;   // animated ● ● ● / · · · indicator
    juce::Label sendCountLabel;   // "↑ N sends" badge
    juce::Slider bufferSlider;

    // Source picker. Triggered mode reveals Rec/Stop; ARA reveals
    // the region dropdown below.
    juce::Label sourceLabel;
    juce::ComboBox sourceBox;
    juce::TextButton triggerButton;

    // ARA region picker. RegionsModel is rebuilt by the document
    // controller on host edits; we poll the revision in
    // timerCallback for cheap refresh.
    juce::Label regionLabel;
    juce::ComboBox regionBox;
    uint64_t lastRegionsRevision { 0 };
    std::vector<juce::String> lastRegionIds;
    void refreshRegionBox();

    // Cached timer-state: only call setAlpha/setEnabled/setText when
    // the value actually changes to avoid 4 Hz repaint storms that cause
    // visible UI jitter in complex hosts (WaveLab, Nuendo).
    struct TimerCache {
        float  regionAlpha   { -1.f };
        bool   trigVisible   { false };
        bool   trigEnabled   { false };
        float  bufAlpha      { -1.f };
        bool   bufEnabled    { false };
        bool   signalActive  { false };
        int    sendCount     { -1 };
        bool   pluginLoaded  { false };  // tracks hasPlugin for relayout
        juce::String statusText;
        juce::Colour statusColour { juce::Colours::transparentBlack };
        juce::String pluginStatusText;
    } timerCache;

    // One-line DAW-specific tip based on PluginHostType.
    juce::Label hostHintLabel;
    juce::String buildHostHint() const;

    // 1.1.0 spike: hosted-plugin slot UI.
    //   - "Plugin slot" label
    //   - Pick button: opens JUCE's built-in PluginListComponent in a
    //     popup so the user can choose any scanned VST3/AU.
    //   - Scan button: kicks off a background scan of the standard
    //     plug-in folders (~5–60 s on a fresh machine).
    //   - Editor button: opens the hosted plugin's UI in a child
    //     DocumentWindow (so the engineer can dial it in).
    //   - Unload button: clears the slot.
    //   - Status label: shows the loaded plugin name.
    juce::Label pluginSlotLabel;
    juce::TextButton pluginPickButton;
    juce::TextButton pluginScanButton;
    juce::TextButton pluginEditorButton;
    juce::TextButton pluginUnloadButton;
    juce::Label pluginStatusLabel;

    // 1.1.0 spike → v6: plugin owns its size, RTMsend follows.
    //   - Plugin loads at its natural size; we resize OUR window
    //     to fit it.
    //   - User drags the plugin's own resize handle (if it has one)
    //     → ComponentListener fires → callback → our window resizes
    //     to match. RTMsend mirrors the plugin's size like a parent
    //     wrapping a child.
    //   - User drags OUR window border → viewport handles overflow
    //     with scrollbars (rare; user typically lets the plugin's
    //     own controls drive size).
    //
    // We never force setSize on the plugin from our side — plugins
    // that don't support runtime resize would just snap back, and
    // forcing it on plugins that DO support it fights their
    // own resize handles.
    struct HostedEditorHolder : public juce::Component, private juce::ComponentListener
    {
        HostedEditorHolder()
        {
            addAndMakeVisible(viewport);
            viewport.setScrollBarsShown (false, false);  // chrome collapses instead
        }
        ~HostedEditorHolder() override
        {
            if (hosted) hosted->removeComponentListener(this);
        }

        void setEditor(juce::AudioProcessorEditor* ed, std::function<void()> onPluginSizeChanged)
        {
            if (hosted == ed) { onSizeChanged = std::move(onPluginSizeChanged); return; }
            if (hosted)
            {
                hosted->removeComponentListener(this);
                viewport.setViewedComponent(nullptr, false);
            }
            hosted = ed;
            onSizeChanged = std::move(onPluginSizeChanged);
            if (hosted)
            {
                hosted->setBounds(0, 0, hosted->getWidth(), hosted->getHeight());
                hosted->addComponentListener(this);
                viewport.setViewedComponent(hosted, false);
            }
        }

        // Detach + return the hosted editor without deleting it. Caller
        // is now responsible for the proper JUCE teardown handshake:
        //   1. plugin->editorBeingDeleted(ed)   — tells the plugin its
        //      activeEditor slot is being released
        //   2. delete ed                         — actually destroy it
        // Skipping that handshake leaves the plugin's activeEditor
        // pointer stale; the next createEditorIfNeeded returns the
        // dangling pointer and crashes when JUCE tries to reparent it.
        // (See juce-best-practices skill: AudioProcessorEditor lifecycle.)
        juce::AudioProcessorEditor* releaseEditor()
        {
            auto* ed = hosted;
            if (hosted)
            {
                hosted->removeComponentListener(this);
                viewport.setViewedComponent(nullptr, false);
                hosted = nullptr;
            }
            onSizeChanged = nullptr;
            return ed;
        }

        void resized() override
        {
            viewport.setBounds(getLocalBounds());
            // Two-way bridge: when our outer window changes size
            // (user drags the host's window border), pass that
            // through as a setSize hint on the hosted plugin's
            // editor. Plugins that support runtime resize (Kirchhoff
            // EQ's Scale dropdown, FabFilter, modern JUCE plugins)
            // re-layout to fit. Plugins that don't ignore the hint
            // and the bounds we set are simply clipped to viewport.
            //
            // The other direction — plugin scales itself via its
            // own Scale picker / corner handle — fires our
            // ComponentListener which calls back up to RTMsend's
            // editor to resize the outer window. Either lever drives
            // the other side.
            if (hosted && getWidth() > 0 && getHeight() > 0)
            {
                ignoreNextHostedResize = true;
                hosted->setSize(getWidth(), getHeight());
                ignoreNextHostedResize = false;
            }
        }

        juce::AudioProcessorEditor* hosted = nullptr;
        juce::Viewport viewport;

    private:
        void componentMovedOrResized(juce::Component& c, bool /*wasMoved*/, bool wasResized) override
        {
            if (! wasResized || &c != hosted) return;
            // Suppress the bubble-up when we're the ones who just
            // pushed setSize on the plugin (from our resized()
            // hint) — otherwise we'd ping-pong infinitely.
            if (ignoreNextHostedResize) return;
            // Bubble up — RTMsend's editor recomputes its own size
            // to wrap the new plugin dimensions.
            if (onSizeChanged) onSizeChanged();
        }

        std::function<void()> onSizeChanged;
        bool ignoreNextHostedResize = false;
    };
    HostedEditorHolder hostedEditorHolder;

    void openPluginPicker();
    void openHostedEditor();
    void closeHostedEditor();
    void refreshPluginSlotUi();
    void resizeForHostedEditor();

    // 1.1.1: chrome-collapse removed. Was needed when the hosted
    // plugin was embedded inside RTMsend's editor and stealing UX
    // real estate. Now the hosted plugin lives in its own
    // DocumentWindow (HostedPluginWindow on the processor), so
    // RTMsend's window stays compact and there's nothing to
    // collapse. Field/method removed entirely so the broken
    // guillemet glyph ("Â«") goes away too.

    JUCE_DECLARE_WEAK_REFERENCEABLE(RtmSendAudioProcessorEditor)
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(RtmSendAudioProcessorEditor)
};
