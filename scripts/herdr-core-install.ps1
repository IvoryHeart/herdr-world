# herdr-core install and login setup on Windows: World's reviewed copy of the
# steps in core's official installer (https://releases.herdr.dev/core/install.ps1):
# read the release manifest over HTTPS, download the zip, compare its SHA-256
# with the manifest, unpack it with Windows' own tar.exe, run `--version`, and
# place herdr-core.exe (with Microsoft's ConPTY beside it) in
# %LOCALAPPDATA%\Programs\herdr-core, with hc.exe linked to it only when no
# `hc` exists, and that folder on the user's PATH. Nothing downloaded is ever
# run as a script.
#
# These are functions only, the Windows twin of herdr-core-install.sh. World's
# server runs them on this computer with Windows PowerShell 5.1, the script on
# stdin and one call appended. They never replace, update or remove an
# installed core. HC_INSTALL_DIR places core elsewhere, as in core's installer.
# ASCII only: PowerShell reads stdin in the console's code page.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function herdr_core_fail($why) {
  [Console]::Error.WriteLine("herdr-core: $why")
  exit 1
}

function herdr_core_dir {
  if ($env:HC_INSTALL_DIR) { return $env:HC_INSTALL_DIR }
  return (Join-Path $env:LOCALAPPDATA 'Programs\herdr-core')
}

# The installed herdr-core, if any: core's install folder, herdr-core on PATH,
# or an `hc` that says it is core (other programs also ship an `hc`).
function herdr_core_find {
  $exe = Join-Path (herdr_core_dir) 'herdr-core.exe'
  if (Test-Path -LiteralPath $exe) { return $exe }
  $found = Get-Command herdr-core -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.Source }
  $hc = Get-Command hc -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hc) {
    $said = ''
    try { $said = [string](& $hc.Source --version) } catch {}
    if ($said -match '^hc [0-9]') { return $hc.Source }
  }
  return $null
}

# The release target core publishes for this computer (x64 only, as core says).
function herdr_core_target {
  $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($arch -eq 'AMD64') { return 'windows-x86_64' }
  return $null
}

# One line per fact, for World's confirmation step. Reads only; runs nothing
# but an `hc --version` identity check.
function herdr_core_probe {
  $target = herdr_core_target
  if (-not $target) { $target = 'unsupported' }
  $tui = Get-Command herdr -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $tuiPath = if ($tui) { $tui.Source } else { '' }
  $standalone = Join-Path $env:LOCALAPPDATA 'Programs\Herdr\bin\herdr.exe'
  if (-not $tuiPath -and (Test-Path -LiteralPath $standalone)) { $tuiPath = $standalone }
  [Console]::Out.Write("target=$target`n")
  [Console]::Out.Write("core=$(herdr_core_find)`n")
  [Console]::Out.Write("herdr=$tuiPath`n")
  [Console]::Out.Write("dir=$(herdr_core_dir)`n")
  [Console]::Out.Write("login=startup`n")
}

function herdr_core_say($line) {
  [Console]::Out.Write("$line`n")
}

function herdr_core_fetch($seconds, $url, $file) {
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  & $curl --proto '=https' --proto-redir '=https' -fsSL --retry 2 --connect-timeout 10 --max-time $seconds $url -o $file
  return ($LASTEXITCODE -eq 0)
}

