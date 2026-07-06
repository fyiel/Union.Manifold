; NSIS installer hooks, wired via bundle > windows > nsis > installerHooks.
;
; One-time migration away from the legacy per-machine install.
;
; Releases up to v2.10.0 shipped with installMode "perMachine": the app lived in
; C:\Program Files\Union.Manifold and registered under HKLM. Since 9eb9e2b the
; installer is "currentUser" (first released in v2.10.3) so the auto-updater can
; replace the app without a UAC prompt. But a current-user installer runs with
; SHCTX = HKCU and cannot see the old HKLM registration, so the stock Tauri
; template would install a second copy into %LOCALAPPDATA% and leave the old one
; behind, together with the machine-wide shortcuts that still point at it: every
; launch through an old shortcut would boot the outdated Program Files copy,
; which immediately offers the same update again.
;
; NSIS_HOOK_PREINSTALL removes the legacy per-machine copy (one UAC prompt);
; NSIS_HOOK_POSTINSTALL recreates the shortcuts its uninstaller deleted, since
; update-mode installs skip shortcut creation. If the user declines elevation we
; leave the old copy alone and continue: the new per-user install still works and
; the migration simply retries on the next update.

Var LegacyPerMachineDir
Var LegacyHadStartMenuLnk
Var LegacyHadDesktopLnk
Var LegacyHadRunEntry

!macro NSIS_HOOK_PREINSTALL
  StrCpy $LegacyPerMachineDir ""
  StrCpy $LegacyHadStartMenuLnk 0
  StrCpy $LegacyHadDesktopLnk 0
  StrCpy $LegacyHadRunEntry 0

  ; ${UNINSTKEY} is keyed by product name; only the <= 2.10.0 per-machine
  ; installers ever wrote it under HKLM (the Electron-era 1.0.x installer used a
  ; GUID key, so it never matches here and is intentionally left untouched).
  ReadRegStr $R8 HKLM "${UNINSTKEY}" "UninstallString"
  ReadRegStr $R9 HKLM "${MANUPRODUCTKEY}" ""
  ${If} $R8 != ""
  ${AndIf} $R9 != ""
  ${AndIf} ${FileExists} "$R9\uninstall.exe"
    ; Record which machine-wide shortcuts pointed at the old copy before the
    ; uninstaller deletes them, so the post-install hook can restore per-user
    ; equivalents instead of blindly recreating shortcuts the user had removed.
    SetShellVarContext all
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$R9\${MAINBINARYNAME}.exe"
    Pop $LegacyHadStartMenuLnk
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$R9\${MAINBINARYNAME}.exe"
    Pop $LegacyHadDesktopLnk
    SetShellVarContext current

    ; The uninstaller also deletes the HKCU Run autostart value written by
    ; tauri-plugin-autostart (named after the product) — and under
    ; over-the-shoulder elevation it survives but keeps pointing at the exe
    ; we're about to remove. Record it now; either way the post-install hook
    ; rewrites it against the new per-user exe.
    ReadRegStr $R7 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    ${If} $R7 != ""
      StrCpy $LegacyHadRunEntry 1
    ${EndIf}

    ; The legacy uninstaller is admin-manifested, so it has to go through
    ; ShellExecute for the UAC prompt (ExecWait/CreateProcess would fail with
    ; ERROR_ELEVATION_REQUIRED). /P runs it passively; _?= makes it run in place
    ; so ExecShellWait actually waits for it. App data is safe: the uninstaller
    ; only removes %APPDATA%\<bundle id> when its interactive "delete app data"
    ; checkbox is ticked, which a passive run never shows.
    ClearErrors
    ExecShellWait "open" "$R9\uninstall.exe" "/P _?=$R9"

    ; "HKLM entry gone" is the success signal; on UAC decline or any failure the
    ; old copy just stays and this migration retries on the next update.
    ; A leftover uninstall.exe in the old Program Files dir is accepted: running
    ; in place (_?=) means it cannot delete itself, and this unelevated
    ; per-user installer cannot delete from Program Files or HKLM either — the
    ; same residue stock Tauri's own uninstall-before-install path leaves.
    ReadRegStr $R8 HKLM "${UNINSTKEY}" "UninstallString"
    ${If} $R8 == ""
      StrCpy $LegacyPerMachineDir $R9
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $LegacyPerMachineDir != ""
  ${AndIf} $NoShortcutMode <> 1
    ; Auto-updates run the installer in update mode, which skips shortcut
    ; creation entirely; restore the entry points the legacy uninstaller just
    ; deleted, per-user this time (mirrors the template's shortcut layout).
    ${If} $LegacyHadStartMenuLnk = 1
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
    ${If} $LegacyHadDesktopLnk = 1
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; Autostart is registry, not a shortcut, so it sits outside $NoShortcutMode.
  ; Rewrite it whenever it existed before the migration: covers both the
  ; same-user elevation case (uninstaller deleted it) and over-the-shoulder
  ; elevation (it survived pointing at the removed Program Files exe). The
  ; quoted-path format matches what tauri-plugin-autostart writes.
  ${If} $LegacyPerMachineDir != ""
  ${AndIf} $LegacyHadRunEntry = 1
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  ${EndIf}
!macroend
