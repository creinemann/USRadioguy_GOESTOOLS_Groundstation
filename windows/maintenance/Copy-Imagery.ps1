<#
  Copy-Imagery.ps1  -  USRadioguy GOESTOOLS Ground Station (Windows)
  ------------------------------------------------------------------
  Copies new imagery from each receiver Pi's network share
  (\\<pi-address>\goes, set up by the Pi installer) into this PC's
  imagery folder, so the website here can show it.

  install-windows.ps1 sets this up as a scheduled task that runs every
  5 minutes as SYSTEM (no window, works without anyone logged in).
  Settings live in  %ProgramData%\USRadioguy\copy-imagery.json , which
  only Administrators and SYSTEM can read. The share password in it is
  encrypted with Windows DPAPI.

  Run by hand (PowerShell as administrator) to test:
      .\Copy-Imagery.ps1

  Copyright 2026 Carl Reinemann (USRadioguy). GPL v3.
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $env:ProgramData 'USRadioguy\copy-imagery.json')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$logDir  = Join-Path $env:ProgramData 'USRadioguy\logs'
$logPath = Join-Path $logDir 'copy-imagery.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

# Keep the log short (last 2000 lines)
if ((Test-Path $logPath) -and ((Get-Item $logPath).Length -gt 400KB)) {
    $tail = Get-Content $logPath -Tail 2000
    Set-Content -Path $logPath -Value $tail -Encoding UTF8
}

# Only one copy at a time
$lock = Join-Path $logDir 'copy-imagery.lock'
try { $lockStream = [IO.File]::Open($lock, 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Write-Host "Another copy is already running."; exit 0 }

try {
    if (-not (Test-Path $Config)) { Write-Log "ERROR: $Config not found - run install-windows.ps1"; exit 1 }
    $cfg = Get-Content $Config -Raw | ConvertFrom-Json
    $dest = $cfg.dest
    $maxAge = [int]$cfg.maxAgeDays
    if ($maxAge -lt 1) { $maxAge = 1 }
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    foreach ($src in $cfg.sources) {
        $share = $src.share
        $pass = ''
        if ($src.secret) {
            $bytes = [Convert]::FromBase64String($src.secret)
            $pass = [Text.Encoding]::UTF8.GetString(
                [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'LocalMachine'))
        }
        if ((-not (Test-Path -LiteralPath $share)) -and $src.user -and $pass) {
            # Connect with the Pi's share login (ignore "already connected")
            $ErrorActionPreference = 'Continue'    # net.exe error text must not stop the script
            & net.exe use $share $pass "/user:$($src.user)" /persistent:no 2>&1 | Out-Null
            $ErrorActionPreference = 'Stop'
        }
        if (-not (Test-Path -LiteralPath $share)) {
            Write-Log "$share : can't reach it - is the Pi on, and is the share password right?"
            continue
        }

        $runLog = Join-Path $logDir ('robocopy-' + ($share -replace '[\\:]+', '_').Trim('_') + '.log')
        # /XO  never replace a newer file here   /MAXAGE  skip files the cleanup task already removed
        & robocopy.exe $share $dest /E /XO "/MAXAGE:$maxAge" /R:1 /W:2 /MT:8 /NP /NFL /NDL "/LOG:$runLog" | Out-Null
        $rc = $LASTEXITCODE
        $copied = Select-String -Path $runLog -Pattern '^\s*Files\s*:' | Select-Object -Last 1
        $summary = ''
        if ($copied) { $summary = ($copied.Line -replace '\s+', ' ').Trim() }
        if ($rc -ge 8) { Write-Log "$share : robocopy error $rc - see $runLog" }
        else { Write-Log "$share : ok ($summary)" }
    }
}
finally {
    $lockStream.Close()
}
exit 0
