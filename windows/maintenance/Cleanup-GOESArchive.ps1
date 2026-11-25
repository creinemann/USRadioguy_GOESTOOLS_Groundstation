<#
  Cleanup-GOESArchive.ps1  -  USradioguy.com
  Replaces the three ForFiles actions in Task Scheduler. Deletes old files
  from the GOES-19 archive folders below, in one quick pass per folder,
  and writes a one-line summary per folder to Cleanup-GOESArchive.log.

  Test first (lists what WOULD be deleted, deletes nothing):
      .\Cleanup-GOESArchive.ps1 -WhatIf
  Real run:
      .\Cleanup-GOESArchive.ps1

  Or clean a whole imagery folder (what install-windows.ps1 sets up):
      .\Cleanup-GOESArchive.ps1 -Root "D:\GOES Imagery" -KeepDays 3

  Task Scheduler action (one action replaces all three):
      Program:   powershell.exe
      Arguments: -NoProfile -ExecutionPolicy Bypass -File "<this folder>\Cleanup-GOESArchive.ps1"
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    # Used by install-windows.ps1: clean one whole imagery folder instead of the list below
    [string]$Root,
    [double]$KeepDays = 3
)

# Folder = hours to keep. EMWIN must stay above 24 so the 24-hour videos
# always have a full day of frames.
$keep = [ordered]@{
    'D:\goes-archive\goes19\text'  = 24
    'D:\goes-archive\goes19\emwin' = 48
    'D:\goes-archive\goes19\nws'   = 24
}

if ($Root) {
    # Keep at least 2 days, so the 24-hour videos always have a full day of frames
    if ($KeepDays -lt 2) { $KeepDays = 2 }
    $keep = [ordered]@{ $Root = [int]($KeepDays * 24) }
}

$logPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'Cleanup-GOESArchive.log'
function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    if (-not $WhatIfPreference) { Add-Content -Path $logPath -Value $line -Encoding UTF8 }
}

foreach ($folder in $keep.Keys) {
    if (-not (Test-Path -LiteralPath $folder)) { Write-Log "$folder : not found - skipped"; continue }
    $cutoff = (Get-Date).AddHours(-$keep[$folder])
    $count = 0; $bytes = 0; $errors = 0

    # (New-Object IO.DirectoryInfo).GetFiles is far faster than per-file commands on 80,000+ files
    $files = (New-Object IO.DirectoryInfo($folder)).GetFiles('*', [IO.SearchOption]::AllDirectories)
    foreach ($f in $files) {
        if ($f.LastWriteTime -ge $cutoff) { continue }
        if ($WhatIfPreference) { $count++; $bytes += $f.Length; continue }   # test mode: just count
        try { $f.Delete(); $count++; $bytes += $f.Length } catch { $errors++ }
    }
    # remove sub-folders left empty (e.g. old date folders), never the folder itself
    Get-ChildItem -LiteralPath $folder -Directory -Recurse -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } -Descending |
        Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1) } |
        ForEach-Object { if ($PSCmdlet.ShouldProcess($_.FullName, 'Remove empty folder')) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue } }

    $verb = 'deleted'; if ($WhatIfPreference) { $verb = 'would delete' }
    Write-Log ("{0} : {1} {2} file(s), {3:N0} MB, older than {4} h; {5} kept; {6} error(s)" -f $folder, $verb, $count, ($bytes / 1MB), $keep[$folder], ($files.Count - $count), $errors)
}
exit 0
