; RTMcompare Windows Installer
;
; Installs RTMcompare to %LocalAppData%\Programs\RTMcompare (no admin needed).
;
; Usage (run from Compare App root):
;   makensis -DVERSION=8.4.0 -DUNPACKED=release-build\win-unpacked scripts\RTMcompare-win.nsi
;
; Output: release\RTMcompare-8.4.0-Setup.exe
;

!ifndef VERSION
  !define VERSION "8.4.0"
!endif
!ifndef UNPACKED
  !define UNPACKED "release-build\win-unpacked"
!endif

!define PRODUCT_NAME      "RTMcompare"
!define PRODUCT_PUBLISHER "Ohad Nissim"

Unicode true
SetCompressor /SOLID lzma
Name "${PRODUCT_NAME} ${VERSION}"
OutFile "release/RTMcompare-${VERSION}-Setup.exe"
RequestExecutionLevel user
ShowInstDetails show
ShowUnInstDetails show

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ICON                   "..\build\icon.ico"
!define MUI_UNICON                 "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE      "RTMcompare ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT       "Professional A/B compare, QC, batch processing, Atmos & streaming preview, master-chain render, Learn Mode.$\r$\n$\r$\nInstalls for the current user only — no admin required."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch RTMcompare"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ── Install ────────────────────────────────────────────────────────────────
Section "RTMcompare" SecMain
  SectionIn RO
  SetOutPath "$LocalAppData\Programs\RTMcompare"
  File /r "${UNPACKED}/*"

  ; Desktop + Start Menu shortcuts
  CreateDirectory "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare"
  CreateShortCut  "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare\RTMcompare.lnk" \
                  "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"
  CreateShortCut  "$Desktop\RTMcompare.lnk" \
                  "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"

  ; Uninstall
  WriteUninstaller "$LocalAppData\Programs\RTMcompare\Uninstall.exe"
  WriteRegStr  HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "DisplayName"     "${PRODUCT_NAME} ${VERSION}"
  WriteRegStr  HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "DisplayVersion"  "${VERSION}"
  WriteRegStr  HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "Publisher"       "${PRODUCT_PUBLISHER}"
  WriteRegStr  HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "UninstallString" "$LocalAppData\Programs\RTMcompare\Uninstall.exe"
  WriteRegStr  HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "InstallLocation" "$LocalAppData\Programs\RTMcompare"
  WriteRegStr  HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "DisplayIcon"     "$LocalAppData\Programs\RTMcompare\RTMcompare.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare" "NoRepair" 1
SectionEnd

; ── Uninstall ──────────────────────────────────────────────────────────────
Section "Uninstall"
  RMDir /r "$LocalAppData\Programs\RTMcompare"
  Delete    "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare\RTMcompare.lnk"
  Delete    "$Desktop\RTMcompare.lnk"
  RMDir     "$AppData\Microsoft\Windows\Start Menu\Programs\RTMcompare"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RTMcompare"
SectionEnd
