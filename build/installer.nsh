; Wikivault additions to the installer and uninstaller.
;
; Wikivault installs no Windows services. What it leaves running is the tray
; app (optionally started with Windows) and the Kiwix reader engine it starts
; as a child process. These macros make sure both are closed before files are
; replaced or removed, clean up the start-with-Windows entry, and optionally
; remove the app's data. They never delete a folder wholesale unless the app
; owns it outright; inside the library folder only the app's own files go.

!macro wvCloseRunningCopy
  ; Ask a running copy to close properly, so it stops its reader engine and
  ; leaves any download in a resumable state. Harmless if none is running.
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 +4
    nsExec::Exec /TIMEOUT=10000 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit'
    Pop $R9
    Sleep 6500
!macroend

!macro customInstall
  ; Offer Microsoft Foundry Local, which runs the model that writes answers.
  ; Skipped when it is already installed, when the question was answered "no"
  ; before, and in silent installs unless --with-foundry is passed.
  nsExec::Exec '"$SYSDIR\cmd.exe" /c where foundry'
  Pop $R9
  ReadRegStr $R7 HKCU "Software\Wikivault" "SetupAnswers"
  ${if} $R9 != 0
  ${andIf} $R7 != "declined"
    StrCpy $R8 "0"
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--with-foundry" $R1
    ${ifNot} ${Errors}
      StrCpy $R8 "1"
    ${elseIfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION "Wikivault can write answers to your questions with an AI model that runs on this PC. That needs Microsoft Foundry Local, a free program from Microsoft.$\r$\n$\r$\nInstall Foundry Local now?$\r$\n$\r$\nIt is downloaded from Microsoft with Windows' own package manager (winget), and installing it accepts Microsoft's licence terms for it. Wikivault then downloads the answer model, a few GB, the next time it starts.$\r$\n$\r$\nChoose No to skip. It can be set up later inside Wikivault." IDNO wv_no_foundry
        StrCpy $R8 "1"
        Goto wv_foundry_asked
      wv_no_foundry:
        WriteRegStr HKCU "Software\Wikivault" "SetupAnswers" "declined"
      wv_foundry_asked:
    ${endIf}
    ${if} $R8 == "1"
      DetailPrint "Installing Microsoft Foundry Local. This can take a few minutes."
      nsExec::ExecToLog '"$SYSDIR\cmd.exe" /c winget install --id Microsoft.FoundryLocal -e --accept-source-agreements --accept-package-agreements --disable-interactivity'
      Pop $R9
      ${if} $R9 == 0
        ; Remembered so the uninstaller can offer to remove it again.
        WriteRegStr HKCU "Software\Wikivault" "FoundryByWikivault" "1"
      ${endIf}
      ; Recorded whether or not winget succeeded: Wikivault finishes the job when
      ; it starts, and retries the install itself if it did not work here.
      WriteRegStr HKCU "Software\Wikivault" "SetupAnswers" "1"
    ${endIf}
  ${endIf}
!macroend

!macro customUnInit
  ${ifNot} ${isUpdated}
    ReadRegStr $R7 HKCU "Software\Wikivault" "Partition"
    ${if} $R7 != ""
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Wikivault created drive $R7: for its Wikipedia library.$\r$\n$\r$\nUninstalling does not remove that drive. To give its space back to Windows first, press Cancel, open Wikivault and use Library > Stop using the partition.$\r$\n$\r$\nPress OK to uninstall anyway. The drive can also be removed later in Disk Management." /SD IDOK IDOK wv_partition_ok
        Quit
      wv_partition_ok:
    ${endIf}
  ${endIf}
  !insertmacro wvCloseRunningCopy
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; A reader engine left behind by a crash would keep the library file locked.
    nsExec::Exec /TIMEOUT=15000 `powershell.exe -NoProfile -NonInteractive -Command "Get-Process kiwix-serve -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '*\Wikivault\engine\*' } | Stop-Process -Force"`
    Pop $R9

    ; Start-with-Windows entries (current name, and the one used before 0.5).
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Wikivault"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Wikivault"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "local.wikivault.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Wikivault"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "electron.app.Wikivault"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "local.wikivault.app"

    ; Foundry Local, only if Wikivault was the one that installed it. Kept by
    ; default, and in silent uninstalls unless --remove-foundry is passed.
    ReadRegStr $R4 HKCU "Software\Wikivault" "FoundryByWikivault"
    ${if} $R4 == "1"
      ClearErrors
      ${GetParameters} $R0
      ${GetOptions} $R0 "--remove-foundry" $R1
      ${ifNot} ${Errors}
        Goto wv_remove_foundry
      ${endIf}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Wikivault installed Microsoft Foundry Local to write answers.$\r$\n$\r$\nRemove Foundry Local too? Choose No if other programs on this PC use it." /SD IDNO IDNO wv_keep_foundry
      wv_remove_foundry:
        DetailPrint "Removing Microsoft Foundry Local"
        nsExec::Exec /TIMEOUT=600000 '"$SYSDIR\cmd.exe" /c winget uninstall --id Microsoft.FoundryLocal -e --disable-interactivity'
        Pop $R9
        DeleteRegValue HKCU "Software\Wikivault" "FoundryByWikivault"
      wv_keep_foundry:
    ${endIf}

    ReadRegStr $R5 HKCU "Software\Wikivault" "DataDir"
    ReadRegStr $R6 HKCU "Software\Wikivault" "StagingDir"

    ; Keep the library and settings unless asked. Silent uninstalls keep them
    ; unless --delete-app-data is passed.
    StrCpy $R8 "0"
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${ifNot} ${Errors}
      StrCpy $R8 "1"
    ${else}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove the downloaded Wikipedia library and Wikivault's settings?$\r$\n$\r$\nLibrary folder: $R5$\r$\n$\r$\nChoose No to keep them, for example if you plan to install Wikivault again." /SD IDNO IDNO wv_keep_data
        StrCpy $R8 "1"
      wv_keep_data:
    ${endIf}

    ${if} $R8 == "1"
      ; Library folder: only the files Wikivault put there.
      ${if} $R5 != ""
        ; Wikibooks and Wikiversity, kept inside the library folder.
        Delete "$R5\more\wikibooks\zim\*.zim"
        Delete "$R5\more\wikibooks\zim\*.zim.copying"
        RMDir "$R5\more\wikibooks\zim"
        Delete "$R5\more\wikibooks\downloads\*.part"
        RMDir "$R5\more\wikibooks\downloads"
        Delete "$R5\more\wikibooks\state.json"
        Delete "$R5\more\wikibooks\state.json.tmp"
        RMDir "$R5\more\wikibooks"
        Delete "$R5\more\wikiversity\zim\*.zim"
        Delete "$R5\more\wikiversity\zim\*.zim.copying"
        RMDir "$R5\more\wikiversity\zim"
        Delete "$R5\more\wikiversity\downloads\*.part"
        RMDir "$R5\more\wikiversity\downloads"
        Delete "$R5\more\wikiversity\state.json"
        Delete "$R5\more\wikiversity\state.json.tmp"
        RMDir "$R5\more\wikiversity"
        RMDir "$R5\more"
        ; The Map section: the map file, anything left of a download, and the places.
        Delete "$R5\maps\map.pmtiles"
        Delete "$R5\maps\map.json"
        Delete "$R5\maps\map.json.tmp"
        Delete "$R5\maps\map.new.pmtiles"
        Delete "$R5\maps\map.new.pmtiles.part"
        Delete "$R5\maps\map.new.pmtiles.part.json"
        Delete "$R5\maps\places.json"
        Delete "$R5\maps\places.json.tmp"
        Delete "$R5\maps\places\*.json"
        RMDir "$R5\maps\places"
        Delete "$R5\maps\places.new\*.json"
        RMDir "$R5\maps\places.new"
        Delete "$R5\maps\places.work\*.json"
        Delete "$R5\maps\places.work\*.tmp"
        RMDir "$R5\maps\places.work"
        Delete "$R5\maps\routing\segments\*.rd5"
        RMDir "$R5\maps\routing\segments"
        Delete "$R5\maps\routing\segments.new\*.rd5"
        Delete "$R5\maps\routing\segments.new\*.part"
        RMDir "$R5\maps\routing\segments.new"
        RMDir "$R5\maps\routing"
        Delete "$R5\maps\routing.json"
        Delete "$R5\maps\addresses.dat"
        Delete "$R5\maps\addresses.new.dat"
        Delete "$R5\maps\addresses.json"
        Delete "$R5\maps\addresses.json.tmp"
        Delete "$R5\maps\address-towns.json"
        Delete "$R5\maps\address-towns.json.tmp"
        Delete "$R5\maps\addresses.work\streets\*.tsv"
        RMDir "$R5\maps\addresses.work\streets"
        Delete "$R5\maps\addresses.work\places.txt"
        Delete "$R5\maps\addresses.work\state.json"
        Delete "$R5\maps\addresses.work\state.json.tmp"
        RMDir "$R5\maps\addresses.work"
        Delete "$R5\maps\overture\*.json"
        RMDir "$R5\maps\overture"
        Delete "$R5\maps\overture.new\*.json"
        RMDir "$R5\maps\overture.new"
        Delete "$R5\maps\overture.work\found\*.jsonl"
        RMDir "$R5\maps\overture.work\found"
        Delete "$R5\maps\overture.work\state.json"
        Delete "$R5\maps\overture.work\state.json.tmp"
        RMDir "$R5\maps\overture.work"
        Delete "$R5\maps\overture.json"
        Delete "$R5\maps\overture.json.tmp"
        Delete "$R5\maps\routing.json.tmp"
        RMDir "$R5\maps"
        ; The School section: the publisher's files, books the user added (copies), the text index and the progress file.
        Delete "$R5\school\g5\ela\*.pdf"
        Delete "$R5\school\g5\ela\*.part"
        RMDir "$R5\school\g5\ela"
        Delete "$R5\school\g5\math\*.pdf"
        Delete "$R5\school\g5\math\*.part"
        RMDir "$R5\school\g5\math"
        Delete "$R5\school\g5\hist\*.pdf"
        Delete "$R5\school\g5\hist\*.part"
        RMDir "$R5\school\g5\hist"
        Delete "$R5\school\g5\sci\*.pdf"
        Delete "$R5\school\g5\sci\*.part"
        RMDir "$R5\school\g5\sci"
        Delete "$R5\school\g5\added\*.pdf"
        RMDir "$R5\school\g5\added"
        RMDir "$R5\school\g5"
        Delete "$R5\school\index\g5\*.json"
        Delete "$R5\school\index\g5\*.tmp"
        RMDir "$R5\school\index\g5"
        RMDir "$R5\school\index"
        Delete "$R5\school\progress-g5.json"
        Delete "$R5\school\progress-g5.json.tmp"
        RMDir "$R5\school"
        Delete "$R5\zim\*.zim"
        Delete "$R5\zim\*.zim.copying"
        RMDir "$R5\zim"
        Delete "$R5\downloads\*.part"
        RMDir "$R5\downloads"
        Delete "$R5\state.json"
        Delete "$R5\state.json.tmp"
        RMDir "$R5"
      ${endIf}
      ${if} $R6 != ""
        Delete "$R6\*.zim"
        Delete "$R6\*.part"
        RMDir "$R6"
      ${endIf}
      ; The default library and staging folders, in case they were used earlier.
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikibooks\zim\*.zim"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikibooks\zim\*.zim.copying"
      RMDir "$LOCALAPPDATA\Wikivault\library\more\wikibooks\zim"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikibooks\downloads\*.part"
      RMDir "$LOCALAPPDATA\Wikivault\library\more\wikibooks\downloads"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikibooks\state.json"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikibooks\state.json.tmp"
      RMDir "$LOCALAPPDATA\Wikivault\library\more\wikibooks"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikiversity\zim\*.zim"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikiversity\zim\*.zim.copying"
      RMDir "$LOCALAPPDATA\Wikivault\library\more\wikiversity\zim"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikiversity\downloads\*.part"
      RMDir "$LOCALAPPDATA\Wikivault\library\more\wikiversity\downloads"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikiversity\state.json"
      Delete "$LOCALAPPDATA\Wikivault\library\more\wikiversity\state.json.tmp"
      RMDir "$LOCALAPPDATA\Wikivault\library\more\wikiversity"
      RMDir "$LOCALAPPDATA\Wikivault\library\more"
      Delete "$LOCALAPPDATA\Wikivault\library\zim\*.zim"
      Delete "$LOCALAPPDATA\Wikivault\library\zim\*.zim.copying"
      RMDir "$LOCALAPPDATA\Wikivault\library\zim"
      Delete "$LOCALAPPDATA\Wikivault\library\downloads\*.part"
      RMDir "$LOCALAPPDATA\Wikivault\library\downloads"
      Delete "$LOCALAPPDATA\Wikivault\library\state.json"
      RMDir "$LOCALAPPDATA\Wikivault\library"
      Delete "$LOCALAPPDATA\Wikivault\staging\*.zim"
      Delete "$LOCALAPPDATA\Wikivault\staging\*.part"
      RMDir "$LOCALAPPDATA\Wikivault\staging"
      RMDir "$LOCALAPPDATA\Wikivault"
      ; Settings, log, reader engine and browser caches: all created by the app.
      RMDir /r "$APPDATA\Wikivault"
      DeleteRegKey HKCU "Software\Wikivault"
    ${endIf}
  ${endIf}
!macroend
