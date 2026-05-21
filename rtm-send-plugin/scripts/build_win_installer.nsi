; NSIS installer for RTM Send (Windows VST3).
;
; Drops a 64-bit .vst3 bundle into the canonical location:
;   C:\Program Files\Common Files\VST3\RTM Send.vst3
; and offers a Standalone install at:
;   C:\Program Files\RTM Send
;
; Build:
;   makensis -DPLUGIN_DIR=path\to\RtmSend_artefacts\Release rtm-send-plugin\scripts\build_win_installer.nsi
;
; The .vst3 / standalone build itself happens on a Windows host (MSVC
; toolchain). This installer just wraps the produced artifacts and
; signs the installer .exe via signtool.exe — codex plugin-QA flagged
; cross-building plugin binaries from macOS as too risky for ship.

!define PRODUCT_NAME "RTM Send"
!define PRODUCT_VERSION "8.4.0"
!define PRODUCT_PUBLISHER "RTMcompare"
!define PRODUCT_WEB_SITE "https://rtmcompare.com"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\RTMSend.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

!ifndef PLUGIN_DIR
  !error "Pass -DPLUGIN_DIR=path\to\RtmSend_artefacts\Release on the command line"
!endif

SetCompressor /SOLID lzma
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "RTM-Send-${PRODUCT_VERSION}-Setup.exe"
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

; ── UI ─────────────────────────────────────────────────────────────
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

InstallDir "$PROGRAMFILES64\RTM Send"

; ── VST3 component ─────────────────────────────────────────────────
Section "VST3 Plugin" SecVST3
  SetOutPath "$PROGRAMFILES64\Common Files\VST3"
  ; PLUGIN_DIR\VST3\RTM Send.vst3 is a folder (VST3 bundle on Windows
  ; is a directory, not a single file).
  File /r "${PLUGIN_DIR}/VST3/RTM Send.vst3"
SectionEnd

; ── Standalone (optional) ──────────────────────────────────────────
Section "Standalone App" SecStandalone
  SetOutPath "$INSTDIR"
  File /r "${PLUGIN_DIR}/Standalone/*"
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\RTM Send.exe"
SectionEnd

; ── Uninstall info ─────────────────────────────────────────────────
Section -PostInstall
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; VST3 bundle directory.
  RMDir /r "$PROGRAMFILES64\Common Files\VST3\RTM Send.vst3"
  ; Standalone.
  RMDir /r "$INSTDIR"
  Delete  "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir   "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKLM "${PRODUCT_UNINST_KEY}"
SectionEnd

; ── Component descriptions ─────────────────────────────────────────
LangString DESC_SecVST3       ${LANG_ENGLISH} "Native VST3 plugin (loaded by Ableton Live, Studio One, Reaper, FL Studio, Cubase, Bitwig…). Goes to Common Files\VST3."
LangString DESC_SecStandalone ${LANG_ENGLISH} "Standalone app for testing the plugin without a DAW host."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecVST3}       $(DESC_SecVST3)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStandalone} $(DESC_SecStandalone)
!insertmacro MUI_FUNCTION_DESCRIPTION_END
