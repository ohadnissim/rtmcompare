cmake_minimum_required(VERSION 3.22)

project(RtmSend VERSION 1.2.0)

# ── JUCE ────────────────────────────────────────────────────────────
# JUCE at ../JUCE, or override via JUCE_DIR env var so CI can pin.
if(NOT DEFINED JUCE_DIR)
    if(DEFINED ENV{JUCE_DIR})
        set(JUCE_DIR $ENV{JUCE_DIR})
    else()
        set(JUCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../JUCE")
    endif()
endif()

if(NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR
        "JUCE not found at ${JUCE_DIR}. Either clone JUCE into ../JUCE or set JUCE_DIR. "
        "git clone https://github.com/juce-framework/JUCE.git ../JUCE"
    )
endif()

# ── ARA SDK ─────────────────────────────────────────────────────────
# ARA_SDK_PATH points to the ARA_API + ARA_Library SDK
# (https://github.com/Celemony/ARA_SDK). Optional - missing SDK
# gets us a VST3/AU-only build. JUCE's ARA helpers only activate
# when JUCE_ENABLE_ARA=1.
if(NOT DEFINED ARA_SDK_PATH)
    if(DEFINED ENV{ARA_SDK_PATH})
        set(ARA_SDK_PATH $ENV{ARA_SDK_PATH})
    else()
        set(ARA_SDK_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../ARA_SDK")
    endif()
endif()

# ── AAX SDK ─────────────────────────────────────────────────────────
# AAX_SDK_PATH points to the Avid AAX SDK 2.9.0+ root directory.
# AAX_LIB_PATH points to the pre-built libAAXLibrary.a (universal).
# Distribution builds also need wraptool/PACE signing — this step
# produces a functional unsigned .aaxplugin for Pro Tools dev mode.
if(NOT DEFINED AAX_SDK_PATH)
    if(DEFINED ENV{AAX_SDK_PATH})
        set(AAX_SDK_PATH $ENV{AAX_SDK_PATH})
    else()
        set(AAX_SDK_PATH "/Users/ohadnissim/AVID/aax-sdk-2-9-0")
    endif()
endif()
if(NOT DEFINED AAX_LIB_PATH)
    if(DEFINED ENV{AAX_LIB_PATH})
        set(AAX_LIB_PATH $ENV{AAX_LIB_PATH})
    else()
        set(AAX_LIB_PATH "${AAX_SDK_PATH}/Libs/AAXLibrary/build/libAAXLibrary.a")
    endif()
endif()

set(RTM_AAX_ENABLED FALSE)
if(EXISTS "${AAX_SDK_PATH}/Interfaces/AAX.h" AND EXISTS "${AAX_LIB_PATH}")
    set(RTM_AAX_ENABLED TRUE)
    # Tell JUCE where the SDK lives (sets include dirs on juce_aax_sdk target)
    set(JUCE_GLOBAL_AAX_SDK_PATH "${AAX_SDK_PATH}" CACHE PATH "" FORCE)
    message(STATUS "AAX SDK found at ${AAX_SDK_PATH} — AAX format will be built")
else()
    message(STATUS "AAX SDK not found at ${AAX_SDK_PATH} — skipping AAX")
endif()

set(RTM_ARA_ENABLED FALSE)
if(EXISTS "${ARA_SDK_PATH}/ARA_API/ARAInterface.h")
    set(RTM_ARA_ENABLED TRUE)
    message(STATUS "ARA SDK found at ${ARA_SDK_PATH} — ARA2 module will be built")
else()
    message(STATUS "ARA SDK not found at ${ARA_SDK_PATH} — skipping ARA2 (ring-buffer + loop + triggered modes still work)")
endif()

add_subdirectory(${JUCE_DIR} JUCE_BUILD)

# With ARA present, VST3 and AU both carry the ARA2 extension.
# Non-ARA hosts still see a normal VST3/AU.
# 5.2.2 (audit P2-W7): only emit AU on Apple — JUCE silently drops it on
# Windows but the configure log gets noisy and the build is slower.
# AAX: added when AAX SDK 2.9.0 is present (see above). Distribution
# builds additionally require wraptool/PACE signing.
set(_rtm_formats VST3 Standalone)
if(APPLE)
    list(APPEND _rtm_formats AU)
endif()
if(RTM_AAX_ENABLED)
    list(APPEND _rtm_formats AAX)
endif()

juce_add_plugin(RtmSend
    COMPANY_NAME              "RTMcompare"
    BUNDLE_ID                 "com.rtmcompare.rtmsend"
    PLUGIN_MANUFACTURER_CODE  RTMS
    PLUGIN_CODE               Rtms
    FORMATS                   ${_rtm_formats}
    PRODUCT_NAME              "RTM Send"
    DESCRIPTION               "Send audio to RTMcompare with one click."
    IS_SYNTH                  FALSE
    NEEDS_MIDI_INPUT          FALSE
    NEEDS_MIDI_OUTPUT         FALSE
    IS_MIDI_EFFECT            FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD   TRUE
    AU_MAIN_TYPE              kAudioUnitType_Effect
    # The ARA SDK examples and JUCE's ARA-Plugins demo both use just
    # "Fx|OnlyARA" — no "Analyzer". Steinberg hosts (Wavelab, Cubase,
    # Nuendo) appear to dislike the Analyzer+OnlyARA combination and
    # silently fall back to non-ARA insert mode. Drop Analyzer so the
    # ARA Main Factory class is engaged. RTMsend is conceptually an
    # analyzer-sender but VST3 categorisation here matters more for
    # host routing than user-visible labelling.
    VST3_CATEGORIES           "Fx" "OnlyARA"
    AAX_CATEGORY              AAX_ePlugInCategory_Effect
    IS_ARA_EFFECT             ${RTM_ARA_ENABLED}
    # JUCE emits these verbatim as C preprocessor macro values, so
    # the quote characters must be inside the CMake string - hence
    # the \"...\" escaping.
    ARA_FACTORY_ID            "\"com.rtmcompare.rtmsend.arafactory\""
    ARA_DOCUMENT_ARCHIVE_ID   "\"com.rtmcompare.rtmsend.archive.v1\""
    ARA_COMPATIBLE_ARCHIVE_IDS "\"com.rtmcompare.rtmsend.archive.v1\";\"com.rtmsuite.rtmsend.archive.v1\""
)

juce_generate_juce_header(RtmSend)

set(_rtm_sources
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/RpcServer.cpp
)
if(RTM_ARA_ENABLED)
    list(APPEND _rtm_sources Source/RtmAraDocumentController.cpp)
endif()
target_sources(RtmSend PRIVATE ${_rtm_sources})

target_compile_features(RtmSend PRIVATE cxx_std_17)

target_compile_definitions(RtmSend PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    # 1.1.0-spike: enable JUCE plugin-host code paths inside RTMsend so
    # we can host third-party VST3/AU plugins (FabFilter Pro-Q, etc.)
    # in our own slot. juce_audio_processors gates these behind defines
    # so the same module compiles in plugin-client mode by default.
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_LADSPA=0
)
if(APPLE)
    target_compile_definitions(RtmSend PUBLIC JUCE_PLUGINHOST_AU=1)
else()
    target_compile_definitions(RtmSend PUBLIC JUCE_PLUGINHOST_AU=0)
endif()

target_link_libraries(RtmSend PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_plugin_client
    juce::juce_audio_processors  # JUCE 8 split: full host-capable module (vs _headless)
    juce::juce_dsp
    juce::juce_cryptography  # SHA256 used in the .ready sidecar manifest
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)

if(RTM_ARA_ENABLED)
    # JUCE 8 enables ARA via IS_ARA_EFFECT TRUE (above). No extra
    # module to link; the ARA sources inside juce_audio_processors
    # activate when JucePlugin_Enable_ARA=1, which JUCE's CMake
    # injects for us. We just need the SDK headers on the path.
    #
    # JUCE's internal ARA headers use angle-bracket includes like
    # <ARA_Library/Debug/ARADebug.h> and <ARA_API/ARAInterface.h>,
    # so the include root must be the SDK root, not a subdirectory.
    target_include_directories(RtmSend PRIVATE
        "${ARA_SDK_PATH}"
    )
    target_compile_definitions(RtmSend PUBLIC
        RTM_ARA_ENABLED=1
    )
else()
    target_compile_definitions(RtmSend PUBLIC RTM_ARA_ENABLED=0)
endif()

# ── AAX static library ───────────────────────────────────────────────
# JUCE's juce_aax_sdk INTERFACE target only carries include dirs.
# We must link the actual Avid AAXLibrary.a ourselves on the AAX target.
# The target RtmSend_AAX is generated by juce_add_plugin when AAX is in
# the FORMATS list.
if(RTM_AAX_ENABLED AND TARGET RtmSend_AAX)
    target_link_libraries(RtmSend_AAX PRIVATE "${AAX_LIB_PATH}")
    target_compile_definitions(RtmSend_AAX PRIVATE RTM_AAX_ENABLED=1)
endif()
