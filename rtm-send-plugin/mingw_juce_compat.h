/**
 * Compatibility shim for building JUCE with mingw-w64 (GCC 12+) targeting
 * Windows x64. Include via CMake: -include mingw_juce_compat.h
 *
 * Fixes addressed:
 *  1. NS_E_NO_MORE_SAMPLES  — not in all MinGW wmerror.h versions
 *  2. __cpuid               — MinGW signature differs from MSVC intrinsic
 *  3. JPEG boolean typedef  — HAVE_BOOLEAN silences the libjpeg conflict
 *  4. UIAutomation CaretPosition_* enum values missing in older MinGW UIAuto
 *  5. stricmp / strnicmp    — MinGW uses _stricmp / _strnicmp like MSVC
 */
#pragma once

/* ── 1. Windows Media NS error code ──────────────────────────────────────── */
#ifndef NS_E_NO_MORE_SAMPLES
#  define NS_E_NO_MORE_SAMPLES ((HRESULT)0xC00D001AL)
#endif

/* ── 2. CPUID intrinsic ───────────────────────────────────────────────────── */
#ifdef __MINGW32__
#  include <cpuid.h>
/* MSVC: __cpuid(int info[4], int leaf)  — writes info[0..3]
   GCC:  __cpuid(leaf, eax, ebx, ecx, edx) */
static inline void _juce_mingw_cpuid(int info[4], int leaf) {
    __cpuid(leaf, info[0], info[1], info[2], info[3]);
}
/* Only define if MSVC signature isn't already present */
#  ifndef _MSC_VER
#    define __cpuid(info, leaf) _juce_mingw_cpuid((info), (leaf))
#  endif
#endif

/* ── 3. libjpeg boolean typedef conflict ─────────────────────────────────── */
#define HAVE_BOOLEAN 1

/* ── 4. UIAutomation CaretPosition enum values ───────────────────────────── */
#ifndef CaretPosition_Unknown
#  define CaretPosition_Unknown          0
#  define CaretPosition_EndOfLine        1
#  define CaretPosition_BeginningOfLine  2
#endif

/* ── 5. stricmp / strnicmp ───────────────────────────────────────────────── */
#ifdef __MINGW32__
#  include <string.h>
#  ifndef stricmp
#    define stricmp  _stricmp
#  endif
#  ifndef strnicmp
#    define strnicmp _strnicmp
#  endif
#endif

/* ── 6. Define INITGUID so COM GUIDs without import libs (e.g. CLSID_SpVoice)
        get actual definitions via DEFINE_GUID / DECLSPEC_SELECTANY ─────── */
#ifdef __MINGW32__
#  ifndef INITGUID
#    define INITGUID
#  endif
#endif

/* ── 7. D2D1 Saturation effect property enum (missing from MinGW) ────────── */
#ifdef __MINGW32__
#  ifndef D2D1_SATURATION_PROP_SATURATION
typedef enum D2D1_SATURATION_PROP {
    D2D1_SATURATION_PROP_SATURATION  = 0,
    D2D1_SATURATION_PROP_FORCE_DWORD = 0xffffffff
} D2D1_SATURATION_PROP;
#  endif
#endif
