' Dusk Box - stop the local service.
'
' Pure ASCII on purpose (Windows Script Host reads .vbs as ANSI).
' It only does an HTTP POST: no tray icon, no PowerShell window, nothing
' the security policy on this machine blocks.
'
' Why WinHttpRequest and not MSXML2.XMLHTTP: MSXML follows the system proxy,
' and this machine has a proxy that makes localhost requests time out.
' Setting "no proxy" (1) keeps it a direct local call.
Option Explicit

Dim req, port, alive

alive = 0
For port = 8899 To 8918
  If HealthOk(port) Then
    alive = port
    Exit For
  End If
Next

If alive = 0 Then
  MsgBox "Dusk Box is not running (no service found on ports 8899-8918).", 64, "Dusk Box"
  WScript.Quit 0
End If

On Error Resume Next
Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
req.SetProxy 1
req.Open "POST", "http://127.0.0.1:" & alive & "/api/shutdown", False
req.SetRequestHeader "X-Duskbox-Action", "shutdown"
req.SetRequestHeader "Content-Type", "application/json"
req.Send "{}"
If Err.Number <> 0 Then
  MsgBox "Failed to stop the service: " & Err.Description, 16, "Dusk Box"
  WScript.Quit 1
End If
On Error GoTo 0

MsgBox "Dusk Box service stopped. Your data is safe." & vbCrLf & vbCrLf & _
       "Double-click the desktop icon to start it again.", 64, "Dusk Box"

' True when this port answers as Dusk Box (name check, not just "port is open")
Function HealthOk(p)
  Dim r
  HealthOk = False
  On Error Resume Next
  Set r = CreateObject("WinHttp.WinHttpRequest.5.1")
  r.SetProxy 1
  r.Open "GET", "http://127.0.0.1:" & p & "/api/health", False
  r.Send
  If Err.Number = 0 Then
    If InStr(r.ResponseText, "Dusk Box") > 0 Then HealthOk = True
  End If
  Err.Clear
  On Error GoTo 0
End Function
