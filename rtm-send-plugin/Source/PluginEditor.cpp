#include "PluginEditor.h"

namespace
{
    constexpr int kBaseWidth  = 360;
    constexpr int kBaseHeight = 580;  // 1.1.0 spike: room for the host-slot row
    constexpr int kHostedGap  = 12;
    // Backwards-compat for the existing draw code that uses kWidth/kHeight.
    constexpr int kWidth  = kBaseWidth;
    constexpr int kHeight = kBaseHeight;

    // Bottega-veneta palette - same swatches as the RTMcompare app.
    const juce::Colour kBg       { 14,  13,  11 };
    const juce::Colour kGold     { 208, 176, 102 };
    const juce::Colour kInk      { 235, 231, 224 };
    const juce::Colour kMuted    { 141, 134, 123 };
    const juce::Colour kDim      { 87,  83,  78  };
    const juce::Colour kBorder = juce::Colour::fromRGBA (168, 161, 150, static_cast<juce::uint8> (0.15f * 255));
}

RtmSendAudioProcessorEditor::RtmSendAudioProcessorEditor(RtmSendAudioProcessor& p)
    : AudioProcessorEditor(&p), processor(p)
{
    // 1.1.0 spike: editor must be resizable so the host honours the
    // setSize() call we issue when a hosted plugin's editor is
    // embedded — without this Wavelab (and most VST3 hosts) clamps
    // the window to the original startup size and the embedded
    // editor gets clipped.
    //
    // Min limits are deliberately low so a user can shrink to fit
    // when a big plugin (Kirchhoff EQ ~1800 px, Ozone ~1500 px)
    // overflows the screen — the AffineTransform inside
    // HostedEditorHolder scales the plugin's GUI to whatever space
    // we give it.
    //
    // useDragger=false so the host's own window border owns the
    // resize. With useDragger=true we got a corner gripper that
    // would clamp itself to a smaller bound and then refuse to
    // re-grow because the gripper kept thinking it was at the
    // pre-shrink edge.
    setResizable(/*resizable*/ true, /*useDragger*/ false);
    setResizeLimits(kBaseWidth, /*minH*/ 320, /*maxW*/ 4096, /*maxH*/ 4096);
    setSize(kWidth, kHeight);

    // 5.2.4: Console Didone shell — every child component picks up
    // the v5.2 palette + sharp 2px corners + outline buttons via this
    // LookAndFeel. Per-button colour overrides below were removed
    // because the LookAndFeel now owns the visual contract.
    setLookAndFeel (&lookAndFeel);

    // Wordmark — Instrument Serif, cream, upright. Falls back to the
    // platform serif if Instrument Serif isn't installed system-wide
    // (JUCE's Font ctor accepts the family name; missing fonts fall
    // through the system stack). Mirrors the v5.2 Wordmark
    // component's `size="md"` (~30 px) used in HeaderV2.
    titleLabel.setText("RTMsend", juce::dontSendNotification);
    titleLabel.setFont (juce::Font ("Instrument Serif", 30.0f, juce::Font::plain)
                            .withExtraKerningFactor (0.02f));
    titleLabel.setColour (juce::Label::textColourId, kInk);
    titleLabel.setJustificationType (juce::Justification::centredLeft);
    addAndMakeVisible (titleLabel);

    // 5.3: italic kicker — same pattern as RTMcompare's empty-state
    // cover and RTMprofile. Console Didone tagline carrier.
    subtitleLabel.setText ("One button between your bus and a verdict.",
                           juce::dontSendNotification);
    subtitleLabel.setFont (juce::Font ("Instrument Serif", 14.0f, juce::Font::italic));
    subtitleLabel.setColour (juce::Label::textColourId, kInk.brighter (0.62f));  // sand-secondary
    subtitleLabel.setJustificationType (juce::Justification::centredLeft);
    addAndMakeVisible (subtitleLabel);

    // Host hint — italic display serif, sand-secondary, decorative
    // tag-line treatment. 5.2.4 demoted from gold to sand because
    // gold is reserved for the primary Single button (see below).
    hostHintLabel.setText(buildHostHint(), juce::dontSendNotification);
    hostHintLabel.setFont (juce::Font ("Instrument Serif", 11.0f, juce::Font::italic));
    hostHintLabel.setColour (juce::Label::textColourId, juce::Colour (214, 209, 198));
    hostHintLabel.setJustificationType (juce::Justification::centredLeft);
    addAndMakeVisible (hostHintLabel);

    // 5.2.4: per the "gold once per screen" rule, only Single carries
    // gold treatment. Compare B and Album/Batch render as neutral
    // outlined buttons via the LookAndFeel default. The setComponentID
    // hook tells the LookAndFeel which button to paint primary.
    sendSingleButton.setButtonText ("Single");
    sendSingleButton.setComponentID ("rtm-primary");
    sendSingleButton.setTooltip ("Analyse this buffer as a standalone master - LUFS / TP / spectrum / engineer tips.");
    sendSingleButton.onClick = [this] { onSendClicked (RtmSendAudioProcessor::Route::Single); };
    addAndMakeVisible (sendSingleButton);

    sendCompareButton.setButtonText ("Compare B");
    sendCompareButton.setTooltip ("Drop into the Compare mode File B slot - A/B against whatever reference is already loaded.");
    sendCompareButton.onClick = [this] { onSendClicked (RtmSendAudioProcessor::Route::CompareB); };
    addAndMakeVisible (sendCompareButton);

    sendBatchButton.setButtonText ("Album / Batch");
    sendBatchButton.setTooltip ("Add this capture to the Album / Batch surface in RTMcompare. Multiple sends accumulate into one table.");
    sendBatchButton.onClick = [this] { onSendClicked (RtmSendAudioProcessor::Route::Batch); };
    addAndMakeVisible (sendBatchButton);

    statusLabel.setText("Ready.", juce::dontSendNotification);
    statusLabel.setFont(juce::Font(10.0f));
    statusLabel.setColour(juce::Label::textColourId, kMuted);
    statusLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(statusLabel);

    sessionLabel.setText("Session name", juce::dontSendNotification);
    sessionLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    sessionLabel.setColour(juce::Label::textColourId, kDim);
    sessionLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(sessionLabel);

    sessionInput.setText(processor.getSessionName(), false);
    sessionInput.setColour(juce::TextEditor::textColourId, kInk);
    sessionInput.setColour(juce::TextEditor::backgroundColourId, juce::Colour(30, 28, 24));
    sessionInput.setColour(juce::TextEditor::outlineColourId, kBorder);
    sessionInput.setMultiLine(false);
    sessionInput.onTextChange = [this] { processor.setSessionName(sessionInput.getText()); };
    addAndMakeVisible(sessionInput);

    bufferLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    bufferLabel.setColour(juce::Label::textColourId, kDim);
    bufferLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(bufferLabel);

    sourceLabel.setText("Source", juce::dontSendNotification);
    sourceLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    sourceLabel.setColour(juce::Label::textColourId, kDim);
    sourceLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(sourceLabel);

    sourceBox.addItem("Last N seconds (ring buffer)", 1);
    sourceBox.addItem("DAW loop / selection region", 2);
    sourceBox.addItem("Triggered region (Rec / Stop below)", 3);
    sourceBox.addItem("ARA region / marker (Wavelab, Studio One, ...)", 4);
    sourceBox.setSelectedId(static_cast<int>(processor.getSource()) + 1, juce::dontSendNotification);
    sourceBox.setColour(juce::ComboBox::textColourId, kInk);
    sourceBox.setColour(juce::ComboBox::backgroundColourId, juce::Colour(30, 28, 24));
    sourceBox.setColour(juce::ComboBox::outlineColourId, kBorder);
    sourceBox.setColour(juce::ComboBox::arrowColourId, kGold);
    sourceBox.onChange = [this] {
        const int idx = sourceBox.getSelectedId() - 1;
        processor.setSource(static_cast<RtmSendAudioProcessor::Source>(idx));
    };
    addAndMakeVisible(sourceBox);

    // Region / marker picker is always visible. Picking an item
    // flips Source to ARA so the next Send captures it.
    regionLabel.setText("Region / marker", juce::dontSendNotification);
    regionLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    regionLabel.setColour(juce::Label::textColourId, kDim);
    regionLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(regionLabel);

    regionBox.setColour(juce::ComboBox::textColourId, kInk);
    regionBox.setColour(juce::ComboBox::backgroundColourId, juce::Colour(30, 28, 24));
    regionBox.setColour(juce::ComboBox::outlineColourId, kBorder);
    regionBox.setColour(juce::ComboBox::arrowColourId, kGold);
    regionBox.onChange = [this] {
        const int id = regionBox.getSelectedId();
        if (id <= 0) { processor.setSelectedAraRegionId({}); return; }
        const auto& list = lastRegionIds;
        const int idx = regionBox.getSelectedItemIndex();
        if (idx >= 0 && idx < static_cast<int>(list.size()))
        {
            processor.setSelectedAraRegionId(list[static_cast<size_t>(idx)]);
            // Flip Source so the next Send captures this region
            // instead of the ring.
            processor.setSource(RtmSendAudioProcessor::Source::AraRegion);
            sourceBox.setSelectedId(static_cast<int>(RtmSendAudioProcessor::Source::AraRegion) + 1,
                                    juce::dontSendNotification);
        }
    };
    addAndMakeVisible(regionBox);

    // Rec/Stop toggle; only enabled when Source = Triggered.
    triggerButton.setButtonText ("REC region");
    triggerButton.setComponentID ("rtm-warning"); // 5.2.4: routed via LookAndFeel — paints in warm-red, transparent fill, sharp 2px border. Replaces the inline buttonColourId / textColourOffId/OnId overrides which the LookAndFeel now ignores.
    triggerButton.setTooltip ("Start / stop a triggered capture. Anything played between REC and STOP goes into the buffer.");
    triggerButton.onClick = [this] {
        if (processor.isTriggeredCapturing()) processor.stopTriggeredCapture();
        else processor.startTriggeredCapture();
    };
    addAndMakeVisible(triggerButton);

    bufferSlider.setRange(5.0, RtmSendAudioProcessor::kMaxBufferSeconds, 1.0);
    bufferSlider.setValue(processor.getBufferSeconds(), juce::dontSendNotification);
    bufferSlider.setTextValueSuffix(" s");
    bufferSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    bufferSlider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 64, 20);
    bufferSlider.setColour(juce::Slider::trackColourId, kGold.withAlpha(0.5f));
    bufferSlider.setColour(juce::Slider::thumbColourId, kGold);
    bufferSlider.setColour(juce::Slider::textBoxTextColourId, kInk);
    bufferSlider.setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
    bufferSlider.onValueChange = [this] { processor.setBufferSeconds(bufferSlider.getValue()); };
    addAndMakeVisible(bufferSlider);

    // 1.1.0 spike: plugin-host slot UI.
    pluginSlotLabel.setText("Plugin slot", juce::dontSendNotification);
    pluginSlotLabel.setFont(juce::Font(12.0f, juce::Font::plain));
    pluginSlotLabel.setColour(juce::Label::textColourId, kInk);
    addAndMakeVisible(pluginSlotLabel);

    pluginPickButton.setButtonText("Pick");
    pluginPickButton.onClick = [this] { openPluginPicker(); };
    addAndMakeVisible(pluginPickButton);

    pluginScanButton.setButtonText("Scan");
    pluginScanButton.onClick = [this] {
        pluginScanButton.setEnabled(false);
        pluginScanButton.setButtonText("Scanning...");
        // 5.7.x audit fix: SafePointer<Component> guards the editor
        // outliving the scan. If the host closes RTMsend's editor
        // mid-scan, the completion lambda was previously dereferencing
        // a freed editor (`this`) when it called pluginScanButton on
        // the message thread. SafePointer goes null once the editor
        // is destroyed.
        juce::Component::SafePointer<RtmSendAudioProcessorEditor> safeThis (this);
        processor.scanForPluginsAsync([safeThis] {
            if (auto* self = safeThis.getComponent())
            {
                self->pluginScanButton.setButtonText("Scan");
                self->pluginScanButton.setEnabled(true);
            }
        });
    };
    addAndMakeVisible(pluginScanButton);

    pluginEditorButton.setButtonText("Open");
    pluginEditorButton.onClick = [this] {
        if (processor.isHostedPluginWindowOpen())
            processor.hideHostedPluginWindow();
        else
            processor.showHostedPluginWindow();
        refreshPluginSlotUi();
    };
    addAndMakeVisible(pluginEditorButton);

    pluginUnloadButton.setButtonText("Eject");
    pluginUnloadButton.onClick = [this] {
        // Window is closed inside unloadHostedPlugin — no need to
        // touch it from the editor side any more.
        processor.unloadHostedPlugin();
        refreshPluginSlotUi();
    };
    addAndMakeVisible(pluginUnloadButton);

    pluginStatusLabel.setFont(juce::Font(11.0f, juce::Font::italic));
    pluginStatusLabel.setColour(juce::Label::textColourId, kMuted);
    addAndMakeVisible(pluginStatusLabel);

    refreshPluginSlotUi();

    startTimerHz(4);  // 250 ms status refresh
}

