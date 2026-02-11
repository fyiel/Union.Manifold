!macro customUnInstall
  ${if} ${isUpdated}
    ; Keep desktop/start-menu shortcuts during updates.
    StrCpy $isKeepShortcuts "true"
  ${endif}
!macroend
