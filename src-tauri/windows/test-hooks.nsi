; Exercise the production hooks against disposable files, without registering
; or installing Manifold. The early path models Tauri's legacy uninstall page.
Unicode true
!include MUI2.nsh
!include FileFunc.nsh

!define PRODUCTNAME "Manifold extraction guard test"
!define MAINBINARYNAME "union-manifold"
!define UNINSTKEY "Software\ManifoldExtractionGuardTest\Uninstall"
!define MANUPRODUCTKEY "Software\ManifoldExtractionGuardTest"
Var NoShortcutMode

; The migration's shortcut helpers are unreachable with the empty test keys.
!macro IsShortcutTarget shortcut target
  Push 0
!macroend
!macro SetLnkAppUserModelId shortcut
!macroend

!include "${HOOKS_FILE}"
Name "Manifold extraction guard test"
OutFile "${TEST_OUTFILE}"
RequestExecutionLevel user
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE English

Function .onInit
  ${GetOptions} $CMDLINE "/EARLY" $0
  ${IfNot} ${Errors}
    ; Run the GUI callback in silent mode so a blocked check uses /SD IDOK.
    ; Then model the OLD uninstaller deleting the executable before install.
    !ifdef MUI_CUSTOMFUNCTION_GUIINIT
      Call ${MUI_CUSTOMFUNCTION_GUIINIT}
    !endif
    Delete "$INSTDIR\union-manifold.exe"
    ; Stop here: the assertion must detect deletion even if install could repair it.
    SetErrorLevel 0
    Quit
  ${EndIf}
FunctionEnd

Section Install
  !insertmacro NSIS_HOOK_PREINSTALL
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\union-manifold.exe" w
  FileWrite $0 "new executable"
  FileClose $0
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section Uninstall
  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif
  Delete "$INSTDIR\union-manifold.exe"
  Delete "$INSTDIR\7z.dll"
SectionEnd
