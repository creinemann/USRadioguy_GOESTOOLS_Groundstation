<#
  Create24HourVideos.ps1  -  USradioguy.com / Vitality GOES
  ------------------------------------------------------------------
  Makes rolling 24-hour timelapse MP4s from goestools imagery for the
  Vitality GOES "Timelapse" links (videoPath = ... in the .ini files).

  - Reads video24config.ini from this same folder.
  - Looks in today's folders (liveRoots, e.g. D:\goes) AND an archive
    folder a nightly task moves files into (archiveRoots), so the
    video is a full 24 hours even right after the nightly move.
  - Frame times come from the goestools file name (..._20261122T143021Z.jpg),
    so videos are in the right order no matter where a file lives.
  - Writes to a temp file first, then swaps it in, so visitors never get
    a half-made video. If a product has too few frames, the old video
    is kept.
  - Only one copy runs at a time.

  Usage (PowerShell):
    .\Create24HourVideos.ps1              make all videos
    .\Create24HourVideos.ps1 -Check       just report what it would use
    .\Create24HourVideos.ps1 -Only GOES19Ch13,USRadar
    .\Create24HourVideos.ps1 -Force       re-make even if nothing has changed
    .\Create24HourVideos.ps1 -Only GOES18Ch13 -MinFrames 2   test with only a few frames

  Written November 2026 for Windows PowerShell 5.1 (built into Windows).
  Based on the Vitality GOES scripts by Jamie Vital (GPL v3).
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [string[]]$Only,
    [switch]$Force,
    [int]$MinFrames = 0      # testing: override minFrames from the config for this run
)

$ErrorActionPreference = 'Stop'
$here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $here 'video24config.ini'
$logPath    = Join-Path $here 'Create24HourVideos.log'
$imageExt   = @('.jpg', '.jpeg', '.png', '.gif')

# ------------------------------------------------------------------ logging
function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Host $line
    if (-not $Check) { Add-Content -Path $logPath -Value $line -Encoding UTF8 }
}
function Limit-Log {
    if (Test-Path $logPath) {
        $lines = Get-Content $logPath
        if ($lines.Count -gt 5000) { $lines | Select-Object -Last 3000 | Set-Content $logPath -Encoding UTF8 }
    }
}

