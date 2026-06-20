$ErrorActionPreference = "Stop"

$hostName = "com.voided.video_downloader"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (Test-Path $registryPath) {
  Remove-Item -Path $registryPath -Force
  Write-Host "Removed native messaging host registration: $hostName"
} else {
  Write-Host "Native messaging host was not registered: $hostName"
}
