$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$extensionDir = Join-Path $root "extension"
$extensionManifest = Join-Path $extensionDir "manifest.json"
$hostDir = Join-Path $root "host"
$hostName = "com.voided.video_downloader"
$hostCmd = Join-Path $hostDir "ytp_downloader_host.cmd"
$hostManifest = Join-Path $hostDir "$hostName.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

function Get-ChromeExtensionIdFromKey {
  param([Parameter(Mandatory = $true)][string]$Key)

  $bytes = [Convert]::FromBase64String($Key)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha256.ComputeHash($bytes)
  $alphabet = "abcdefghijklmnop"
  $id = New-Object System.Text.StringBuilder

  foreach ($byte in $hash[0..15]) {
    [void]$id.Append($alphabet[[int]($byte -shr 4)])
    [void]$id.Append($alphabet[[int]($byte -band 15)])
  }

  return $id.ToString()
}

function Test-CommandOnPath {
  param([Parameter(Mandatory = $true)][string]$Name)

  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-SessionPathFromRegistry {
  $machinePath = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" -Name Path -ErrorAction SilentlyContinue).Path
  $userPath = (Get-ItemProperty -Path "HKCU:\Environment" -Name Path -ErrorAction SilentlyContinue).Path
  $parts = @($machinePath, $userPath) | Where-Object { $_ }
  if ($parts.Count -gt 0) {
    $env:Path = $parts -join ";"
  }
}

function Install-FfmpegIfNeeded {
  $missing = @()

  if (-not (Test-CommandOnPath -Name "ffmpeg")) {
    $missing += "ffmpeg"
  }

  if (-not (Test-CommandOnPath -Name "ffprobe")) {
    $missing += "ffprobe"
  }

  if ($missing.Count -eq 0) {
    Write-Host "ffmpeg and ffprobe found on PATH. MP3 conversion is available."
    return
  }

  Write-Warning "MP3 conversion needs ffmpeg and ffprobe, but missing: $($missing -join ', ')"

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Host "Install FFmpeg manually, then restart Chrome:"
    Write-Host "  https://ffmpeg.org/download.html"
    return
  }

  $answer = Read-Host "Install FFmpeg now with winget? [Y/n]"
  if ($answer -match "^[Nn]") {
    Write-Host "Skipping FFmpeg install. MP3 conversion will stay unavailable until ffmpeg and ffprobe are on PATH."
    return
  }

  & $winget.Source install --id Gyan.FFmpeg -e --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "winget could not install FFmpeg. MP3 conversion will stay unavailable until ffmpeg and ffprobe are on PATH."
    return
  }

  Update-SessionPathFromRegistry

  if ((Test-CommandOnPath -Name "ffmpeg") -and (Test-CommandOnPath -Name "ffprobe")) {
    Write-Host "FFmpeg installed. Restart Chrome before using MP3 conversion."
  } else {
    Write-Host "FFmpeg install finished, but this session cannot see ffmpeg yet. Restart PowerShell and Chrome before using MP3 conversion."
  }
}

$manifest = Get-Content $extensionManifest -Raw | ConvertFrom-Json
$extensionId = Get-ChromeExtensionIdFromKey -Key $manifest.key
$python = (Get-Command python -ErrorAction Stop).Source

@"
@echo off
"$python" "%~dp0ytp_downloader_host.py"
"@ | Set-Content -LiteralPath $hostCmd -Encoding ASCII

$nativeManifest = [ordered]@{
  name = $hostName
  description = "Local yt-dlp backend for Voided Video Downloader"
  path = $hostCmd
  type = "stdio"
  allowed_origins = @("chrome-extension://$extensionId/")
}

$nativeManifest |
  ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath $hostManifest -Encoding UTF8

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifest

Install-FfmpegIfNeeded

Write-Host "Installed native messaging host: $hostName"
Write-Host "Extension ID: $extensionId"
Write-Host "Extension directory: $extensionDir"
Write-Host "Downloads will ask where to save by default."
Write-Host "If 'Ask every time' is off and no default folder is set, downloads will use: $([IO.Path]::Combine($env:USERPROFILE, 'Downloads', 'yt-dlp'))"
Write-Host "MP3 conversion requires ffmpeg and ffprobe on PATH. Restart Chrome after installing FFmpeg."
Write-Host ""
Write-Host "Next step: open chrome://extensions, enable Developer mode, and Load unpacked using the extension directory above."