RtmSendAudioProcessorEditor::~RtmSendAudioProcessorEditor()
{
    // 1.1.1: hosted plugin's editor now lives in a DocumentWindow
    // owned by the PROCESSOR (HostedPluginWindow). It's no longer
    // our concern at all — the window survives this editor being
    // destroyed, which is the whole point of the refactor. When the
    // user reopens RTMsend's window in Wavelab, the plugin's window
    // is already there (or hidden, if they explicitly closed it).

    // 5.2.4: must un-set the LookAndFeel before this editor (and its
    // owned `lookAndFeel` member) is destroyed — otherwise child
    // components hold a dangling pointer for the remainder of paint
    // events still in the queue. JUCE best practice.
    setLookAndFeel (nullptr);
    stopTimer();
}

void RtmSendAudioProcessorEditor::paint(juce::Graphics& g)
{
    g.fillAll(kBg);
    g.setColour(kBorder);
    g.fillRect(0, kHeight - 1, kWidth, 1);  // hairline bottom
}

void RtmSendAudioProcessorEditor::resized()
{
    // 1.1.1: hosted plugin is now in its own DocumentWindow, owned by
    // the processor. RTMsend's editor is just the chrome column —
    // fixed compact width, fills its window. No more split layout
    // between RTMsend chrome and embedded plugin.
    auto r = getLocalBounds().reduced (16);
    // Title is 30 px font - needs ~38 px box height (font ascent +
    // descent + some breathing room). 22 px was clipping the top of
    // the "R". Bumping to 40 px and pushing down 6 px keeps the
    // serif crown visible.
    r.removeFromTop (6);
    titleLabel.setBounds(r.removeFromTop(40));
    subtitleLabel.setBounds(r.removeFromTop(18));
    hostHintLabel.setBounds(r.removeFromTop(16));
    r.removeFromTop(8);

    sessionLabel.setBounds(r.removeFromTop(14));
    sessionInput.setBounds(r.removeFromTop(24));
    r.removeFromTop(10);

    sourceLabel.setBounds(r.removeFromTop(14));
    sourceBox.setBounds(r.removeFromTop(26));
    r.removeFromTop(8);

    regionLabel.setBounds(r.removeFromTop(14));
    regionBox.setBounds(r.removeFromTop(26));
    r.removeFromTop(4);
    triggerButton.setBounds(r.removeFromTop(24));
    r.removeFromTop(10);

    bufferLabel.setBounds(r.removeFromTop(14));
    bufferSlider.setBounds(r.removeFromTop(24));
    r.removeFromTop(12);

    // 1.1.0 spike: plugin-host slot row.
    pluginSlotLabel.setBounds(r.removeFromTop(14));
    {
        auto slotRow = r.removeFromTop(26);
        const int gap = 4;
        const int total = slotRow.getWidth() - 3 * gap;
        const int w = total / 4;
        pluginPickButton.setBounds(slotRow.removeFromLeft(w));
        slotRow.removeFromLeft(gap);
        pluginScanButton.setBounds(slotRow.removeFromLeft(w));
        slotRow.removeFromLeft(gap);
        pluginEditorButton.setBounds(slotRow.removeFromLeft(w));
        slotRow.removeFromLeft(gap);
        pluginUnloadButton.setBounds(slotRow);
    }
    pluginStatusLabel.setBounds(r.removeFromTop(16));
    r.removeFromTop(10);

    auto buttonRow = r.removeFromTop(36);
    const int gap   = 6;
    const int total = buttonRow.getWidth() - 2 * gap;
    const int w     = total / 3;
    sendSingleButton.setBounds(buttonRow.removeFromLeft(w));
    buttonRow.removeFromLeft(gap);
    sendCompareButton.setBounds(buttonRow.removeFromLeft(w));
    buttonRow.removeFromLeft(gap);
    sendBatchButton.setBounds(buttonRow);
    r.removeFromTop(10);
    statusLabel.setBounds(r.removeFromTop(16));
}

