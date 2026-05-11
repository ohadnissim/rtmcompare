#pragma once

#include <JuceHeader.h>

// 5.2.4 — Console Didone LookAndFeel for RTMsend.
// Mirrors the v5.2 shell aesthetic from RTMcompare:
//   - sharp 2px corners (no rounded-2xl pill buttons)
//   - transparent fill + 1px outline as the default button shape
//   - cream text on ink field
//   - one gold gesture per screen, opt in via setComponentID("rtm-primary")
//   - no drop shadows, no glow, no decorative effects
// Drop into the editor with `setLookAndFeel(&lookAndFeel)` once and
// every TextButton / ComboBox / Slider follows the same vocabulary.
class ConsoleDidoneLookAndFeel : public juce::LookAndFeel_V4
{
public:
    // Palette — same swatches as the React shell (see styles.css
    // sand-* + terra tokens). Kept inline as constexpr-style so the
    // editor can also reach for them directly without duplicating.
    inline static const juce::Colour kInk    { 14,  13,  11 };  // bg
    inline static const juce::Colour kPanel  { 30,  28,  24 };  // input bg
    inline static const juce::Colour kCream  { 235, 231, 224 }; // primary text
    inline static const juce::Colour kSandSecondary { 214, 209, 198 };
    inline static const juce::Colour kSandMuted     { 141, 134, 123 };
    inline static const juce::Colour kSandDim       { 87,  83,  78  };
    inline static const juce::Colour kGold   { 208, 176, 102 };
    inline static const juce::Colour kBorder { juce::Colour::fromRGBA (168, 161, 150,
                                                  static_cast<juce::uint8> (0.18f * 255)) };

    ConsoleDidoneLookAndFeel()
    {
        // Backgrounds + text defaults so any unstyled control inherits
        // the right palette.
        setColour (juce::ResizableWindow::backgroundColourId, kInk);
        setColour (juce::Label::textColourId,                 kCream);

        setColour (juce::TextButton::buttonColourId,          juce::Colour::fromRGBA (0, 0, 0, 0));
        setColour (juce::TextButton::buttonOnColourId,        kSandDim.withAlpha (0.18f));
        setColour (juce::TextButton::textColourOffId,         kSandSecondary);
        setColour (juce::TextButton::textColourOnId,          kCream);

        setColour (juce::ComboBox::backgroundColourId,        kPanel);
        setColour (juce::ComboBox::textColourId,              kCream);
        setColour (juce::ComboBox::outlineColourId,           kBorder);
        setColour (juce::ComboBox::arrowColourId,             kSandMuted);
        setColour (juce::ComboBox::buttonColourId,            kPanel);

        setColour (juce::TextEditor::backgroundColourId,      kPanel);
        setColour (juce::TextEditor::textColourId,            kCream);
        setColour (juce::TextEditor::outlineColourId,         kBorder);
        setColour (juce::TextEditor::focusedOutlineColourId,  kGold.withAlpha (0.50f));
        setColour (juce::TextEditor::highlightColourId,       kGold.withAlpha (0.20f));

        setColour (juce::Slider::backgroundColourId,          kPanel);
        setColour (juce::Slider::trackColourId,               kSandMuted.withAlpha (0.50f));
        setColour (juce::Slider::thumbColourId,               kCream);
        setColour (juce::Slider::textBoxBackgroundColourId,   kPanel);
        setColour (juce::Slider::textBoxOutlineColourId,      kBorder);
        setColour (juce::Slider::textBoxTextColourId,         kCream);

        setColour (juce::PopupMenu::backgroundColourId,       kPanel);
        setColour (juce::PopupMenu::textColourId,             kSandSecondary);
        setColour (juce::PopupMenu::highlightedBackgroundColourId, kSandDim.withAlpha (0.35f));
        setColour (juce::PopupMenu::highlightedTextColourId,  kCream);
    }

    // ── Buttons ────────────────────────────────────────────────────
    // Sharp 2px radius. Transparent fill by default. 1px border in
    // sand-muted for neutral; gold for buttons that opt in via
    // `setComponentID ("rtm-primary")`. Hover deepens the border;
    // pressed darkens the fill very slightly so the click registers
    // without needing a colour shift.
    void drawButtonBackground (juce::Graphics& g, juce::Button& button,
                               const juce::Colour& backgroundColour,
                               bool isMouseOverButton, bool isButtonDown) override
    {
        const bool isPrimary = button.getComponentID() == "rtm-primary";
        const auto bounds = button.getLocalBounds().toFloat().reduced (0.5f);
        const float radius = 2.0f;

        // Subtle pressed fill so haptic feedback exists without a
        // background colour shift.
        if (isButtonDown)
        {
            g.setColour (kSandDim.withAlpha (0.18f));
            g.fillRoundedRectangle (bounds, radius);
        }
        else if (isMouseOverButton && !isPrimary)
        {
            g.setColour (kSandDim.withAlpha (0.10f));
            g.fillRoundedRectangle (bounds, radius);
        }

        // Border — gold for primary, neutral cream for everything else.
        const juce::Colour border = isPrimary
            ? (isMouseOverButton ? kGold : kGold.withAlpha (0.85f))
            : (isMouseOverButton ? kSandSecondary.withAlpha (0.45f)
                                  : kBorder);
        g.setColour (border);
        g.drawRoundedRectangle (bounds, radius, 1.0f);

        juce::ignoreUnused (backgroundColour);
    }

