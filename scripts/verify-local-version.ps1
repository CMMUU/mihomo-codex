param(
    [string]$InstalledPath = (Join-Path $env:LOCALAPPDATA 'Programs\RouteDeck\routedeck.exe'),
    [Parameter(Mandatory = $true)][ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')][string]$PublishedVersion
)
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot '..\src-tauri\tauri.conf.json'
$sourceVersion = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).version
$installed = Get-Item -LiteralPath $InstalledPath
if ($installed.VersionInfo.ProductName -ne 'RouteDeck') { throw 'The selected file is not RouteDeck.' }
$installedVersion = $installed.VersionInfo.ProductVersion
$versionAgreement = $installedVersion -eq $PublishedVersion -and $sourceVersion -eq $PublishedVersion
[pscustomobject]@{ InstalledVersion = $installedVersion; SourceVersion = $sourceVersion; PublishedVersion = $PublishedVersion; Matches = $versionAgreement; InstalledPath = $installed.FullName }
if (-not $versionAgreement) { exit 2 }