void RtmSendAudioProcessorEditor::timerCallback()
{
    bufferLabel.setText("Buffer length - " + juce::String(static_cast<int>(processor.getBufferSeconds())) + " s",
                        juce::dontSendNotification);
    const auto s = processor.getLastStatus();
    if (s.isNotEmpty()) statusLabel.setText(s, juce::dontSendNotification);

    const auto src = processor.getSource();
    const bool triggeredMode = src == RtmSendAudioProcessor::Source::TriggeredRegion;
    const bool ringMode      = src == RtmSendAudioProcessor::Source::LastNSeconds;
    const bool loopMode      = src == RtmSendAudioProcessor::Source::LoopRegion;
    const bool araMode       = src == RtmSendAudioProcessor::Source::AraRegion;

    triggerButton.setVisible(triggeredMode);
    triggerButton.setEnabled(triggeredMode);
    triggerButton.setButtonText(processor.isTriggeredCapturing() ? "STOP capture" : "REC region");

    // Dim but keep clickable - a pick flips Source to ARA.
    regionBox.setAlpha(araMode ? 1.0f : 0.65f);
    regionLabel.setAlpha(araMode ? 1.0f : 0.65f);

    bufferSlider.setEnabled(ringMode);
    bufferSlider.setAlpha(ringMode ? 1.0f : 0.35f);
    bufferLabel.setAlpha(ringMode ? 1.0f : 0.35f);

    // Loop mode but no loop points yet - tell the user.
    if (loopMode && !processor.hostHasLoopPoints())
    {
        statusLabel.setColour(juce::Label::textColourId, juce::Colour(197, 165, 90));
        statusLabel.setText("Set loop points in the DAW + play across them once.",
                            juce::dontSendNotification);
    }

    // Rebuild the combo only on an actual revision bump.
    if (auto model = processor.getAraRegionsModel())
    {
        const auto rev = model->getRevision();
        if (rev != lastRegionsRevision)
        {
            lastRegionsRevision = rev;
            refreshRegionBox();
        }
        // ARA picked but the host hasn't published any regions yet.
        if (araMode && model->empty())
        {
            statusLabel.setColour(juce::Label::textColourId, juce::Colour(141, 134, 123));
            statusLabel.setText("No ARA regions yet - open a montage with clips in the host.",
                                juce::dontSendNotification);
        }
    }
}

