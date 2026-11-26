<#
  install-windows.ps1  -  USRadioguy GOESTOOLS Ground Station, Windows website
  =========================================================================
  Sets up the ground station WEBSITE on a Windows PC with XAMPP:
    - Vitality GOES classic view with all themes, the Earth Lab view and
      the Ground Station HUD, served by XAMPP's Apache
    - (optional) copies imagery from your receiver Pi(s) every 5 minutes
    - 24-hour video loops every 30 minutes, nightly cleanup of old imagery
  The receivers themselves (goesrecv + goesproc) run on Raspberry Pis
  set up with install.sh.

  How to run:
    1. Download the repository ZIP from GitHub and extract it to a
       permanent folder, for example  C:\USRadioguy-Groundstation
       (the scheduled tasks run scripts from this folder - don't delete it).
    2. Right-click Start > "Terminal (Admin)" or "Windows PowerShell (Admin)", then:
         cd C:\USRadioguy-Groundstation
         powershell -ExecutionPolicy Bypass -File .\install-windows.ps1

  Re-running is safe: your previous answers are offered as defaults, and
  your web\config\station.ini is kept.

  Copyright 2026 Carl Reinemann (USRadioguy). GPL v3.
  Built on goestools (Pieter Noordhuis) and Vitality GOES (Jamie Vital).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path

# ------------------------------------------------------------------ helpers
function Say([string]$t)  { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok([string]$t)   { Write-Host "    [ok] $t" -ForegroundColor Green }
function Warn([string]$t) { Write-Host "    [!]  $t" -ForegroundColor Yellow }
function Fail([string]$t) {
    Write-Host ""; Write-Host "ERROR: $t" -ForegroundColor Red
    Read-Host "Press Enter to close" | Out-Null; exit 1
}
function Ask([string]$q, [string]$def) {
    $a = Read-Host ("    {0} [{1}]" -f $q, $def)
    if ([string]::IsNullOrWhiteSpace($a)) { return $def }
    return $a.Trim()
}
function AskYes([string]$q, [string]$def) {
    $a = Ask "$q yes/no" $def
    return $a.ToLower().StartsWith('y')
}
# Run a program quietly. (Windows PowerShell 5.1 turns a program's error output into a
# script-stopping error when $ErrorActionPreference is 'Stop', so relax it here.)
function Invoke-Quiet([string]$exe, [string[]]$arguments) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $exe @arguments 2>&1 | Out-Null } finally { $ErrorActionPreference = $old }
    return $LASTEXITCODE
}
function Prev([string]$key, [string]$def) {
    if ($script:prev -and $script:prev.PSObject.Properties[$key] -and $script:prev.$key) { return [string]$script:prev.$key }
    return $def
}

# ------------------------------------------------------------------ run as administrator
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Asking for administrator rights (needed for the web server service and scheduled tasks)..."
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    exit
}

Write-Host @"

   USRadioguy GOESTOOLS Ground Station - Windows website installer
   ---------------------------------------------------------------
   Website : Vitality GOES + Earth Lab + Ground Station HUD on XAMPP
   Imagery : copied from your receiver Pi(s), or any folder you choose

"@
if (-not (Test-Path (Join-Path $Repo 'web\index.php'))) { Fail "Run this from the extracted repository folder (web\index.php not found)." }
if ($Repo -match '\\(Downloads|Desktop)\\') {
    Warn "This folder is in Downloads/Desktop. The scheduled tasks run scripts from here,"
    Warn "so a permanent folder such as C:\USRadioguy-Groundstation is better."
    if (-not (AskYes "Continue from here anyway?" "yes")) { exit }
}
# Files from a downloaded ZIP are marked "from the internet"; clear that so the tasks can run them
Get-ChildItem -LiteralPath $Repo -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

$StateDir = Join-Path $env:ProgramData 'USRadioguy'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$AnswersFile = Join-Path $StateDir 'install-answers.json'
$script:prev = $null
if (Test-Path $AnswersFile) {
    try { $script:prev = Get-Content $AnswersFile -Raw | ConvertFrom-Json; Ok "using your previous answers as defaults" } catch { }
}

