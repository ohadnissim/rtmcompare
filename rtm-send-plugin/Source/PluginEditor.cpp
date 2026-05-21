#include "PluginEditor.h"

namespace
{
    constexpr int kBaseWidth  = 360;
    constexpr int kBaseHeight = 580;  // 1.1.0 spike: room for the host-slot row
    constexpr int kHostedGap  = 12;
    // Backwards-compat for the existing draw code that uses kWidth/kHeight.
    constexpr int kWidth  = kBaseWidth;
    constexpr int kHeight = kBaseHeight;

    // 5.2.4: All palette values now reference ConsoleDidoneLookAndFeel
    // static constants. The previous local copies were identical in value
    // but diverged from the LookAndFeel over time (e.g. kBorder alpha
    // differed by 0.03f). One source of truth.
    using LF = ConsoleDidoneLookAndFeel;
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
    // 5.2.4: Instrument Serif is loaded by family name. JUCE resolves it
    // against the system font stack; if the typeface is not installed
    // system-wide, the host platform's default serif is used. To guarantee
    // the typeface on all machines, bundle InstrumentSerif-Regular.ttf into
    // the plugin Resources folder and load it via juce::Typeface::createSystemTypefaceFor
    // in ConsoleDidoneLookAndFeel (see font-loading note in that header).
    titleLabel.setFont (juce::Font ("Instrument Serif", 30.0f, juce::Font::plain)
                            .withExtraKerningFactor (0.02f));
    titleLabel.setColour (juce::Label::textColourId, LF::kCream);
    titleLabel.setJustificationType (juce::Justification::centredLeft);
    addAndMakeVisible (titleLabel);

    // 5.3: italic kicker — same pattern as RTMcompare's empty-state
    // cover and RTMprofile. Console Didone tagline carrier.
    subtitleLabel.setText ("One button between your bus and a verdict.",
                           juce::dontSendNotification);
    subtitleLabel.setFont (juce::Font ("Instrument Serif", 14.0f, juce::Font::italic));
    subtitleLabel.setColour (juce::Label::textColourId, LF::kSandSecondary);
    subtitleLabel.setJustificationType (juce::Justification::centredLeft);
    addAndMakeVisible (subtitleLabel);

    // Compact host-indicator pill — shows just the DAW name so the user
    // can confirm RTMsend is running in the right application. Replaces
    // the verbose 2-line host-hint paragraph that most users found confusing.
    hostHintLabel.setText(buildHostHint(), juce::dontSendNotification);
    hostHintLabel.setFont (juce::Font (10.0f).withExtraKerningFactor(0.08f));
    hostHintLabel.setColour (juce::Label::textColourId, LF::kSandDim);
    hostHintLabel.setJustificationType (juce::Justification::centredRight);
    addAndMakeVisible (hostHintLabel);

    // 5.2.4: per the "gold once per screen" rule, only Single carries
    // gold treatment. Compare B and Album/Batch render as neutral
    // outlined buttons via the LookAndFeel default. The setComponentID
    // hook tells the LookAndFeel which button to paint primary.
    sendSingleButton.setButtonText ("Analyze");
    sendSingleButton.setComponentID ("rtm-primary");
    sendSingleButton.setTooltip ("Analyze this buffer as a standalone master - LUFS / TP / spectrum / engineer tips.");  // NIT-3: US English
    sendSingleButton.onClick = [this] { onSendClicked (RtmSendAudioProcessor::Route::Single); };
    addAndMakeVisible (sendSingleButton);

    sendCompareButton.setButtonText ("Compare");
    sendCompareButton.setTooltip ("Drop into the Compare mode File B slot - A/B against whatever reference is already loaded.");
    sendCompareButton.onClick = [this] { onSendClicked (RtmSendAudioProcessor::Route::CompareB); };
    addAndMakeVisible (sendCompareButton);