    void drawButtonText (juce::Graphics& g, juce::TextButton& button,
                         bool /*isMouseOverButton*/, bool /*isButtonDown*/) override
    {
        const auto componentID = button.getComponentID();
        const auto font = juce::Font (11.0f, juce::Font::plain).withExtraKerningFactor (0.12f);
        g.setFont (font);

        // Three semantic states:
        //   "rtm-primary" → single gold gesture per screen
        //   "rtm-warning" → warm-red, used for REC / destructive actions
        //   default       → cream/sand-secondary
        juce::Colour textColour;
        if (componentID == "rtm-primary")
            textColour = kGold;
        else if (componentID == "rtm-warning")
            textColour = juce::Colour (201, 103, 101); // --color-warm-red
        else
            textColour = kSandSecondary;

        g.setColour (textColour);
        const auto label = button.getButtonText().toUpperCase();
        g.drawFittedText (label, button.getLocalBounds(),
                          juce::Justification::centred, 1);
    }

    // ── ComboBox ───────────────────────────────────────────────────
    // Sharp 2px corner; cream text; arrow in sand-muted.
    void drawComboBox (juce::Graphics& g, int width, int height,
                       bool /*isButtonDown*/, int /*buttonX*/, int /*buttonY*/,
                       int /*buttonW*/, int /*buttonH*/, juce::ComboBox& box) override
    {
        const auto bounds = juce::Rectangle<float> (0.0f, 0.0f,
                                                    static_cast<float> (width),
                                                    static_cast<float> (height)).reduced (0.5f);
        g.setColour (kPanel);
        g.fillRoundedRectangle (bounds, 2.0f);
        g.setColour (kBorder);
        g.drawRoundedRectangle (bounds, 2.0f, 1.0f);

        // Chevron — drawn manually so it's a fine 1px stroke, not a filled triangle.
        const float arrowX  = static_cast<float> (width) - 14.0f;
        const float arrowY  = static_cast<float> (height) * 0.5f - 1.0f;
        juce::Path p;
        p.startNewSubPath (arrowX, arrowY);
        p.lineTo (arrowX + 4.0f, arrowY + 4.0f);
        p.lineTo (arrowX + 8.0f, arrowY);
        g.setColour (kSandMuted);
        g.strokePath (p, juce::PathStrokeType (1.0f));

        juce::ignoreUnused (box);
    }

    // ── Slider ─────────────────────────────────────────────────────
    // Linear horizontal slider only — RTMsend's buffer slider is the
    // only slider the plugin ships. Cream track, cream thumb, no
    // shadow. Filled portion left of thumb in sand-secondary.
    void drawLinearSlider (juce::Graphics& g, int x, int y, int width, int height,
                           float sliderPos, float /*minSliderPos*/, float /*maxSliderPos*/,
                           const juce::Slider::SliderStyle /*style*/,
                           juce::Slider& /*slider*/) override
    {
        const float trackY = y + height * 0.5f;
        const float trackThickness = 1.0f;
        const auto trackRect = juce::Rectangle<float> (
            static_cast<float> (x), trackY - trackThickness * 0.5f,
            static_cast<float> (width), trackThickness);

        // Track baseline — sand-muted, single hairline.
        g.setColour (kSandDim);
        g.fillRect (trackRect);

        // Filled portion — cream, same hairline.
        g.setColour (kCream);
        g.fillRect (trackRect.withWidth (sliderPos - x));

        // Thumb — small cream dot, 7px diameter.
        const float thumbR = 4.5f;
        g.setColour (kCream);
        g.fillEllipse (sliderPos - thumbR, trackY - thumbR, thumbR * 2.0f, thumbR * 2.0f);
    }

    // ── Labels ─────────────────────────────────────────────────────
    // Default label paint already does what we need (text colour from
    // the colour ID, font from setFont). Override exists only so
    // future hooks have a single place to land.
    juce::Font getLabelFont (juce::Label& label) override
    {
        return label.getFont();
    }

    // ── Font loading note ──────────────────────────────────────────
    // Title and subtitle labels use juce::Font("Instrument Serif", ...)
    // which resolves against the system font stack. This works when
    // Instrument Serif is installed system-wide (e.g. Google Fonts
    // installed via Fontbook), but falls through to the platform serif
    // on machines where it is not.
    //
    // To guarantee the typeface on all machines:
    //   1. Add InstrumentSerif-Regular.ttf and InstrumentSerif-Italic.ttf
    //      to the JUCE BinaryData (CMakeLists.txt juce_add_binary_data).
    //   2. In this constructor, after the colour setup, call:
    //        instrumentSerifRegular = juce::Typeface::createSystemTypefaceFor(
    //            BinaryData::InstrumentSerifRegular_ttf,
    //            BinaryData::InstrumentSerifRegular_ttfSize);
    //        instrumentSerifItalic  = juce::Typeface::createSystemTypefaceFor(
    //            BinaryData::InstrumentSerifItalic_ttf,
    //            BinaryData::InstrumentSerifItalic_ttfSize);
    //   3. Override getTypefaceForFont() to return the cached typeface
    //      when the font family name is "Instrument Serif".
    //   4. In drawButtonText(), replace the plain Font construction with
    //        juce::Font (instrumentSerifRegular).withHeight (11.0f)
    //      for primary / title contexts as needed.
    //
    // Font files to source: fonts.google.com/specimen/Instrument+Serif
    // License: SIL Open Font License 1.1 (permissive, no embedding restrictions).
    //
    // NOTE: no TTF is bundled in this repository yet. The system-font
    // fallback is active on all current builds.

    // Private members to add when fonts are bundled:
    // juce::Typeface::Ptr instrumentSerifRegular;
    // juce::Typeface::Ptr instrumentSerifItalic;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ConsoleDidoneLookAndFeel)
};