void RtmSendAudioProcessorEditor::refreshRegionBox()
{
    regionBox.clear(juce::dontSendNotification);
    lastRegionIds.clear();

    auto model = processor.getAraRegionsModel();
    if (!model)
    {
        regionBox.addItem("Host does not publish regions - use another Source", -1);
        regionBox.setSelectedId(-1, juce::dontSendNotification);
        return;
    }

    const auto regions = model->getRegionsSnapshot();
    const auto markers = model->getMarkersSnapshot();

    if (regions.empty() && markers.empty())
    {
        regionBox.addItem("No ARA regions / markers available", -1);
        regionBox.setSelectedId(-1, juce::dontSendNotification);
        return;
    }

    int id = 1;
    for (const auto& r : regions)
    {
        const auto start = juce::String(r.startSec, 2);
        const auto end   = juce::String(r.endSec, 2);
        const auto label = r.name + juce::String("  |  ")
                           + start + juce::String(" -> ") + end + juce::String(" s")
                           + (r.audioSourceName.isNotEmpty() ? (juce::String("  |  ") + r.audioSourceName) : juce::String());
        regionBox.addItem(label, id++);
        lastRegionIds.push_back(r.id);
    }

    if (!markers.empty())
    {
        regionBox.addSeparator();
        regionBox.addSectionHeading("Between markers");
        for (size_t i = 0; i + 1 < markers.size(); ++i)
        {
            const auto& a = markers[i];
            const auto& b = markers[i + 1];
            const auto label = juce::String("[ ") + a.name + juce::String(" -> ") + b.name
                               + juce::String("  |  ")
                               + juce::String(a.positionSec, 2) + juce::String(" -> ")
                               + juce::String(b.positionSec, 2) + juce::String(" s ]");
            regionBox.addItem(label, id++);
            lastRegionIds.push_back(juce::String("M:") + juce::String((int)i) + juce::String(":") + juce::String((int)i + 1));
        }
    }

    // Re-select after rebuild if the id survived.
    const auto selectedId = processor.getSelectedAraRegionId();
    if (selectedId.isNotEmpty())
    {
        for (size_t i = 0; i < lastRegionIds.size(); ++i)
        {
            if (lastRegionIds[i] == selectedId)
            {
                regionBox.setSelectedItemIndex(static_cast<int>(i), juce::dontSendNotification);
                return;
            }
        }
    }
    regionBox.setSelectedId(1, juce::dontSendNotification);
    if (!lastRegionIds.empty())
        processor.setSelectedAraRegionId(lastRegionIds[0]);
}