    sendBatchButton.setButtonText ("Batch");  // NIT-4: collapse to single word
    sendBatchButton.setTooltip ("Add to Album / Batch in RTMcompare. Multiple sends accumulate into one table.");
    sendBatchButton.onClick = [this] { onSendClicked (RtmSendAudioProcessor::Route::Batch); };
    addAndMakeVisible (sendBatchButton);

    statusLabel.setText("Ready.", juce::dontSendNotification);
    statusLabel.setFont(juce::Font(12.0f));  // NIT-5: was 10px — too small to read comfortably
    statusLabel.setColour(juce::Label::textColourId, LF::kSandMuted);
    statusLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(statusLabel);

    sessionLabel.setText("Session name", juce::dontSendNotification);
    sessionLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    sessionLabel.setColour(juce::Label::textColourId, LF::kSandDim);
    sessionLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(sessionLabel);

    sessionInput.setText(processor.getSessionName(), false);
    sessionInput.setColour(juce::TextEditor::textColourId, LF::kCream);
    sessionInput.setColour(juce::TextEditor::backgroundColourId, LF::kPanel);
    sessionInput.setColour(juce::TextEditor::outlineColourId, LF::kBorder);
    sessionInput.setMultiLine(false);
    sessionInput.onTextChange = [this] { processor.setSessionName(sessionInput.getText()); };
    addAndMakeVisible(sessionInput);

    bufferLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    bufferLabel.setColour(juce::Label::textColourId, LF::kSandDim);
    bufferLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(bufferLabel);

    // Signal-presence dots: "● ● ●" gold when audio is flowing, "· · ·" dim when idle.
    signalDotLabel.setText("- - -", juce::dontSendNotification);
    signalDotLabel.setFont(juce::Font(9.0f));
    signalDotLabel.setColour(juce::Label::textColourId, LF::kSandDim);
    signalDotLabel.setJustificationType(juce::Justification::centredRight);
    addAndMakeVisible(signalDotLabel);

    // Send-count badge: shown after first successful send.
    sendCountLabel.setFont(juce::Font(10.0f));
    sendCountLabel.setColour(juce::Label::textColourId, LF::kSandMuted);
    sendCountLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(sendCountLabel);

    sourceLabel.setText("Source", juce::dontSendNotification);
    sourceLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    sourceLabel.setColour(juce::Label::textColourId, LF::kSandDim);
    sourceLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(sourceLabel);

    sourceBox.addItem("Ring buffer (last N seconds)", 1);
    sourceBox.addItem("Loop / selection range", 2);
    sourceBox.addItem("Manual record (Rec / Stop)", 3);
    sourceBox.addItem("Clips & markers (ARA)", 4);
    sourceBox.setSelectedId(static_cast<int>(processor.getSource()) + 1, juce::dontSendNotification);
    sourceBox.setColour(juce::ComboBox::textColourId, LF::kCream);
    sourceBox.setColour(juce::ComboBox::backgroundColourId, LF::kPanel);
    sourceBox.setColour(juce::ComboBox::outlineColourId, LF::kBorder);
    // 5.2.4: arrow was gold — violates "one gold gesture per screen" rule.
    // Gold belongs to the Single button. Arrow reverts to sand-muted.
    sourceBox.setColour(juce::ComboBox::arrowColourId, LF::kSandMuted);
    sourceBox.onChange = [this] {
        const int idx = sourceBox.getSelectedId() - 1;
        processor.setSource(static_cast<RtmSendAudioProcessor::Source>(idx));
    };
    addAndMakeVisible(sourceBox);