# ------------------------------------------------------------------ config
function Read-VideoConfig([string]$path) {
    if (-not (Test-Path $path)) { throw "Config file not found: $path" }
    $settings = @{}
    $videos = New-Object System.Collections.ArrayList
    $current = $null
    foreach ($raw in Get-Content $path) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith(';') -or $line.StartsWith('#')) { continue }
        if ($line -match '^\[(.+)\]$') {
            $name = $Matches[1].Trim()
            if ($name -ieq 'settings') { $current = $settings }
            else {
                $current = @{ name = $name }
                [void]$videos.Add($current)
            }
            continue
        }
        if ($null -ne $current -and $line -match '^([^=]+?)\s*=\s*(.*)$') {
            $current[$Matches[1].Trim().ToLower()] = $Matches[2].Trim().Trim('"')
        }
    }
    return @{ settings = $settings; videos = $videos }
}
function Get-Setting($settings, [string]$key, $default) {
    if ($settings.ContainsKey($key.ToLower()) -and $settings[$key.ToLower()] -ne '') { return $settings[$key.ToLower()] }
    return $default
}
function Split-List([string]$text) {
    if (-not $text) { return @() }
    return @($text.Split('|') | ForEach-Object { $_.Trim().TrimEnd('\') } | Where-Object { $_ -ne '' })
}

# ------------------------------------------------------------------ frame times
# goestools: goes19_FD_CH13_20261122T143021Z.jpg / Himawari9_FD_IR_20260407T005100Z.jpg
# EMWIN:     ..._20261122143000_...RADREFUS.GIF  (14 digits)
$timePatterns = @(
    @{ rx = '(\d{8}T\d{6})Z';            fmt = 'yyyyMMddTHHmmss' },
    @{ rx = '(?<!\d)(\d{8}_\d{6})(?!\d)'; fmt = 'yyyyMMdd_HHmmss' },
    @{ rx = '(?<!\d)(\d{14})(?!\d)';      fmt = 'yyyyMMddHHmmss' },
    @{ rx = '(?<!\d)(\d{8}_\d{4})(?!\d)'; fmt = 'yyyyMMdd_HHmm' },
    @{ rx = '(?<!\d)(\d{12})(?!\d)';      fmt = 'yyyyMMddHHmm' }
)
function Get-FrameTimeUtc([System.IO.FileInfo]$file) {
    foreach ($p in $timePatterns) {
        $m = [regex]::Match($file.Name, $p.rx)
        if ($m.Success) {
            $t = [datetime]::MinValue
            $ok = [datetime]::TryParseExact($m.Groups[1].Value, $p.fmt,
                    [Globalization.CultureInfo]::InvariantCulture,
                    ([Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal), [ref]$t)
            if ($ok -and $t.Year -ge 2000 -and $t.Year -le 2100) { return $t }
        }
    }
    return $file.LastWriteTimeUtc   # no time in the name - use the file date
}

# ------------------------------------------------------------------ find frames
# Only opens the dated sub-folders (YYYY-MM-DD) that can hold frames from the
# time window, so it stays fast even with years of archive under each product.
function Get-WindowDayNames([datetime]$startUtc, [datetime]$endUtc) {
    $names = @{}
    $d = $startUtc.Date.AddDays(-1)
    while ($d -le $endUtc.Date.AddDays(1)) {
        $names[$d.ToString('yyyy-MM-dd')] = $true
        $names[$d.ToString('yyyyMMdd')]   = $true
        $names[$d.ToString('yyyy_MM_dd')] = $true
        $d = $d.AddDays(1)
    }
    return $names
}
function Get-SearchFolders($video, $liveRoots, $archiveRoots) {
    $folders = New-Object System.Collections.ArrayList
    $paths = @(Split-List $video['paths'])
    if ($paths.Count -gt 0) { $folders.AddRange($paths) }
    elseif ($video['sub']) {
        $sub = $video['sub'].Trim('\')
        foreach ($root in @($liveRoots) + @($archiveRoots)) { [void]$folders.Add((Join-Path $root $sub)) }
    }
    return $folders
}
# Each folder is read once per run and shared (the EMWIN archive holds
# ~86,000 files and feeds 7 videos). GetFiles() also brings back size and
# date in the same pass, which is much faster than asking file by file.
$script:dirCache = @{}
function Get-DirFiles([string]$dir) {
    if (-not $script:dirCache.ContainsKey($dir)) {
        $script:dirCache[$dir] = (New-Object IO.DirectoryInfo($dir)).GetFiles()
    }
    return ,$script:dirCache[$dir]
}
function Get-Frames($video, $folders, $dayNames, [datetime]$startUtc, [datetime]$endUtc) {
    $filter = $video['filter']
    $settleTime = (Get-Date).ToUniversalTime().AddSeconds(-30)   # skip files still being written
    $byTime = @{}
    $foldersFound = 0
    foreach ($folder in $folders) {
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
        $foldersFound++
        $dirs = New-Object System.Collections.ArrayList
        [void]$dirs.Add($folder)
        foreach ($child in [IO.Directory]::EnumerateDirectories($folder)) {
            if ($dayNames.ContainsKey([IO.Path]::GetFileName($child))) { [void]$dirs.Add($child) }
        }
        foreach ($dir in $dirs) {
            foreach ($fi in (Get-DirFiles $dir)) {
                $name = $fi.Name
                if ($filter -and $name.IndexOf($filter, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
                if ($imageExt -notcontains $fi.Extension.ToLower()) { continue }
                if ($fi.Length -lt 2048 -or $fi.LastWriteTimeUtc -gt $settleTime) { continue }
                $t = Get-FrameTimeUtc $fi
                if ($t -lt $startUtc -or $t -gt $endUtc) { continue }
                $key = $t.ToString('yyyyMMddHHmmss')
                if (-not $byTime.ContainsKey($key)) { $byTime[$key] = $fi }   # same frame in two places = once
            }
        }
    }
    $frames = @($byTime.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Value })
    return @{ frames = $frames; foldersFound = $foldersFound }
}

# ------------------------------------------------------------------ render
function New-Video($video, $frames, $s) {
    $name     = $video['name']
    # per-video overrides: fps = / smooth = in that video's [section]
    $s = $s.Clone()
    if ($video['fps'])    { $s.fps = [int]$video['fps'] }
    if ($video['smooth']) { $s.smooth = $video['smooth'] -match '^(yes|true|1|on)$' }
    # few frames (e.g. 48 full-disk images a day)? slow down so it lasts minSeconds
    if (-not $video['fps'] -and $s.minSeconds -gt 0 -and ($frames.Count / $s.fps) -lt $s.minSeconds) {
        $s.fps = [Math]::Max(2, [int][Math]::Floor($frames.Count / $s.minSeconds))
    }
    $outFile  = Join-Path $s.videoDir "$name.mp4"
    $tmpFile  = Join-Path $s.videoDir "$name.rendering.mp4"
    $listFile = Join-Path $env:TEMP "v24_$name.txt"

    # ffmpeg concat list (UTF-8 without BOM; forward slashes; quotes escaped)
    $dur = (1.0 / $s.fps).ToString('0.######', [Globalization.CultureInfo]::InvariantCulture)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('ffconcat version 1.0')
    foreach ($f in $frames) {
        $p = $f.FullName.Replace('\', '/').Replace("'", "'\''")
        [void]$sb.AppendLine("file '$p'")
        [void]$sb.AppendLine("duration $dur")
    }
    $last = $frames[$frames.Count - 1].FullName.Replace('\', '/').Replace("'", "'\''")
    [void]$sb.AppendLine("file '$last'")   # concat needs the last frame twice
    [IO.File]::WriteAllText($listFile, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))

    # even dimensions, capped width; optional smooth motion
    $vf = "scale=w=trunc(min($($s.maxWidth)\,iw)/2)*2:h=-2:flags=lanczos"
    if ($s.smooth) { $vf += "," + $s.smoothFilter }
    $vf += ",format=yuv420p"

    $ffArgs = @('-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'concat', '-safe', '0', '-i', $listFile,
                '-vf', $vf)
    if (-not $s.smooth) { $ffArgs += @('-r', "$($s.fps)") }
    $ffArgs += @('-c:v', 'libx264', '-preset', 'veryfast', '-crf', "$($s.crf)",
                 '-movflags', '+faststart', $tmpFile)

    if (Test-Path $tmpFile) { Remove-Item $tmpFile -Force }
    # PowerShell 5.1 treats any ffmpeg message as an error under 'Stop'
    $oldEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & $s.ffmpeg @ffArgs 2>&1 | ForEach-Object { Write-Log "    ffmpeg: $_" }
    $exit = $LASTEXITCODE
    $ErrorActionPreference = $oldEap
    Remove-Item $listFile -Force -ErrorAction SilentlyContinue

    if ($exit -ne 0 -or -not (Test-Path $tmpFile) -or (Get-Item $tmpFile).Length -lt 1024) {
        Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
        throw "ffmpeg failed (exit $exit) - previous video kept"
    }
    # swap in; retry if a visitor's browser has the old file open
    for ($try = 1; $try -le 5; $try++) {
        try { Move-Item -LiteralPath $tmpFile -Destination $outFile -Force; return @{ file = $outFile; fps = $s.fps } }
        catch { Start-Sleep -Seconds 3 }
    }
    throw "Could not replace $outFile (file in use?) - new video left as $tmpFile"
}

# ------------------------------------------------------------------ state
$statePath = Join-Path $here 'Create24HourVideos.state'
$state = @{}
if (Test-Path $statePath) {
    foreach ($l in Get-Content $statePath) { $i = $l.IndexOf('='); if ($i -gt 0) { $state[$l.Substring(0, $i)] = $l.Substring($i + 1) } }
}
function Save-State {
    $state.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}={1}' -f $_.Name, $_.Value } | Set-Content $statePath -Encoding UTF8
}

# ================================================================== main
$cfg = Read-VideoConfig $configPath
$st  = $cfg.settings
$s = @{
    ffmpeg    = Get-Setting $st 'ffmpeg' 'ffmpeg.exe'
    videoDir  = (Get-Setting $st 'videoDir' (Join-Path $here 'videos')).TrimEnd('\')
    hours     = [double](Get-Setting $st 'hours' 24)
    fps       = [int](Get-Setting $st 'fps' 15)
    maxWidth  = [int](Get-Setting $st 'maxWidth' 1500)
    crf       = [int](Get-Setting $st 'crf' 22)
    minFrames = [int](Get-Setting $st 'minFrames' 6)
    minSeconds = [double](Get-Setting $st 'minSeconds' 8)
    smooth    = (Get-Setting $st 'smooth' 'no') -match '^(yes|true|1|on)$'
    # same interpolation as GOES96hours.bat
    smoothFilter = Get-Setting $st 'smoothFilter' 'minterpolate=mi_mode=blend:me_mode=bidir:fps=25:mc_mode=obmc:me=ds:vsbmc=1'
}
if ($MinFrames -gt 0) { $s.minFrames = $MinFrames }
$liveRoots    = @(Split-List (Get-Setting $st 'liveRoots' ''))
$archiveRoots = @(Split-List (Get-Setting $st 'archiveRoots' ''))

if (-not (Test-Path $s.ffmpeg) -and -not (Get-Command $s.ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Log "ERROR: ffmpeg not found at $($s.ffmpeg) - fix 'ffmpeg =' in video24config.ini"; exit 1
}
if (-not (Test-Path $s.videoDir)) { Write-Log "ERROR: videoDir not found: $($s.videoDir)"; exit 1 }

# one run at a time
$mutex = New-Object System.Threading.Mutex($false, 'Global\USRadioguy_Create24HourVideos')
if (-not $mutex.WaitOne(0)) { Write-Log 'Another run is still working - skipping this one.'; exit 0 }

try {
    $endUtc   = (Get-Date).ToUniversalTime()
    $startUtc = $endUtc.AddHours(-$s.hours)
    $dayNames = Get-WindowDayNames $startUtc $endUtc
    $videos   = $cfg.videos
    if ($Only) {
        $wanted = @($Only | ForEach-Object { $_.Split(',') } | ForEach-Object { $_.Trim() })
        $videos = @($videos | Where-Object { $wanted -contains $_['name'] })
    }

    $mode = 'Rendering'; if ($Check) { $mode = 'CHECK ONLY (no videos made)' }
    Write-Log ("=== {0}: {1} video(s), last {2} h ({3:yyyy-MM-dd HH:mm} to {4:HH:mm} UTC) ===" -f $mode, $videos.Count, $s.hours, $startUtc, $endUtc)
    $made = 0; $skipped = 0; $failed = 0
    $timer = [Diagnostics.Stopwatch]::StartNew()

    foreach ($video in $videos) {
        $name = $video['name']
        try {
            $folders = Get-SearchFolders $video $liveRoots $archiveRoots
            if ($folders.Count -eq 0) { Write-Log "  $name : no 'sub' or 'paths' set - skipped"; $skipped++; continue }
            $found  = Get-Frames $video $folders $dayNames $startUtc $endUtc
            $frames = $found.frames
            $count  = $frames.Count

            if ($found.foldersFound -eq 0) {
                Write-Log "  $name : none of these folders exist: $($folders -join ' | ')"; $skipped++; continue
            }
            $span = ''
            if ($count -gt 0) {
                $span = " ({0:MM-dd HH:mm} to {1:MM-dd HH:mm} UTC)" -f (Get-FrameTimeUtc $frames[0]), (Get-FrameTimeUtc $frames[$count - 1])
            }
            if ($Check) { Write-Log ("  {0,-30} {1,5} frames{2}" -f $name, $count, $span); continue }

            if ($count -lt $s.minFrames) {
                Write-Log "  $name : only $count frame(s) - kept previous video"; $skipped++; continue
            }
            $outFile = Join-Path $s.videoDir "$name.mp4"
            # remember what each video was built from, so new frames at EITHER
            # end (new images, or older ones from an added archive) trigger a rebuild
            $signature = '{0}|{1}|{2}' -f $count, $frames[0].FullName, $frames[$count - 1].FullName
            if (-not $Force -and (Test-Path $outFile) -and $state[$name] -eq $signature) {
                Write-Log "  $name : no new frames since last video - skipped"; $skipped++; continue
            }
            $t0 = $timer.Elapsed.TotalSeconds
            $out = New-Video $video $frames $s
            $state[$name] = $signature
            Save-State
            Write-Log ("  {0} : {1} frames{2} -> {3:N1} MB in {4:N0}s" -f $name, $count, $span, ((Get-Item $out.file).Length / 1MB), ($timer.Elapsed.TotalSeconds - $t0))
            $made++
        }
        catch {
            Write-Log "  $name : ERROR - $($_.Exception.Message)"; $failed++
        }
    }
    if (-not $Check) { Write-Log ("=== Done: {0} made, {1} skipped, {2} failed in {3:N0}s ===" -f $made, $skipped, $failed, $timer.Elapsed.TotalSeconds) }
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
    if (-not $Check) { Limit-Log }
}
