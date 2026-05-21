; RTMcompare Windows Bundle Installer
;
; Installs:
;   RTMcompare     → %LocalAppData%\Programs\RTMcompare
;   RTMprofile     → %LocalAppData%\Programs\RTMprofile
;   RTM Send VST3  → %CommonProgramFiles%\VST3\RTM Send.vst3
;
; Usage (run from Compare App root):
;   makensis -DVERSION=8.4.0 scripts\RTMcompare-bundle.nsi
;
; Requires the following files alongside this script at build time:
;   ../release-build/win-unpacked/             RTMcompare unpacked app
;   ../rtm-profile-app/release-build/win-unpacked/  RTMprofile unpacked app
;   ../rtm-send-plugin/build-win-cross/RtmSend_artefacts/Release/VST3/RTM Send.vst3/
;

!ifndef VERSION
  !define VERSION "8.4.0"
!endif

!define PRODUCT_NAME    "RTMcompare"
!define PRODUCT_VERSION "${VERSION}"
!define PRODUCT_PUBLISHER "Ohad Nissim"

Unicode true
SetCompressor /SOLID lzma
Name "${PRODUCT_NAME} Bundle ${PRODUCT_VERSION}"
OutFile "release/RTMcompare-bundle-${VERSION}-win.exe"
RequestExecutionLevel user
ShowInstDetails show
ShowUnInstDetails show

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

; ── UI ─────────────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON "../build/icon.ico"
!define MUI_UNICON "../build/icon.ico"
!define MUI_WELCOMEPAGE_TITLE "RTMcompare Bundle ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This installer sets up:$\r$\n$\r$\n  • RTMcompare — professional A/B compare, QC,$\r$\n    batch processing, Atmos & streaming preview.$\r$\n$\r$\n  • RTMprofile — build a custom reference profile$\r$\n    from your back catalogue.$\r$\n$\r$\n  • RTM Send VST3 — route audio from any DAW$\r$\n    to RTMcompare in real time.$\r$\n$\r$\nAll apps are installed for the current user only.$\r$\nNo admin rights required."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_RUN "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch RTMcompare"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ── Component descriptions ──────────────────────────────────────────────────
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecRTMcompare} "A/B compare, QC, batch, Atmos, streaming preview, Learn Mode. Installs to %LocalAppData%\Programs\RTMcompare."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecRTMprofile} "Turn your back catalogue into a target reference. Installs to %LocalAppData%\Programs\RTMprofile."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecRTMSend}    "VST3 plugin — route live audio from any DAW directly into RTMcompare. Installs to %CommonProgramFiles%\VST3."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ── RTMcompare ─────────────────────────────────────────────────────────────
Section "RTMcompare" SecRTMcompare
  SectionIn RO
  SetOutPath "$LocalAppData\Programs\RTMcompare"
  File /r "../release-build/win-unpacked/*"

  ; Start Menu
  CreateDirectory "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare"
  CreateShortCut  "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare\RTMcompare.lnk" \
                  "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"
  CreateShortCut  "$Desktop\RTMcompare.lnk" \
                  "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"

  ; Uninstall entry
  WriteUninstaller "$LocalAppData\Programs\RTMcompare\Uninstall RTMcompare.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "DisplayName" "RTMcompare ${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "UninstallString" "$LocalAppData\Programs\RTMcompare\Uninstall RTMcompare.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "InstallLocation" "$LocalAppData\Programs\RTMcompare"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "DisplayIcon" "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "NoRepair" 1
SectionEnd

; ── RTMprofile ─────────────────────────────────────────────────────────────
Section "RTMprofile" SecRTMprofile
  SetOutPath "$LocalAppData\Programs\RTMprofile"
  File /r "../rtm-profile-app/release-build/win-unpacked/*"

  CreateDirectory "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare"
  CreateShortCut  "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare\RTMprofile.lnk" \
                  "$LocalAppData\Programs\RTMprofile\RTMprofile.exe"
  CreateShortCut  "$Desktop\RTMprofile.lnk" \
                  "$LocalAppData\Programs\RTMprofile\RTMprofile.exe"

  WriteUninstaller "$LocalAppData\Programs\RTMprofile\Uninstall RTMprofile.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile" \
    "DisplayName" "RTMprofile ${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" \
    "UninstallString" "$LocalAppData\Programs\RTMprofile\Uninstall RTMprofile.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile" \
    "InstallLocation" "$LocalAppData\Programs\RTMprofile"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile" \
    "DisplayIcon" "$LocalAppData\Programs\RTMprofile\RTMprofile.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile" \
    "NoRepair" 1
SectionEnd

; ── RTM Send VST3 ──────────────────────────────────────────────────────────
Section "RTM Send VST3 Plugin" SecRTMSend
  ; VST3 bundles on Windows install per-machine to Common Files\VST3.
  ; We write to HKCU uninstall for the current user only.
  SetOutPath "$CommonFiles64\VST3"
  File /r "../rtm-send-plugin/build-win-cross/RtmSend_artefacts/Release/VST3/RTM Send.vst3"

  WriteUninstaller "$CommonFiles64\VST3\RTM Send.vst3\Uninstall RTM Send.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMSend" \
    "DisplayName" "RTM Send VST3 ${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMSend" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMSend" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMSend" \
    "UninstallString" "$CommonFiles64\VST3\RTM Send.vst3\Uninstall RTM Send.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMSend" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMSend" \
    "NoRepair" 1
SectionEnd

; ── Uninstall sections ─────────────────────────────────────────────────────
Section "Uninstall"
  ; RTMcompare
  RMDir /r "$LocalAppData\Programs\RTMcompare"
  Delete   "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare\RTMcompare.lnk"
  Delete   "$Desktop\RTMcompare.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare"

  ; RTMprofile
  RMDir /r "$LocalAppData\Programs\RTMprofile"
  Delete   "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare\RTMprofile.lnk"
  Delete   "$Desktop\RTMprofile.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMprofile"

  ; RTM Send VST3
  RMDir /r "$CommonFiles64\VST3\RTM Send.vst3"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMSend"

  ; Shared Start Menu folder (remove if empty)
  RMDir "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare"
SectionEnd
