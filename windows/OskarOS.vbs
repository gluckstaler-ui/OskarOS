' OskarOS - clean launcher (no extra console window).
' Runs OskarOS-launch.bat hidden; the WSL server still opens its own
' visible window (your live log). Double-click this, or make a shortcut
' to it and give the shortcut a custom icon (see README.md).
Dim fso, sh, batPath
Set fso = CreateObject("Scripting.FileSystemObject")
batPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "OskarOS-launch.bat")
Set sh = CreateObject("WScript.Shell")
' 0 = run hidden, False = don't wait for it to finish.
sh.Run "cmd /c """ & batPath & """", 0, False