juce::String RtmSendAudioProcessorEditor::buildHostHint() const
{
    // PluginHostType doesn't detect Standalone; check wrapperType first.
    if (processor.wrapperType == juce::AudioProcessor::wrapperType_Standalone)
        return "Standalone: pick an input, then Send.";

    // 5.7.x audit fix: when running as an AU, RTMsend's host-side
    // plugin scan deliberately skips the AU format (avoids Wavelab-
    // style crashes when a third-party AU's constructor throws on
    // the main thread). Surface that in the hint so a Logic user who
    // wonders "why doesn't Pro-Q AU show up in the picker?" gets the
    // answer immediately.
    juce::String suffix;
    if (processor.wrapperType == juce::AudioProcessor::wrapperType_AudioUnit
        || processor.wrapperType == juce::AudioProcessor::wrapperType_AudioUnitv3)
        suffix = " · Send-to-Plugin: VST3-only.";

    juce::PluginHostType h;
    if (h.isLogic())                 return "Logic Pro: any Source works. ARA arrives in v4.0.1." + suffix;
    if (h.isProTools())              return "Pro Tools: use Last N seconds or Triggered (AAX, no ARA)." + suffix;
    if (h.isAbletonLive())           return "Ableton Live: use Last N seconds or Triggered (no ARA)." + suffix;
    if (h.isCubase() || h.isNuendo())return "Cubase / Nuendo: ARA works - pick a region below." + suffix;
    if (h.isStudioOne())             return "Studio One: ARA works - pick an event below." + suffix;
    if (h.isReaper())                return "REAPER 7+: ARA works - pick a media item below." + suffix;
    if (h.isBitwigStudio())          return "Bitwig: use Last N seconds or Triggered (no ARA)." + suffix;
    if (h.isWavelab())               return "Wavelab: pick a clip from the Region list below." + suffix;
    if (h.isGarageBand())            return "GarageBand: Last N seconds or Triggered (limited host)." + suffix;
    if (h.isMainStage())             return "MainStage: Last N seconds or Triggered (live use)." + suffix;
    return "Pick a Source below - ARA region if your host publishes clips." + suffix;
}

