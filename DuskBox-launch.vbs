' Dusk Box silent launcher.
'
' This file must stay pure ASCII (see test/s21-launcher.test.js):
' Windows Script Host reads a .vbs file as ANSI unless it carries a UTF-16 BOM,
' so any non-ASCII text here would turn into garbage on a machine whose
' code page is not ours. All user-facing text lives in server/launch.js.
'
' It only does two things: find Node.js, then run "node server\launch.js"
' with no window at all. Everything else (is the service already running?
' should we start it? open the browser) is decided in that JS file.
Option Explicit

Dim fso, sh, root, nodeExe, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

nodeExe = FindNode(fso, sh)
If nodeExe = "" Then
  ' No Node.js found: fall back to the visible script, which prints
  ' the download link and waits for a keypress so the user can read it.
  sh.Run """" & root & "\DuskBox-start.bat""", 1, False
  WScript.Quit 1
End If

cmd = """" & nodeExe & """ """ & root & "\server\launch.js"""
sh.Run cmd, 0, False

' Returns the full path of node.exe, or "" when Node.js is not installed.
Function FindNode(fso, sh)
  Dim list, i
  list = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\node.exe", _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe" _
  )
  For i = 0 To UBound(list)
    If fso.FileExists(list(i)) Then
      FindNode = list(i)
      Exit Function
    End If
  Next

  ' Last resort: ask PATH. The result goes through a temp file so that
  ' no console window flashes on screen while the user is watching.
  Dim tmp, f
  tmp = sh.ExpandEnvironmentStrings("%TEMP%") & "\duskbox-which-node.txt"
  sh.Run "cmd /c where node > """ & tmp & """ 2>nul", 0, True
  FindNode = ""
  If fso.FileExists(tmp) Then
    Set f = fso.OpenTextFile(tmp, 1)
    If Not f.AtEndOfStream Then FindNode = Trim(f.ReadLine())
    f.Close
    fso.DeleteFile tmp, True
  End If
End Function
