$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$manifest = [IO.File]::ReadAllText((Join-Path $pluginRoot 'herdr-plugin.toml'))
$versionMatch = [regex]::Match($manifest, '(?m)^version = "([0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[0-9]+)?)"\s*$')
if (!$versionMatch.Success) { throw 'Herdr World plugin: invalid manifest version' }
$version = $versionMatch.Groups[1].Value
$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
switch ($architecture) {
  'X64' { $platform = 'windows-x64' }
  'Arm64' { $platform = 'windows-arm64' }
  default { throw "Herdr World plugin: unsupported Windows architecture $architecture" }
}
Get-Command tar.exe -CommandType Application -ErrorAction Stop | Out-Null
$packageDir = "herdr-world-$platform"
$archiveName = "herdr-world-v$version-$platform.tar.xz"
$releaseBase = "https://github.com/IvoryHeart/herdr-world/releases/download/v$version"
$environment = [Environment]::GetEnvironmentVariables()
$customReleaseBase = $environment['HERDR_WORLD_RELEASE_BASE_URL']
if ($customReleaseBase) { $releaseBase = $customReleaseBase.TrimEnd('/') }
$uri = [Uri]$releaseBase
if (!$uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
    ($uri.Scheme -ne 'https' -and !($uri.Scheme -eq 'http' -and $uri.IsLoopback))) {
  throw 'Herdr World plugin: release base must use HTTPS (or loopback HTTP), without credentials, query or fragment'
}

$serverDir = Join-Path $pluginRoot 'server'
New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
# The staging copy is executed below, and Windows or an antivirus scan can keep
# that image locked briefly after the process exits. Removing it is cleanup, not
# installation: retry for a few seconds, then leave the folder for a later
# install to sweep. It must never fail a finished install or replace a real error.
function Remove-Staging([string]$path, [int]$attempts) {
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    try {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
      return $true
    } catch {
      if ($attempt -lt $attempts) { Start-Sleep -Milliseconds 300 }
    }
  }
  return $false
}
# Folders left that way by earlier installs; recent ones may belong to a running install.
Get-ChildItem -LiteralPath $serverDir -Directory -Force -Filter '.plugin-install-*' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddHours(-1) } |
  ForEach-Object { [void](Remove-Staging $_.FullName 1) }
$staging = Join-Path $serverDir ('.plugin-install-' + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  $archive = Join-Path $staging $archiveName
  $checksum = "$archive.sha256"
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri "$releaseBase/$archiveName" -OutFile $archive
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri "$releaseBase/$archiveName.sha256" -OutFile $checksum
  if ((Get-Item -LiteralPath $checksum).Length -gt 4096) { throw 'Invalid package checksum file' }
  $pattern = '\A([0-9a-fA-F]{64})[ \t]+' + [regex]::Escape($archiveName) + '\r?\n?\z'
  $digest = [regex]::Match([IO.File]::ReadAllText($checksum), $pattern)
  if (!$digest.Success) { throw 'Invalid package checksum file' }
  # Windows PowerShell can run with no module discovery path. Hash through
  # .NET so integrity verification never depends on Get-FileHash availability.
  $sha256 = [Security.Cryptography.SHA256]::Create()
  $archiveStream = [IO.File]::OpenRead($archive)
  try {
    $actualDigest = [BitConverter]::ToString($sha256.ComputeHash($archiveStream)).Replace('-', '')
  } finally {
    $archiveStream.Dispose()
    $sha256.Dispose()
  }
  if ($actualDigest -ne $digest.Groups[1].Value) {
    throw 'Package checksum mismatch'
  }
  & tar.exe -xJf $archive -C $staging "$packageDir/VERSION" "$packageDir/herdr-world.exe"
  if ($LASTEXITCODE -ne 0) { throw 'Could not extract the Herdr World package' }
  $extracted = Join-Path $staging $packageDir
  $binary = Join-Path $extracted 'herdr-world.exe'
  $versionFile = Join-Path $extracted 'VERSION'
  foreach ($path in @($extracted, $binary, $versionFile)) {
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'Invalid package layout'
    }
  }
  if ([IO.File]::ReadAllText($versionFile).Trim() -ne "herdr-world $version $platform") {
    throw 'Package VERSION does not match the plugin version and platform'
  }
  $actualVersion = (& $binary --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualVersion -ne "herdr-world $version") { throw 'Binary version mismatch' }
  $nativeVersion = (& $binary plugin version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $nativeVersion -ne "herdr-world $version") {
    throw 'This release has no native plugin commands. Build an unreleased checkout with `bun scripts/world-plugin.ts build-source`, then `herdr plugin link .`, or select a published tag that includes native plugin support.'
  }
  # Cached manifests still invoke the historical plugin executable basename.
  $targets = @('herdr-world.exe', 'herdr-world-plugin.exe')
  foreach ($name in $targets) {
    $target = Join-Path $serverDir $name
    if (Test-Path -LiteralPath $target) {
      $existing = Get-Item -LiteralPath $target
      if ($existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Install target is not a regular file'
      }
      [IO.File]::Copy($target, (Join-Path $staging ("previous-$name")))
    }
    [IO.File]::Copy($binary, (Join-Path $staging $name))
  }
  $promoted = @()
  try {
    foreach ($name in $targets) {
      $target = Join-Path $serverDir $name
      $candidate = Join-Path $staging $name
      if (Test-Path -LiteralPath $target) {
        [IO.File]::Replace($candidate, $target, (Join-Path $staging ("replaced-$name")))
      } else {
        [IO.File]::Move($candidate, $target)
      }
      $promoted += $name
    }
  } catch {
    foreach ($name in $promoted) {
      $target = Join-Path $serverDir $name
      $previous = Join-Path $staging ("previous-$name")
      if (Test-Path -LiteralPath $previous) {
        [IO.File]::Replace($previous, $target, (Join-Path $staging ("rollback-$name")))
      } else {
        [IO.File]::Delete($target)
      }
    }
    throw
  }
  Write-Output "Installed Herdr World plugin binary $version"
} finally {
  if (!(Remove-Staging $staging 10)) {
    [Console]::Error.WriteLine("Herdr World plugin: could not remove the temporary folder $staging yet; a later install removes it.")
  }
}