void RtmSendAudioProcessorEditor::onSendClicked(RtmSendAudioProcessor::Route route)
{
    juce::String err;
    auto path = processor.sendSnapshotToRtm(route, err);
    if (path.isEmpty())
    {
        statusLabel.setColour(juce::Label::textColourId, juce::Colour(224, 90, 90));
        statusLabel.setText(err.isEmpty() ? "Send failed." : err, juce::dontSendNotification);
    }
    else
    {
        statusLabel.setColour(juce::Label::textColourId, juce::Colour(110, 197, 119));
        juce::String routeStr;
        switch (route) {
            case RtmSendAudioProcessor::Route::Single:   routeStr = "Single-file analysis."; break;
            case RtmSendAudioProcessor::Route::CompareB: routeStr = "Compare (File B).";    break;
            case RtmSendAudioProcessor::Route::Batch:    routeStr = "Album / Batch.";       break;
        }
        statusLabel.setText("Sent to RTM - " + routeStr, juce::dontSendNotification);
    }
}

// ─── 1.1.0 spike: plugin slot UI helpers ──────────────────────────

void RtmSendAudioProcessorEditor::refreshPluginSlotUi()
{
    const auto name = processor.getHostedPluginName();
    const bool loaded = name.isNotEmpty();
    pluginStatusLabel.setText(loaded ? ("Hosting: " + name) : "Empty slot - Pick a VST3/AU to load.",
                              juce::dontSendNotification);
    pluginEditorButton.setEnabled(loaded);
    pluginEditorButton.setButtonText(processor.isHostedPluginWindowOpen() ? "Close" : "Open");
    pluginUnloadButton.setEnabled(loaded);
}

