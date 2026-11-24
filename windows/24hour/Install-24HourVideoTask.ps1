<#
  Install-24HourVideoTask.ps1  -  USradioguy.com
  Creates a Windows Task Scheduler job that runs Create24HourVideos.ps1
  every hour at 40 minutes past (well clear of the 12:30 AM file move).

  Run ONCE, in PowerShell opened with "Run as administrator":
      cd C:\xampp\htdocs\scripts-windows\24hour   (wherever you put these files)
      .\Install-24HourVideoTask.ps1

  To remove it later:  schtasks /Delete /TN "USRadioguy\24 Hour Videos" /F
#>
$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'Create24HourVideos.ps1'
if (-not (Test-Path $script)) { Write-Error "Can't find $script"; exit 1 }

$taskName = 'USRadioguy\24 Hour Videos'
$run = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# Runs as SYSTEM so it works whether or not you're logged in
schtasks /Create /TN $taskName /TR $run /SC HOURLY /ST 00:40 /RU SYSTEM /RL HIGHEST /F
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Scheduled: '$taskName' runs every hour at :40." -ForegroundColor Green
    Write-Host "Run it now:  schtasks /Run /TN `"$taskName`""
    Write-Host "Log file:    $(Join-Path (Split-Path $script) 'Create24HourVideos.log')"
}
