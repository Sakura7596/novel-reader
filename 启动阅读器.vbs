Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\desktop"
ws.Run "node_modules\.bin\electron.cmd .", 0, False