void RtmSendAudioProcessorEditor::openPluginPicker()
{
    auto& known = processor.getKnownPluginList();
    const auto types = known.getTypes();

    if (types.isEmpty())
    {
        pluginStatusLabel.setText("No scanned plugins yet - click Scan to populate.",
                                  juce::dontSendNotification);
        return;
    }

    juce::PopupMenu menu;
    juce::KnownPluginList::addToMenu(menu, types,
                                     juce::KnownPluginList::sortAlphabetically);

    // 5.7.x: anchor the menu to a SNAPSHOT of the button's screen rect,
    // not to the live component reference. Logic Pro's plugin-window
    // host applies subtle layout transitions on focus/hover that can
    // shift the editor's screen position by 1–2 px after the menu has
    // opened. With withTargetComponent(&btn), JUCE re-queries the
    // component's screen position on every redraw and the menu visibly
    // jumps. With withTargetScreenArea(rect), the menu position is
    // fixed once and ignores parent-window movement.
    const auto screenRect = pluginPickButton.getScreenBounds();
    menu.showMenuAsync(juce::PopupMenu::Options{}.withTargetScreenArea(screenRect),
        [this, types](int result)
        {
            if (result <= 0) return;
            const int idx = juce::KnownPluginList::getIndexChosenByMenu(types, result);
            if (idx < 0 || idx >= types.size()) return;

            // The processor handles tearing down the OLD plugin's
            // window before swapping (via hostedPluginWindow.reset()
            // inside loadHostedPlugin). If the previous window was
            // open, the new plugin's window auto-opens — matches
            // the user's expectation of "I had Pro-Q open, switched
            // to Kirchhoff, Kirchhoff opens."
            const auto err = processor.loadHostedPlugin(types.getReference(idx));
            if (err.isNotEmpty())
                pluginStatusLabel.setText("Load failed: " + err, juce::dontSendNotification);
            refreshPluginSlotUi();
        });
}

void RtmSendAudioProcessorEditor::openHostedEditor()
{
    // 1.1.1: kept for compat with chrome-collapse code paths that
    // still call this. Forwards to the processor's floating-window
    // owner so the plugin survives RTMsend's editor lifecycle.
    processor.showHostedPluginWindow();
    refreshPluginSlotUi();
}

void RtmSendAudioProcessorEditor::closeHostedEditor()
{
    // 1.1.1: forwards to processor (see openHostedEditor note).
    processor.hideHostedPluginWindow();
    refreshPluginSlotUi();
}

void RtmSendAudioProcessorEditor::resizeForHostedEditor()
{
    // 1.1.1: hosted plugin lives in its own DocumentWindow now, so
    // RTMsend's editor stays at its compact base size regardless of
    // what's loaded. This is just a no-op kept for source compat
    // (still called from a couple of legacy paths).
    setSize(kBaseWidth, kBaseHeight);
}

// 1.1.1: setChromeCollapsed removed. The hosted plugin is now in its
// own DocumentWindow (HostedPluginWindow on the processor) so RTMsend's
// chrome no longer fights for screen space - both windows are
// independent, draggable, sized to their own content.
