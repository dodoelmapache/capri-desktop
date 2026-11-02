' Opens Capri with no terminal window. Used by the desktop shortcut with a hotkey.
' If she's already running, this only makes her show where she is.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run """" & dir & "\node_modules\electron\dist\electron.exe"" """ & dir & """", 0, False
