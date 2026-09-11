!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Var DesktopShortcutCheckbox
Var DesktopShortcutSelected

Function DesktopShortcutPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Choose whether to create a desktop shortcut for Codex Pulse."
  Pop $0
  ${NSD_CreateCheckbox} 0 34u 100% 12u "Create a desktop shortcut"
  Pop $DesktopShortcutCheckbox
  ${NSD_Check} $DesktopShortcutCheckbox

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutSelected
FunctionEnd

!macro customWelcomePage
  Page custom DesktopShortcutPageCreate DesktopShortcutPageLeave
!macroend
!endif

!macro customInstall
  ${If} $DesktopShortcutSelected == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DesktopShortcutCreated" "true"
  ${Else}
    Delete "$newDesktopLink"
    Delete "$oldDesktopLink"
    DeleteRegValue SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DesktopShortcutCreated"
  ${EndIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "DesktopShortcutCreated"
  ${If} $0 == "true"
    Delete "$oldDesktopLink"
    Delete "$newDesktopLink"
  ${EndIf}
!macroend