# ------------------------------------------------------------------ XAMPP
Say "Checking for XAMPP"
$xampp = Prev 'xampp' 'C:\xampp'
while (-not (Test-Path (Join-Path $xampp 'apache\bin\httpd.exe'))) {
    Warn "XAMPP not found at $xampp"
    Write-Host "    Install XAMPP (PHP 8.x) from https://www.apachefriends.org , then come back."
    $xampp = Ask "XAMPP folder (or type q to quit)" 'C:\xampp'
    if ($xampp -eq 'q') { exit }
}
$httpd  = Join-Path $xampp 'apache\bin\httpd.exe'
$phpIni = Join-Path $xampp 'php\php.ini'
Ok "XAMPP at $xampp"

# ------------------------------------------------------------------ Python + ffmpeg
function Find-Python {
    foreach ($c in @('py', 'python', 'python3')) {
        $cmd = Get-Command $c -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        try {
            if ($c -eq 'py') { $v = & $cmd.Source -3 --version 2>&1 } else { $v = & $cmd.Source --version 2>&1 }
            if ("$v" -match 'Python 3') { if ($c -eq 'py') { return @($cmd.Source, '-3') } else { return @($cmd.Source) } }
        } catch { }
    }
    $found = @(Get-ChildItem -Path "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe", "$env:ProgramFiles\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
    if ($found.Count -gt 0) { return @($found[0].FullName) }
    return $null
}
function Find-Ffmpeg {
    $found = @(Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\ffmpeg.exe",
                                   "$env:ProgramFiles\WinGet\Packages\Gyan.FFmpeg*\*\bin\ffmpeg.exe",
                                   'C:\ffmpeg\bin\ffmpeg.exe', "$env:ProgramFiles\ffmpeg\bin\ffmpeg.exe" -ErrorAction SilentlyContinue)
    if ($found.Count -gt 0) { return $found[0].FullName }
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) {
        $item = Get-Item $cmd.Source
        if ($item.LinkType -and $item.Target) { return [string]($item.Target | Select-Object -First 1) }
        return $cmd.Source
    }
    return $null
}
$haveWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)

Say "Checking for Python and ffmpeg"
$py = @(Find-Python | Where-Object { $_ })
if ($py.Count -eq 0) {
    if ($haveWinget -and (AskYes "Python 3 is needed to build the site settings. Install it now with winget?" "yes")) {
        & winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
        $py = @(Find-Python | Where-Object { $_ })
    }
    if ($py.Count -eq 0) { Fail "Python 3 not found. Install it from https://www.python.org/downloads/ and run this again." }
}
Ok ("Python: " + ($py -join ' '))

$loopsDefault = Prev 'loops' 'yes'
$ffmpeg = Find-Ffmpeg
if (-not $ffmpeg -and $haveWinget -and (AskYes "ffmpeg makes the 24-hour video loops. Install it now with winget?" "yes")) {
    & winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
    $ffmpeg = Find-Ffmpeg
}
if ($ffmpeg) { Ok "ffmpeg: $ffmpeg" } else { Warn "ffmpeg not found - video loops will be turned off"; $loopsDefault = 'no' }

# ------------------------------------------------------------------ questions
Say "A few questions (press Enter to accept the [default])"
$satsAns = Ask "Satellites your receiver Pi(s) receive: 19, 18, or 19,18" (Prev 'sats' '19')
$sats = @()
foreach ($s in ($satsAns -split '[,\s]+')) {
    switch -regex ($s) { '19' { $sats += 'goes19' } '18' { $sats += 'goes18' } }
}
$sats = @($sats | Select-Object -Unique)
if ($sats.Count -eq 0) { Fail "Please answer 19, 18 or 19,18" }

