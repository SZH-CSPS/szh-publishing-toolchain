' Lance une commande sans fenetre de console (le 0 passe a sh.Run).
' Usage : wscript.exe //B hidden.vbs <script.ps1|programme.exe> [arguments...]
' Sert aux taches planifiees et aux raccourcis du menu Demarrer.
Option Explicit
Dim sh, cmd, premier, i, powershellExe
If WScript.Arguments.Count = 0 Then WScript.Quit 1
Set sh = CreateObject("Wscript.Shell")
' Chemin explicite vers Windows PowerShell 5.1, meme repli que Get-SzhRaccourcisMenu
' (szh-common.ps1) : un simple "powershell.exe" se fie au PATH plutot qu'a un chemin fixe.
powershellExe = sh.ExpandEnvironmentStrings("%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe")
premier = WScript.Arguments(0)
If LCase(Right(premier, 4)) = ".ps1" Then
  cmd = """" & powershellExe & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & premier & """"
Else
  cmd = """" & premier & """"
End If
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next
sh.Run cmd, 0, False