# Installs herdr-core when none is installed. $requested is an exact version,
# or empty for the newest release. Progress goes to stdout as it happens.
function herdr_core_install($requested) {
  $releases = 'https://releases.herdr.dev'
  $dir = herdr_core_dir
  $existing = herdr_core_find
  if ($existing) {
    herdr_core_say "herdr-core is already installed at $existing; leaving it unchanged."
    return
  }
  $target = herdr_core_target
  if (-not $target) { herdr_core_fail 'there is no herdr-core build for this Windows (x64 only)' }
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  # Windows' own tar opens zips; Git Bash's, often first on PATH, cannot.
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (-not (Test-Path -LiteralPath $curl) -or -not (Test-Path -LiteralPath $tar)) {
    herdr_core_fail 'this computer needs curl.exe and tar.exe (Windows 10 1803 or newer)'
  }
  if ($requested) {
    if ($requested -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]*$') { herdr_core_fail "invalid herdr-core version: $requested" }
    $manifest = "$releases/core/$requested/manifest.json"
  } else {
    $manifest = "$releases/core/latest.json"
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("herdr-core-install-$PID-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $staged = $null
  try {
    herdr_core_say 'Reading the herdr-core release list...'
    if (-not (herdr_core_fetch 60 $manifest "$tmp\manifest.json")) {
      herdr_core_fail "could not reach $manifest; check this computer's internet connection"
    }
    # JSON is read as data; nothing in it is run.
    $m = [IO.File]::ReadAllText("$tmp\manifest.json") | ConvertFrom-Json
    $entry = $m.targets.$target
    $url = [string]$entry.url
    $want = [string]$entry.sha256
    $version = [string]$m.version
    if (-not $url -or -not $want -or -not $version) { herdr_core_fail "the release list has no herdr-core build for $target" }
    if (-not $url.StartsWith("$releases/core/", [StringComparison]::Ordinal)) { herdr_core_fail "the release list points outside $releases" }
    if ($url -cnotmatch '^[A-Za-z0-9/:._+-]+$') { herdr_core_fail 'the release list has an invalid download address' }
    if ($want -cnotmatch '^[0-9a-f]{64}$') { herdr_core_fail 'the release list has an invalid checksum' }
    if ($version -cnotmatch '^[0-9A-Za-z.+-]+$') { herdr_core_fail 'the release list has an invalid version' }
    if ($requested -and $version -cne $requested) { herdr_core_fail "the release list is for $version, not $requested" }
    herdr_core_say "Downloading herdr-core $version for $target..."
    if (-not (herdr_core_fetch 600 $url "$tmp\hc.zip")) {
      herdr_core_fail "the download failed; check this computer's internet connection"
    }
    # .NET, not Get-FileHash: that one fails when PowerShell 7 starts 5.1.
    $stream = [IO.File]::OpenRead("$tmp\hc.zip")
    try {
      $got = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
    } finally { $stream.Close() }
    if ($got -cne $want) { herdr_core_fail 'the download is damaged (checksum mismatch); try again' }
    herdr_core_say 'Checksum verified. Unpacking...'
    New-Item -ItemType Directory -Path "$tmp\release" | Out-Null
    & $tar -xf "$tmp\hc.zip" -C "$tmp\release"
    if ($LASTEXITCODE) { herdr_core_fail 'could not unpack the download' }
    $new = "$tmp\release\herdr-core.exe"
    if (-not (Test-Path -LiteralPath $new -PathType Leaf) -or -not (Test-Path -LiteralPath "$tmp\release\conpty\conpty.dll" -PathType Leaf)) {
      herdr_core_fail 'the download holds no complete herdr-core'
    }
    $said = ''
    try { $said = [string](& $new --version) } catch {}
    if ($said -cne "hc $version") { herdr_core_fail 'the downloaded herdr-core does not run on this computer' }
    # Another installer may have finished meanwhile: never replace its core.
    $existing = herdr_core_find
    if ($existing) {
      herdr_core_say "herdr-core appeared at $existing during the download; leaving it unchanged."
      return
    }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $exe = Join-Path $dir 'herdr-core.exe'
    Copy-Item -Recurse -Force -LiteralPath "$tmp\release\conpty" -Destination $dir
    if (Test-Path -LiteralPath "$tmp\release\THIRD-PARTY-NOTICES") {
      Copy-Item -Recurse -Force -LiteralPath "$tmp\release\THIRD-PARTY-NOTICES" -Destination $dir
    }
    $staged = Join-Path $dir ('.herdr-core.new.' + [Guid]::NewGuid().ToString('N') + '.exe')
    Copy-Item -LiteralPath $new -Destination $staged
    # File.Move fails if anything took the name: never replaces a core.
    try { [IO.File]::Move($staged, $exe) } catch {
      herdr_core_fail "$exe appeared during installation; leaving it unchanged"
    }
    $staged = $null
    if (-not (Get-Command hc -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath (Join-Path $dir 'hc.exe'))) {
      New-Item -ItemType HardLink -Path (Join-Path $dir 'hc.exe') -Target $exe | Out-Null
    }
    # The raw user PATH, so %VARIABLES% in it stay unexpanded and keep their type.
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    try {
      $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $listed = $raw -split ';' | Where-Object { $_.Trim().TrimEnd('\') -ieq $dir.TrimEnd('\') }
      if (-not $listed) {
        $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        $key.SetValue('Path', $(if ($raw) { "$($raw.TrimEnd(';'));$dir" } else { $dir }), $kind)
        # Setting any user variable tells running programs the environment changed.
        [Environment]::SetEnvironmentVariable('HC_INSTALLING', '1', 'User')
        [Environment]::SetEnvironmentVariable('HC_INSTALLING', $null, 'User')
        herdr_core_say "Added $dir to your PATH: new terminals have hc."
      }
    } finally { $key.Close() }
    herdr_core_say "Installed herdr-core $version into $exe."
  } finally {
    if ($staged) { Remove-Item -Force -LiteralPath $staged -ErrorAction SilentlyContinue }
    Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  }
}

# Starts core at each login: a shortcut in this user's Startup folder that runs
# `herdr-core server start` with HC_SESSION, in a hidden window. No admin is
# needed. Rewrites only a shortcut World wrote; a session other than `default`
# gets its own shortcut.
function herdr_core_enable_login($core, $session) {
  $marker = 'Generated by Herdr World: starts herdr-core at login.'
  if (-not $session) { $session = 'default' }
  if ($session -cnotmatch '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$') { herdr_core_fail "invalid herdr-core session: $session" }
  $suffix = if ($session -ceq 'default') { '' } else { "-$session" }
  if (-not [IO.Path]::IsPathRooted($core)) { herdr_core_fail "herdr-core's path must be absolute" }
  # Any valid path (apostrophes, accents, other scripts): PowerShell's own
  # single-quote escaping (it also doubles the typographic quotes it accepts),
  # then the whole command as UTF-16LE Base64, so the shortcut holds only ASCII.
  $quoted = [Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($core)
  $command = "`$env:HC_SESSION='$session'; & '$quoted' server start"
  $arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  # A shortcut's arguments hold at most 1023 characters: room for a path of
  # about 250 characters or more, depending on the session name.
  if ($arguments.Length -gt 1023) {
    herdr_core_say 'Not starting herdr-core at login: its path is too long for a Startup shortcut.'
    return
  }
  $startup = [Environment]::GetFolderPath('Startup')
  if (-not $startup) {
    herdr_core_say 'Not starting herdr-core at login: this account has no Startup folder.'
    return
  }
  $file = Join-Path $startup "Herdr World herdr-core$suffix.lnk"
  $shell = New-Object -ComObject WScript.Shell
  if (Test-Path -LiteralPath $file) {
    if ($shell.CreateShortcut($file).Description -cne $marker) {
      herdr_core_say "Leaving $file unchanged: Herdr World did not write it."
      return
    }
  }
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $link = $shell.CreateShortcut($file)
  $link.TargetPath = $powershell
  $link.Arguments = $arguments
  $link.WorkingDirectory = Split-Path -Parent $core
  $link.WindowStyle = 7
  $link.Description = $marker
  $link.Save()
  herdr_core_say "herdr-core will start at login (Startup folder shortcut $file)."
}

# Installs core when missing, starts it at login and starts it now.
# $requested: an exact version, or empty for the newest; $session: the core
# session (default `default`), so a saved connection's session is the one started.
function herdr_core_setup($requested, $session) {
  if (-not $session) { $session = 'default' }
  if ($session -cnotmatch '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$') { herdr_core_fail "invalid herdr-core session: $session" }
  herdr_core_install $requested
  $core = herdr_core_find
  if (-not $core) { herdr_core_fail 'herdr-core is missing after installation' }
  herdr_core_enable_login $core $session
  herdr_core_say 'Starting herdr-core...'
  $env:HC_SESSION = $session
  # Its own hidden window, so the core it leaves running holds none of this
  # script's output handles.
  $started = Start-Process -FilePath $core -ArgumentList 'server', 'start' -WindowStyle Hidden -PassThru
  $null = $started.Handle
  $started.WaitForExit()
  if ($started.ExitCode -ne 0) { herdr_core_fail "herdr-core did not start; run ``$core server start`` there to see why" }
  herdr_core_say 'herdr-core is running.'
}