$rx = @{}
foreach ($s in $sats) {
    $rx[$s] = Ask "Address of the $($s.ToUpper()) receiver Pi (for live signal stats), e.g. 192.168.1.20" (Prev "rx_$s" '')
}

$defData = 'C:\GOES'
if (Test-Path 'D:\') { $defData = 'D:\GOES' }
$data = (Ask "Imagery folder on this PC (it will hold goes19\, goes18\ ...)" (Prev 'data' $defData)).TrimEnd('\')

$doCopy = AskYes "Copy imagery from the Pi(s) to this folder automatically every 5 minutes?" (Prev 'copy' 'yes')
$copySources = @()
if ($doCopy) {
    Add-Type -AssemblyName System.Security
    Write-Host "    (On each Pi, answer 'yes' to the network-share question in install.sh,"
    Write-Host "     or see the Windows guide on usradioguy.com.)"
    foreach ($s in $sats) {
        $share = Ask "Network share of the $($s.ToUpper()) Pi" (Prev "share_$s" ("\\" + $rx[$s] + "\goes"))
        $user  = Ask "User name for $share" (Prev "user_$s" 'pi')
        $sec   = Read-Host "    Password for $share (typing is hidden)" -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
        # Check the login now
        if ($plain) { Invoke-Quiet 'net.exe' @('use', $share, $plain, "/user:$user", '/persistent:no') | Out-Null }
        if (Test-Path -LiteralPath $share) { Ok "connected to $share" }
        else { Warn "couldn't open $share - check the address and password (the task will keep trying)" }
        Invoke-Quiet 'net.exe' @('use', $share, '/delete', '/y') | Out-Null
        $enc = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($plain), $null, 'LocalMachine')
        $copySources += [pscustomobject]@{ share = $share; user = $user; secret = [Convert]::ToBase64String($enc); sat = $s }
        $plain = $null
    }
}

$name     = Ask "Station name (shown on the website)" (Prev 'name' 'My Ground Station')
$location = Ask "Location text (e.g. Anytown, USA)" (Prev 'location' '')
$lat      = Ask "Latitude (decimal, north positive)" (Prev 'lat' '39.02')
$lon      = Ask "Longitude (decimal, east positive; USA is negative)" (Prev 'lon' '-76.98')
$tzMap = @{
    'Eastern Standard Time' = 'America/New_York'; 'Central Standard Time' = 'America/Chicago'
    'Mountain Standard Time' = 'America/Denver'; 'US Mountain Standard Time' = 'America/Phoenix'
    'Pacific Standard Time' = 'America/Los_Angeles'; 'Alaskan Standard Time' = 'America/Anchorage'
    'Hawaiian Standard Time' = 'Pacific/Honolulu'; 'Atlantic Standard Time' = 'America/Halifax'
    'GMT Standard Time' = 'Europe/London'; 'W. Europe Standard Time' = 'Europe/Berlin'
}
$tzDef = 'America/New_York'
try { $wtz = (Get-TimeZone).Id; if ($tzMap.ContainsKey($wtz)) { $tzDef = $tzMap[$wtz] } } catch { }
$tz       = Ask "Time zone" (Prev 'tz' $tzDef)
$state    = (Ask "US state for NWS products (2 letters)" (Prev 'state' 'MD')).ToUpper()
$wxzone   = (Ask "NWS forecast zone (e.g. MDZ013, see weather.gov)" (Prev 'wxzone' "$($state)Z001")).ToUpper()
$orig     = (Ask "NWS office code + state (e.g. LWXMD)" (Prev 'orig' "LWX$state")).ToUpper()
$radar    = (Ask "EMWIN radar region (NTHES, STHES, GRTLK, SOUPLN, NTHRKY, STHRKY, UPRMIS, LWRMIS, PACNWS, PACSWS)" (Prev 'radar' 'NTHES')).ToUpper()
$keepDays = Ask "Days of imagery to keep" (Prev 'keepDays' '3')
$solar    = (Ask "Folder of SDO/SUVI space weather images, e.g. from a GRB station (Enter = none)" (Prev 'solar' 'none')).TrimEnd('\')
if ($solar -eq 'none') { $solar = '' }
if ($solar -and -not (Test-Path -LiteralPath $solar)) { Warn "$solar doesn't exist yet - the Space Weather pages will fill in once images arrive there" }
$loops    = AskYes "Make 24-hour video loops?" $loopsDefault
if ($loops -and -not $ffmpeg) { Warn "no ffmpeg - video loops turned off"; $loops = $false }
$sub      = Ask "Website sub-folder (blank = the top of XAMPP, http://this-pc/)" (Prev 'subfolder' '')
$sub = $sub.Trim('\', '/', ' ')
$htdocs = Join-Path $xampp 'htdocs'
$web = $htdocs
if ($sub) { $web = Join-Path $htdocs $sub }

# ------------------------------------------------------------------ website files
Say "Website files"
New-Item -ItemType Directory -Force -Path $web | Out-Null
if (-not (Test-Path (Join-Path $web 'lab\lab.js'))) {
    # First install here: back up anything (such as XAMPP's own start page) the website replaces
    $backup = Join-Path $xampp ("htdocs-backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $moved = 0
    foreach ($item in Get-ChildItem -LiteralPath (Join-Path $Repo 'web') -Force) {
        $target = Join-Path $web $item.Name
        if (Test-Path -LiteralPath $target) {
            if ($moved -eq 0) { New-Item -ItemType Directory -Force -Path $backup | Out-Null }
            Copy-Item -LiteralPath $target -Destination $backup -Recurse -Force
            $moved++
        }
    }
    if ($moved -gt 0) { Ok "backed up $moved existing item(s) to $backup" }
}
& robocopy.exe (Join-Path $Repo 'web') $web /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "copying the website to $web failed (robocopy $LASTEXITCODE)" }
New-Item -ItemType Directory -Force -Path (Join-Path $web 'videos') | Out-Null
Ok "website copied to $web"

# ------------------------------------------------------------------ site settings
Say "Website settings (for the products your receivers make)"
New-Item -ItemType Directory -Force -Path $data | Out-Null
$disks = @("$($env:SystemDrive)")
$dataDrive = $null
try { $dataDrive = (Split-Path -Qualifier $data) } catch { }
if ($dataDrive -and ($disks -notcontains $dataDrive)) { $disks += $dataDrive }
$pyArgs = @()
if ($py.Count -gt 1) { $pyArgs += $py[1..($py.Count - 1)] }
$pyArgs += @((Join-Path $Repo 'scripts\make-site-config.py'), '--windows', '--data', $data, '--web', $web,
             '--videos-config', (Join-Path $Repo 'windows\24hour\video24config.ini'), '--disks', ($disks -join ', '))
# Windows PowerShell drops empty arguments, so only pass answers that have a value
$opt = [ordered]@{ '--name' = $name; '--location' = $location; '--lat' = $lat; '--lon' = $lon; '--timezone' = $tz
                   '--state' = $state; '--wxzone' = $wxzone; '--orig' = $orig; '--radar' = $radar }
foreach ($k in $opt.Keys) { if ($opt[$k]) { $pyArgs += @($k, $opt[$k]) } }
if ($ffmpeg) { $pyArgs += @('--ffmpeg', $ffmpeg) }
if ($solar) { $pyArgs += @('--solar', $solar) }
foreach ($s in $sats) {
    $pyArgs += @('--sat', $s, '--goesproc', (Join-Path $Repo "goestools\goesproc-$s.conf"))
    if ($rx[$s]) { $pyArgs += @('--rx', "$s=$($rx[$s])") }
}
& $py[0] @pyArgs
if ($LASTEXITCODE -ne 0) { Fail "make-site-config.py failed (see the message above)" }
Ok "web\config\*.ini, lab\lab-config.js, video loop list"
if (Test-Path (Join-Path $web 'config\station.ini')) {
    Write-Host "    Station name, receivers and optional Grafana keys: $(Join-Path $web 'config\station.ini')"
}

# ------------------------------------------------------------------ PHP + Apache
Say "Web server (Apache + PHP)"
$phpChanged = $false
if (Test-Path $phpIni) {
    $ini = Get-Content -LiteralPath $phpIni
    foreach ($ext in @('gd', 'mbstring')) {
        $active = $ini | Where-Object { $_ -match "^\s*extension\s*=\s*(php_)?$ext(\.dll)?\s*$" }
        if (-not $active) {
            $i = 0; $done = $false
            for ($i = 0; $i -lt $ini.Count; $i++) {
                if ($ini[$i] -match "^\s*;\s*extension\s*=\s*(php_)?$ext(\.dll)?\s*$") { $ini[$i] = "extension=$ext"; $done = $true; break }
            }
            if (-not $done) { $ini += "extension=$ext" }
            $phpChanged = $true
            Ok "PHP extension '$ext' turned on"
        }
    }
    if ($phpChanged) {
        Copy-Item -LiteralPath $phpIni -Destination "$phpIni.before-groundstation" -Force
        Set-Content -LiteralPath $phpIni -Value $ini -Encoding Ascii
    }
}

$svc = Get-Service -Name 'Apache2.4' -ErrorAction SilentlyContinue
if (-not $svc) {
    if (AskYes "Run Apache as a Windows service, so the website starts with Windows?" (Prev 'service' 'yes')) {
        $running = Get-Process -Name httpd -ErrorAction SilentlyContinue
        if ($running) {
            Warn "Apache is running from the XAMPP Control Panel. Click Stop next to Apache there,"
            Read-Host "    then press Enter here" | Out-Null
        }
        Invoke-Quiet $httpd @('-k', 'install', '-n', 'Apache2.4') | Out-Null
        $svc = Get-Service -Name 'Apache2.4' -ErrorAction SilentlyContinue
        if ($svc) { Set-Service -Name 'Apache2.4' -StartupType Automatic; Ok "Apache installed as a service" }
        else { Warn "couldn't install the Apache service - start Apache from the XAMPP Control Panel instead" }
    }
}
if ($svc) {
    try {
        if ($svc.Status -eq 'Running') { Restart-Service -Name 'Apache2.4' } else { Start-Service -Name 'Apache2.4' }
        Ok "Apache is running"
    } catch { Warn "Apache didn't start: $($_.Exception.Message). Open the XAMPP Control Panel to see why (often port 80 is in use)." }
} else {
    Warn "Start (or restart) Apache in the XAMPP Control Panel to load the website."
}

# Let phones and other computers on your home network open the site (private networks only)
if (-not (Get-NetFirewallRule -DisplayName 'USRadioguy Ground Station (Apache)' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'USRadioguy Ground Station (Apache)' -Direction Inbound -Program $httpd `
        -Action Allow -Profile Private | Out-Null
    Ok "firewall: website reachable from your home network (private networks only)"
}

# ------------------------------------------------------------------ scheduled tasks
Say "Scheduled tasks (Task Scheduler > USRadioguy Ground Station)"
function Set-StationTask([string]$name, [string]$script, [string]$arguments, $trigger, [int]$limitMinutes) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" $arguments").Trim()
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes $limitMinutes) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskPath '\USRadioguy Ground Station\' -TaskName $name -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Ok $name
}
function Remove-StationTask([string]$name) {
    if (Get-ScheduledTask -TaskPath '\USRadioguy Ground Station\' -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskPath '\USRadioguy Ground Station\' -TaskName $name -Confirm:$false
        Ok "removed task '$name'"
    }
}
$today = (Get-Date).Date

if ($doCopy -and $copySources.Count -gt 0) {
    $maxAge = [int]$keepDays - 1
    if ($maxAge -lt 1) { $maxAge = 1 }
    $copyCfg = Join-Path $StateDir 'copy-imagery.json'
    [pscustomobject]@{ dest = $data; maxAgeDays = $maxAge; sources = $copySources } |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $copyCfg -Encoding UTF8
    # Only Administrators and SYSTEM may read it (it holds the encrypted share password)
    & icacls.exe $copyCfg /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    $t = New-ScheduledTaskTrigger -Once -At $today -RepetitionInterval (New-TimeSpan -Minutes 5)
    Set-StationTask 'Copy imagery from Pi' (Join-Path $Repo 'windows\maintenance\Copy-Imagery.ps1') '' $t 30
} else {
    Remove-StationTask 'Copy imagery from Pi'
}

if ($loops) {
    $t = New-ScheduledTaskTrigger -Once -At $today.AddMinutes(10) -RepetitionInterval (New-TimeSpan -Minutes 30)
    Set-StationTask '24 Hour Videos' (Join-Path $Repo 'windows\24hour\Create24HourVideos.ps1') '' $t 120
} else {
    Remove-StationTask '24 Hour Videos'
}

$t = New-ScheduledTaskTrigger -Daily -At $today.AddMinutes(50)
Set-StationTask 'Imagery Cleanup' (Join-Path $Repo 'windows\maintenance\Cleanup-GOESArchive.ps1') ("-Root `"$data`" -KeepDays $keepDays") $t 120

# ------------------------------------------------------------------ save answers (no passwords)
$answers = [ordered]@{
    xampp = $xampp; sats = ($sats -join ','); data = $data; copy = $(if ($doCopy) { 'yes' } else { 'no' })
    name = $name; location = $location; lat = $lat; lon = $lon; tz = $tz; state = $state; wxzone = $wxzone
    orig = $orig; radar = $radar; keepDays = $keepDays; solar = $(if ($solar) { $solar } else { 'none' }); loops = $(if ($loops) { 'yes' } else { 'no' }); subfolder = $sub
    service = $(if ($svc) { 'yes' } else { 'no' })
}
foreach ($s in $sats) { $answers["rx_$s"] = $rx[$s] }
foreach ($c in $copySources) { $answers["share_$($c.sat)"] = $c.share; $answers["user_$($c.sat)"] = $c.user }
[pscustomobject]$answers | ConvertTo-Json | Set-Content -LiteralPath $AnswersFile -Encoding UTF8

if ($doCopy -and $copySources.Count -gt 0) {
    Start-ScheduledTask -TaskPath '\USRadioguy Ground Station\' -TaskName 'Copy imagery from Pi'
    Ok "first imagery copy started (log: $StateDir\logs\copy-imagery.log)"
}

# ------------------------------------------------------------------ done
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
       Select-Object -First 1).IPAddress
if (-not $ip) { $ip = '<this-pc-address>' }
$path = '/'
if ($sub) { $path = "/$($sub -replace '\\', '/')/" }

Write-Host @"

   Done!

   Open the website on this PC:      http://localhost$path
   ...or from any device at home:    http://$ip$path
       Earth Lab view:               http://$ip$($path)lab/

   Images appear after the first copy from your Pi(s) finishes.
   Settings:   $(Join-Path $web 'config\station.ini')   (name, receivers, Grafana)
   Logs:       $StateDir\logs   and   $(Join-Path $Repo 'windows\24hour\Create24HourVideos.log')
   Update:     download the new ZIP, extract it over this folder, run this installer again.

   Original software:
     * Vitality GOES: (c) 2022-2025 Jamie Vital
         https://github.com/JVital2013/vitality-goes
     * goestools: (c) Pieter Noordhuis and contributors
         https://github.com/pietern/goestools
     * USRadioguy additions (Lab view, HUD, themes, LUTs, Himawari support,
       installers, scripts): (c) 2023-2026 Carl Reinemann
         https://usradioguy.com/

   Please visit usradioguy.com and donate today to help keep the site
   and software running!   https://ko-fi.com/usradioguy

"@ -ForegroundColor Green
Read-Host "Press Enter to close" | Out-Null