    // Region / marker picker is always visible. Picking an item
    // flips Source to ARA so the next Send captures it.
    regionLabel.setText("Region / marker", juce::dontSendNotification);
    regionLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.15f));
    regionLabel.setColour(juce::Label::textColourId, LF::kSandDim);
    regionLabel.setJustificationType(juce::Justification::centredLeft);
    addAndMakeVisible(regionLabel);

    regionBox.setColour(juce::ComboBox::textColourId, LF::kCream);
    regionBox.setColour(juce::ComboBox::backgroundColourId, LF::kPanel);
    regionBox.setColour(juce::ComboBox::outlineColourId, LF::kBorder);
    // 5.2.4: same as sourceBox — arrow reverts to sand-muted so gold
    // remains exclusive to the Single button.
    regionBox.setColour(juce::ComboBox::arrowColourId, LF::kSandMuted);
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
    // 5.2.4: track and thumb were gold — that's a second gold element on the
    // same screen as the Single button. The LookAndFeel drawLinearSlider uses
    // cream (kCream) for the filled portion and thumb, which is correct.
    // These inline overrides are dropped so the LookAndFeel owns the slider
    // appearance. Text box uses cream on transparent — unchanged.
    bufferSlider.setColour(juce::Slider::textBoxTextColourId, LF::kCream);
    bufferSlider.setColour(juce::Slider::textBoxOutlineColourId, juce::Colours::transparentBlack);
    bufferSlider.onValueChange = [this] { processor.setBufferSeconds(bufferSlider.getValue()); };
    addAndMakeVisible(bufferSlider);

    // Plugin slot — small section header.
    pluginSlotLabel.setText("EQ PLUGIN", juce::dontSendNotification);
    pluginSlotLabel.setFont(juce::Font(9.0f).withExtraKerningFactor(0.18f));
    pluginSlotLabel.setColour(juce::Label::textColourId, LF::kSandDim);
    addAndMakeVisible(pluginSlotLabel);

    pluginPickButton.setButtonText("Pick Plugin");
    pluginPickButton.onClick = [this] { openPluginPicker(); };
    addAndMakeVisible(pluginPickButton);

    // When running as AU inside Logic Pro, include AU plugins in the scan
    // (Apple's auval already validated them — lower crash risk than random
    // third-party AUs in other hosts). In all other hosts/formats scan VST3.
    const bool isAuInLogic = (processor.wrapperType == juce::AudioProcessor::wrapperType_AudioUnit
                              || processor.wrapperType == juce::AudioProcessor::wrapperType_AudioUnitv3)
                             && juce::PluginHostType{}.isLogic();

    pluginScanButton.setButtonText(isAuInLogic ? "Scan+AU" : "Scan");
    pluginScanButton.setTooltip(isAuInLogic
        ? "Scan VST3 + AU folders. AU scan is in-process — an unstable plugin may briefly hiccup Logic."
        : "Scan VST3 folders for available plugins (takes 5–60 s on first run).");
    pluginScanButton.onClick = [this, isAuInLogic] {
        pluginScanButton.setEnabled(false);
        pluginScanButton.setButtonText("Scanning...");
        juce::Component::SafePointer<RtmSendAudioProcessorEditor> safeThis (this);
        processor.scanForPluginsAsync([safeThis] {
            if (auto* self = safeThis.getComponent())
            {
                juce::PluginHostType h;
                const bool auLogic =
                    (self->processor.wrapperType == juce::AudioProcessor::wrapperType_AudioUnit
                  || self->processor.wrapperType == juce::AudioProcessor::wrapperType_AudioUnitv3)
                    && h.isLogic();
                self->pluginScanButton.setButtonText(auLogic ? "Scan+AU" : "Scan");
                self->pluginScanButton.setEnabled(true);
                self->refreshPluginSlotUi();
            }
        }, isAuInLogic);
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

    pluginUnloadButton.setButtonText("X");
    pluginUnloadButton.setTooltip("Eject plugin from slot.");
    pluginUnloadButton.onClick = [this] {
        processor.unloadHostedPlugin();
        refreshPluginSlotUi();
    };
    addAndMakeVisible(pluginUnloadButton);

    pluginStatusLabel.setFont(juce::Font(11.0f, juce::Font::italic));
    pluginStatusLabel.setColour(juce::Label::textColourId, LF::kSandMuted);
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

void RtmSendAudioProcessorEditor::visibilityChanged()
{
    juce::File::getSpecialLocation(juce::File::userHomeDirectory)
        .getChildFile(".rtm").getChildFile("rtmsend.log")
        .appendText(juce::Time::getCurrentTime().toISO8601(true) + " EDITOR: visibilityChanged visible=" + juce::String((int)isVisible()) + "\n");
}

void RtmSendAudioProcessorEditor::paint(juce::Graphics& g)
{
    juce::File::getSpecialLocation(juce::File::userHomeDirectory)
        .getChildFile(".rtm").getChildFile("rtmsend.log")
        .appendText(juce::Time::getCurrentTime().toISO8601(true) + " EDITOR: paint\n");
    g.fillAll(LF::kInk);

    // Section dividers between header / session / source / eq / send.
    g.setColour(LF::kBorder.withAlpha(0.6f));
    const int x0 = 16, x1 = getWidth() - 16;

    // Below subtitle (after header block).
    const int divY1 = subtitleLabel.getBottom() + 5;
    g.fillRect(x0, divY1, x1 - x0, 1);

    // Below session input.
    const int divY2 = sessionInput.getBottom() + 5;
    g.fillRect(x0, divY2, x1 - x0, 1);

    // Below ARA region box.
    const int divY3 = regionBox.getBottom() + 5;
    g.fillRect(x0, divY3, x1 - x0, 1);

    // Below plugin status label.
    const int divY4 = pluginStatusLabel.getBottom() + 5;
    g.fillRect(x0, divY4, x1 - x0, 1);

    // Bottom hairline.
    g.setColour(LF::kBorder);
    g.fillRect(0, getHeight() - 1, getWidth(), 1);
}

void RtmSendAudioProcessorEditor::resized()
{
    // 1.1.1: hosted plugin is now in its own DocumentWindow, owned by
    // the processor. RTMsend's editor is just the chrome column —
    // fixed compact width, fills its window. No more split layout
    // between RTMsend chrome and embedded plugin.
    auto r = getLocalBounds().reduced (16);
    r.removeFromTop (6);

    // ── Header row: title left, signal dots + host name right ─────────
    {
        auto titleRow = r.removeFromTop(40);
        // Signal dots rightmost (40 px) then host hint (80 px) adjacent.
        signalDotLabel.setBounds(titleRow.removeFromRight(30));
        hostHintLabel.setBounds(titleRow.removeFromRight(96));
        titleLabel.setBounds(titleRow);
    }
    subtitleLabel.setBounds(r.removeFromTop(16));
    r.removeFromTop(10);

    // ── Session ────────────────────────────────────────────────────────
    sessionLabel.setBounds(r.removeFromTop(12));
    r.removeFromTop(3);
    sessionInput.setBounds(r.removeFromTop(24));
    r.removeFromTop(10);

    // ── Source ─────────────────────────────────────────────────────────
    sourceLabel.setBounds(r.removeFromTop(12));
    r.removeFromTop(3);
    sourceBox.setBounds(r.removeFromTop(26));
    r.removeFromTop(6);

    // Context-sensitive capture controls.
    // Trigger button is reserve-allocated even when hidden so resized()
    // is stable; visibility is toggled in timerCallback.
    triggerButton.setBounds(r.removeFromTop(24));
    r.removeFromTop(4);

    // Buffer slider always occupies space (greyed out in non-ring modes).
    {
        auto bufRow = r.removeFromTop(12);
        bufferLabel.setBounds(bufRow);
    }
    r.removeFromTop(3);
    bufferSlider.setBounds(r.removeFromTop(22));
    r.removeFromTop(6);

    // ARA region picker always occupies space (greyed out in non-ARA modes).
    regionLabel.setBounds(r.removeFromTop(12));
    r.removeFromTop(3);
    regionBox.setBounds(r.removeFromTop(24));
    r.removeFromTop(10);

    // ── EQ Plugin slot ─────────────────────────────────────────────────
    pluginSlotLabel.setBounds(r.removeFromTop(12));
    r.removeFromTop(3);
    {
        // When loaded: [Pick Plugin ▾]  [Open]  [×]
        // When empty:  [Pick Plugin ▾]  [Scan]
        // Scan is shown when no plugin is loaded; Open+× when loaded.
        auto slotRow = r.removeFromTop(24);
        const int gap = 4;
        const bool hasPlugin = processor.getHostedPluginName().isNotEmpty();
        if (hasPlugin)
        {
            // [×] right-most (28 px), [Open] next (52 px), [Pick] takes rest.
            pluginUnloadButton.setBounds(slotRow.removeFromRight(28));
            slotRow.removeFromRight(gap);
            pluginEditorButton.setBounds(slotRow.removeFromRight(52));
            slotRow.removeFromRight(gap);
            pluginPickButton.setBounds(slotRow);
            pluginScanButton.setBounds({});  // hidden
        }
        else
        {
            // [Scan] right (52 px), [Pick Plugin] takes the rest.
            pluginScanButton.setBounds(slotRow.removeFromRight(52));
            slotRow.removeFromRight(gap);
            pluginPickButton.setBounds(slotRow);
            pluginEditorButton.setBounds({});
            pluginUnloadButton.setBounds({});
        }
    }
    pluginStatusLabel.setBounds(r.removeFromTop(14));
    r.removeFromTop(10);

    // ── Send buttons ───────────────────────────────────────────────────
    auto buttonRow = r.removeFromTop(36);
    {
        const int gap   = 6;
        const int total = buttonRow.getWidth() - 2 * gap;
        const int w     = total / 3;
        sendSingleButton.setBounds(buttonRow.removeFromLeft(w));
        buttonRow.removeFromLeft(gap);
        sendCompareButton.setBounds(buttonRow.removeFromLeft(w));
        buttonRow.removeFromLeft(gap);
        sendBatchButton.setBounds(buttonRow);
    }
    r.removeFromTop(8);
    statusLabel.setBounds(r.removeFromTop(16));
    sendCountLabel.setBounds(r.removeFromTop(14));
}

// Helper: only call setText if the text actually changed.
// juce::Label::setText() always calls repaint() even for the same string,
// causing unnecessary redraws at 4 Hz that manifest as UI jitter in
// complex hosts (WaveLab, Nuendo). Guard every call in timerCallback.
static void setTextIfChanged(juce::Label& label, const juce::String& text)
{
    if (label.getText() != text)
        label.setText(text, juce::dontSendNotification);
}
static void setColourIfChanged(juce::Label& label, int colourId, juce::Colour c)
{
    if (label.findColour(colourId) != c)
        label.setColour(colourId, c);
}
static void setAlphaIfChanged(juce::Component& comp, float alpha)
{
    if (!juce::approximatelyEqual(comp.getAlpha(), alpha))
        comp.setAlpha(alpha);
}
static void setEnabledIfChanged(juce::Component& comp, bool enabled)
{
    if (comp.isEnabled() != enabled)
        comp.setEnabled(enabled);
}
static void setVisibleIfChanged(juce::Component& comp, bool visible)
{
    if (comp.isVisible() != visible)
        comp.setVisible(visible);
}

void RtmSendAudioProcessorEditor::timerCallback()
{
    // Buffer label — only changes when the user drags the slider.
    setTextIfChanged(bufferLabel,
        "Ring  " + juce::String(static_cast<int>(processor.getBufferSeconds())) + " s");

    const auto s = processor.getLastStatus();
    if (s.isNotEmpty())
        setTextIfChanged(statusLabel, s);

    // Signal-presence indicator: two states, guard both text + colour.
    const bool hasAudio = processor.hasRecentAudio();
    if (hasAudio != timerCache.signalActive)
    {
        timerCache.signalActive = hasAudio;
        if (hasAudio)
        {
            signalDotLabel.setText("* * *", juce::dontSendNotification);
            signalDotLabel.setColour(juce::Label::textColourId, LF::kGold);
        }
        else
        {
            signalDotLabel.setText("- - -", juce::dontSendNotification);
            signalDotLabel.setColour(juce::Label::textColourId, LF::kSandDim);
        }
    }

    // Send-count badge: only rewrite when the count changes.
    const int cnt = processor.sendCounter.load(std::memory_order_relaxed);
    if (cnt != timerCache.sendCount)
    {
        timerCache.sendCount = cnt;
        if (cnt > 0)
            sendCountLabel.setText(juce::String("^ ") + juce::String(cnt)
                                   + (cnt == 1 ? juce::String(" send") : juce::String(" sends")),
                                   juce::dontSendNotification);
        else
            sendCountLabel.setText({}, juce::dontSendNotification);
    }

    // Plugin status label: clean name only — no RPC port (users don't need it).
    {
        const bool isScanning = pluginScanButton.getButtonText().startsWith("Scanning");
        const bool hasPlugin  = processor.isHostedPluginPresent();
        const bool faulted    = processor.didHostedPluginFault();

        // Track previous plugin presence so we can trigger a relayout
        // when the slot switches between empty and loaded — the button
        // row changes composition (Pick+Scan ↔ Pick+Open+×).
        if (hasPlugin != timerCache.pluginLoaded)
        {
            timerCache.pluginLoaded = hasPlugin;
            resized();   // rebuild button positions for new slot state
            repaint();
        }

        if (isScanning)
        {
            const int found = processor.getKnownPluginList().getNumTypes();
            setTextIfChanged(pluginStatusLabel,
                "Scanning...  " + juce::String(found) + " found");
        }
        else if (faulted)
        {
            setTextIfChanged(pluginStatusLabel,
                "Plugin crashed - eject and reload.");
            setColourIfChanged(pluginStatusLabel, juce::Label::textColourId,
                               juce::Colour(201, 103, 101));
        }
        else if (hasPlugin)
        {
            setTextIfChanged(pluginStatusLabel, processor.getHostedPluginName());
            setColourIfChanged(pluginStatusLabel, juce::Label::textColourId, LF::kSandMuted);
        }
    }

    const auto src = processor.getSource();
    const bool triggeredMode = src == RtmSendAudioProcessor::Source::TriggeredRegion;
    const bool ringMode      = src == RtmSendAudioProcessor::Source::LastNSeconds;
    const bool loopMode      = src == RtmSendAudioProcessor::Source::LoopRegion;
    const bool araMode       = src == RtmSendAudioProcessor::Source::AraRegion;

    // Trigger button: visible only in manual-record mode.
    setVisibleIfChanged(triggerButton, triggeredMode);
    setEnabledIfChanged(triggerButton, triggeredMode);
    const bool capturing = processor.isTriggeredCapturing();
    const auto trigText = capturing ? juce::String("STOP") : juce::String("REC");
    if (triggerButton.getButtonText() != trigText)
        triggerButton.setButtonText(trigText);

    // Region picker: full opacity in ARA mode, dimmed otherwise.
    const float regionAlpha = araMode ? 1.0f : 0.45f;
    setAlphaIfChanged(regionBox,   regionAlpha);
    setAlphaIfChanged(regionLabel, regionAlpha);

    // Buffer slider: active in ring mode, dimmed otherwise.
    setEnabledIfChanged(bufferSlider, ringMode);
    const float bufAlpha = ringMode ? 1.0f : 0.35f;
    setAlphaIfChanged(bufferSlider, bufAlpha);
    setAlphaIfChanged(bufferLabel,  bufAlpha);

    // Loop mode but no loop points yet - tell the user.
    if (loopMode && !processor.hostHasLoopPoints())
    {
        setColourIfChanged(statusLabel, juce::Label::textColourId, LF::kGold);
        setTextIfChanged(statusLabel, "Set a loop range in the DAW, then play through it once.");
    }

    // Rebuild the region combo only on an actual revision bump.
    if (auto model = processor.getAraRegionsModel())
    {
        const auto rev = model->getRevision();
        if (rev != lastRegionsRevision)
        {
            lastRegionsRevision = rev;
            refreshRegionBox();
        }
        // ARA mode selected but host hasn't published any regions yet.
        if (araMode && model->empty())
        {
            setColourIfChanged(statusLabel, juce::Label::textColourId, LF::kSandMuted);
            setTextIfChanged(statusLabel, "No clips found - open a project with audio regions.");
        }
    }
    else if (araMode)
    {
        // ARA mode chosen but this host doesn't bind ARA to insert plugins
        // (e.g. WaveLab Pro). Guide the user to a working source mode.
        setColourIfChanged(statusLabel, juce::Label::textColourId, LF::kGold);
        setTextIfChanged(statusLabel,
            "Clips unavailable here - use Ring buffer or Record mode.");
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
    // Short DAW name displayed as a compact label in the title row.
    if (processor.wrapperType == juce::AudioProcessor::wrapperType_Standalone)
        return "Standalone";

    juce::PluginHostType h;
    if (h.isLogic())                  return "Logic Pro";
    if (h.isProTools())               return "Pro Tools";
    if (h.isAbletonLive())            return "Ableton Live";
    if (h.isCubase())                 return "Cubase";
    if (h.isNuendo())                 return "Nuendo";
    if (h.isStudioOne())              return "Studio One";
    if (h.isReaper())                 return "REAPER";
    if (h.isBitwigStudio())           return "Bitwig";
    if (h.isWavelab())                return "WaveLab";
    if (h.isGarageBand())             return "GarageBand";
    if (h.isMainStage())              return "MainStage";
    return {};
}

void RtmSendAudioProcessorEditor::onSendClicked(RtmSendAudioProcessor::Route route)
{
    const bool isAra = processor.getSource() == RtmSendAudioProcessor::Source::AraRegion;

    // MED-1 fix: disable ALL send buttons for EVERY path (not just ARA).
    // Previously, non-ARA sends (ring buffer, loop, triggered) left the
    // buttons enabled, allowing double-sends before the first completed.
    sendSingleButton.setEnabled(false);
    sendCompareButton.setEnabled(false);
    sendBatchButton.setEnabled(false);

    // Show contextual in-progress status for both paths.
    statusLabel.setColour(juce::Label::textColourId, LF::kGold);
    statusLabel.setText(isAra ? "Reading ARA region…" : "Sending…",
                        juce::dontSendNotification);

    // Use the async path for ARA (background disk I/O); sync for all others.
    // The callback always fires on the message thread.
    juce::Component::SafePointer<RtmSendAudioProcessorEditor> safeThis (this);
    processor.sendSnapshotToRtmAsync (route,
        [safeThis] (juce::String path, juce::String err)
        {
            auto* self = safeThis.getComponent();
            if (self == nullptr) return;

            // Re-enable send buttons regardless of outcome.
            self->sendSingleButton.setEnabled(true);
            self->sendCompareButton.setEnabled(true);
            self->sendBatchButton.setEnabled(true);

            if (path.isEmpty())
            {
                // 5.2.4: warm-red semantic colour.
                self->statusLabel.setColour(juce::Label::textColourId, juce::Colour(201, 103, 101));
                // MED-3 fix: make error message actionable — append guidance
                // when the generic fallback fires so users know where to look.
                const auto msg = err.isEmpty() ? juce::String("Send failed — is RTMcompare open?") : err;
                self->statusLabel.setText(msg, juce::dontSendNotification);
            }
            else
            {
                // 5.2.4: success green.
                self->statusLabel.setColour(juce::Label::textColourId, juce::Colour(110, 197, 119));
                // MED-3 fix: spell out "RTMcompare" so users know which app received the send.
                self->statusLabel.setText("Sent to RTMcompare.", juce::dontSendNotification);
            }
        });
}

// ─── 1.1.0 spike: plugin slot UI helpers ──────────────────────────

void RtmSendAudioProcessorEditor::refreshPluginSlotUi()
{
    const auto name = processor.getHostedPluginName();
    const bool loaded = name.isNotEmpty();

    if (loaded)
    {
        pluginStatusLabel.setText(name, juce::dontSendNotification);
        pluginStatusLabel.setColour(juce::Label::textColourId, LF::kSandMuted);
        pluginEditorButton.setButtonText(processor.isHostedPluginWindowOpen() ? "Close" : "Open");
        pluginEditorButton.setEnabled(true);
        pluginUnloadButton.setEnabled(true);
    }
    else
    {
        const int known = processor.getKnownPluginList().getNumTypes();
        pluginStatusLabel.setText(
            known > 0 ? ("No plugin — " + juce::String(known) + " available")
                      : juce::String("No plugin — click Scan first"),
            juce::dontSendNotification);
        pluginStatusLabel.setColour(juce::Label::textColourId, LF::kSandDim);
        pluginEditorButton.setEnabled(false);
        pluginUnloadButton.setEnabled(false);
    }

    // Relayout: the button row changes when slot transitions loaded↔empty.
    resized();
}

void RtmSendAudioProcessorEditor::openPluginPicker()
{
    auto& known = processor.getKnownPluginList();
    // Show all formats from the scan cache. AU plugins are safe to LOAD
    // (our try/catch in loadHostedPlugin + createEditorIfNeeded handles
    // misbehaving plugins); only the SCAN step skips AU to protect the host.
    // Logic Pro users need AU plugins — the old VST3-only filter broke them.
    const auto types = known.getTypes();

    if (types.isEmpty())
    {
        pluginStatusLabel.setText("No plugins scanned yet - click Scan.",
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
    // Pause the 4Hz timer while the menu is open. Without this, timer-driven
    // repaints (signal dot, status label) cause the editor window to partially
    // redraw, which shifts its screen position in Logic Pro's AU host and makes
    // the anchored popup menu appear to jump.
    stopTimer();
    // Use WeakReference so the callback is a no-op if the editor is destroyed
    // while the menu is open (e.g. host tears down the plugin window on focus loss).
    juce::WeakReference<RtmSendAudioProcessorEditor> weakSelf (this);
    menu.showMenuAsync(juce::PopupMenu::Options{}.withTargetScreenArea(screenRect),
        [weakSelf, types](int result)
        {
            auto* self = weakSelf.get();
            if (self != nullptr) self->startTimerHz(4);
            if (self == nullptr) return;
            if (result <= 0) return;
            const int idx = juce::KnownPluginList::getIndexChosenByMenu(types, result);
            if (idx < 0 || idx >= types.size()) return;

            // Show loading state immediately so the user knows something is
            // happening. loadHostedPluginAsync runs createPluginInstance on a
            // background thread so blocking file I/O in the plugin's factory
            // (iCloud-evicted preset banks, license files, etc.) doesn't
            // freeze the message thread / hang the host.
            self->pluginStatusLabel.setText("Loading...", juce::dontSendNotification);
            self->pluginPickButton.setEnabled(false);
            self->pluginScanButton.setEnabled(false);

            self->processor.loadHostedPluginAsync(types.getReference(idx),
                [weakSelf](juce::String err)
                {
                    auto* s = weakSelf.get();
                    if (s == nullptr) return;
                    s->pluginPickButton.setEnabled(true);
                    s->pluginScanButton.setEnabled(true);
                    if (err.isNotEmpty())
                        s->pluginStatusLabel.setText("Load failed: " + err,
                                                     juce::dontSendNotification);
                    s->refreshPluginSlotUi();
                });
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
