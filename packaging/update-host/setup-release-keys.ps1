<#
.SYNOPSIS
  One-time setup for signed Stitch Studio releases and automatic updates on Hostinger.

.DESCRIPTION
  Run once, from the StitchStudio_Desktop repo root, in PowerShell on your own PC:

      powershell -ExecutionPolicy Bypass -File packaging\update-host\setup-release-keys.ps1

  It:
    1. creates the release keys in %LOCALAPPDATA%\StitchStudioRelease (reusing any that exist),
    2. creates a Hostinger deployment SSH key and copies its public half to your clipboard,
    3. waits while you paste it into hPanel, then checks the SSH connection and finds the
       private feed folder next to public_html,
    4. saves every GitHub Actions secret and variable the release workflow needs (via gh),
    5. optionally tags a release so GitHub builds, signs and publishes it to Hostinger.

  Private keys never leave this PC except as encrypted GitHub secrets. Back up the
  StitchStudioRelease folder somewhere safe: without update-signing.key and its password,
  installed copies can never be updated again.

  Needs: Node.js, Git, the GitHub CLI (https://cli.github.com, run `gh auth login` once) and
  Windows' built-in OpenSSH client.
#>
param(
  [string]$SshHost,                  # e.g. u123456789@123.45.67.89  (hPanel > Advanced > SSH Access)
  [int]$SshPort = 0,                 # e.g. 65002
  [string]$Domain = 'dbellcreations.com',
  [string]$Repo = 'damell01/StitchStudio_Desktop'
)
$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Magenta }
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd was not found. $hint" } }

# --- Prerequisites -----------------------------------------------------------
Step 'Checking tools'
if (-not (Test-Path 'desktop-ui\package.json')) { throw 'Run this from the StitchStudio_Desktop repo root.' }
Need node 'Install Node.js 22 from https://nodejs.org.'
Need git 'Install Git from https://git-scm.com.'
Need gh 'Install the GitHub CLI from https://cli.github.com, then run: gh auth login'
Need ssh-keygen 'Enable Windows Settings > Optional features > OpenSSH Client.'
Need ssh-keyscan 'Enable Windows Settings > Optional features > OpenSSH Client.'
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Sign in to GitHub first: gh auth login' }

$dir = Join-Path $env:LOCALAPPDATA 'StitchStudioRelease'
New-Item -ItemType Directory -Force $dir | Out-Null
function KeyFile($name) { Join-Path $dir $name }

# --- 1. Release keys ---------------------------------------------------------
Step "Release keys in $dir"
if (-not (Test-Path (KeyFile 'update-access.key'))) {
  node -e "const c=require('node:crypto'),f=require('node:fs'),p=require('node:path');const d=process.argv[1];const key=c.randomBytes(32).toString('hex');f.writeFileSync(p.join(d,'update-access.key'),key,{flag:'wx'});f.writeFileSync(p.join(d,'access-key.sha256'),c.createHash('sha256').update(key).digest('hex'),{flag:'wx'})" $dir
  Write-Host '  created update-access.key (give this to people allowed to install updates)'
} else { Write-Host '  reusing update-access.key' }
if (-not (Test-Path (KeyFile 'artifact.key'))) {
  node -e "require('node:fs').writeFileSync(process.argv[1],require('node:crypto').randomBytes(32).toString('hex'),{flag:'wx'})" (KeyFile 'artifact.key')
  Write-Host '  created artifact.key'
} else { Write-Host '  reusing artifact.key' }
if (-not (Test-Path (KeyFile 'update-signing.key'))) {
  $password = node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))"
  Set-Content -NoNewline -Path (KeyFile 'update-signing.password') -Value $password
  Push-Location desktop-ui
  try {
    if (-not (Test-Path 'node_modules\@tauri-apps\cli')) { npm.cmd ci | Out-Null }
    npm.cmd run tauri -- signer generate --ci -p $password -w (KeyFile 'update-signing.key') | Out-Null
  } finally { Pop-Location }
  if (-not (Test-Path (KeyFile 'update-signing.key.pub'))) { throw 'The update signing key was not created.' }
  Write-Host '  created update-signing.key (+ .pub and .password)'
} else { Write-Host '  reusing update-signing.key' }
if (-not (Test-Path (KeyFile 'update-signing.password'))) {
  throw "update-signing.key exists but update-signing.password does not. Save the key's password in $(KeyFile 'update-signing.password') and run again."
}

# --- 2. Hostinger SSH --------------------------------------------------------
Step 'Hostinger SSH'
if (-not $SshHost) { $SshHost = Read-Host 'SSH login from hPanel > Advanced > SSH Access (looks like u123456789@123.45.67.89)' }
if ($SshPort -le 0) { $SshPort = [int](Read-Host 'SSH port from the same page (often 65002)') }
if ($SshHost -notmatch '^[A-Za-z0-9_-]+@[A-Za-z0-9.-]+$') { throw "That SSH login doesn't look like user@host." }
$sshKey = KeyFile 'hostinger-deploy'
if (-not (Test-Path $sshKey)) {
  # A raw argument string passes the empty passphrase the same way in Windows PowerShell and PowerShell 7.
  Start-Process ssh-keygen -ArgumentList "-q -t ed25519 -N `"`" -C stitch-studio-deploy -f `"$sshKey`"" -NoNewWindow -Wait
  if (-not (Test-Path "$sshKey.pub")) { throw 'The deployment SSH key was not created.' }
}
$public = (Get-Content "$sshKey.pub" -Raw).Trim()
Set-Clipboard -Value $public
Write-Host "`n  The deployment public key is on your clipboard:`n  $public`n"
Write-Host '  In hPanel open Advanced > SSH Access > SSH keys > Add SSH key, paste it and save.'
Read-Host '  Press Enter once the key is added'

$hostName = $SshHost.Split('@')[1]
$known = KeyFile 'hostinger-known-hosts'
ssh-keyscan -p $SshPort -t 'ed25519,rsa,ecdsa' $hostName 2>$null | Set-Content $known
if (-not (Get-Content $known -ErrorAction SilentlyContinue)) { throw "Could not read the server's host key from ${hostName}:$SshPort." }
Write-Host '  Server host key fingerprints (compare with hPanel if it shows them):'
ssh-keygen -lf $known | ForEach-Object { Write-Host "    $_" }

$sshArgs = @('-i', $sshKey, '-p', $SshPort, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$known", $SshHost)
$domainDir = & ssh @sshArgs "cd ~/domains/$Domain 2>/dev/null && test -d public_html && pwd"
if ($domainDir) { $domainDir = "$domainDir".Trim() }
if ($LASTEXITCODE -ne 0 -or -not $domainDir) {
  $found = & ssh @sshArgs 'for d in ~/domains/*/; do [ -d "$d/public_html" ] && (cd "$d" && pwd); done'
  throw "Connected, but ~/domains/$Domain/public_html was not found. Domain folders on the server:`n$found`nRun again with -Domain <name>."
}
$feedDir = "$domainDir/stitch-studio-private/feed"
Write-Host "  SSH works. Private feed folder: $feedDir"

# --- 3. GitHub secrets and variables -------------------------------------------
Step "Saving GitHub Actions secrets and variables on $Repo"
function Secret($name, $value) { $value | gh secret set $name -R $Repo | Out-Null; if ($LASTEXITCODE) { throw "Could not save secret $name" }; Write-Host "  secret   $name" }
function Variable($name, $value) { gh variable set $name -R $Repo --body $value | Out-Null; if ($LASTEXITCODE) { throw "Could not save variable $name" }; Write-Host "  variable $name" }
Variable 'STITCH_UPDATE_PUBLIC_KEY' (Get-Content (KeyFile 'update-signing.key.pub') -Raw).Trim()
Secret   'TAURI_SIGNING_PRIVATE_KEY' (Get-Content (KeyFile 'update-signing.key') -Raw).Trim()
Secret   'TAURI_SIGNING_PRIVATE_KEY_PASSWORD' (Get-Content (KeyFile 'update-signing.password') -Raw).Trim()
Secret   'STITCH_ARTIFACT_KEY' (Get-Content (KeyFile 'artifact.key') -Raw).Trim()
Secret   'STITCH_FEED_ACCESS_KEY' (Get-Content (KeyFile 'update-access.key') -Raw).Trim()
Secret   'HOSTINGER_SSH_KEY' (Get-Content $sshKey -Raw)
Secret   'HOSTINGER_KNOWN_HOSTS' (Get-Content $known -Raw)
Variable 'HOSTINGER_SSH_HOST' $SshHost
Variable 'HOSTINGER_SSH_PORT' "$SshPort"
Variable 'HOSTINGER_FEED_DIR' $feedDir
Variable 'HOSTINGER_UPDATE_DEPLOY' '1'

# --- 4. First release ------------------------------------------------------------
Step 'Done with setup'
Write-Host "  Back up $dir now (a USB drive or password manager). Losing update-signing.key or its password"
Write-Host '  means installed copies can never receive another update.'
$tags = git ls-remote --tags origin 'stitch-update-v*' 2>$null | ForEach-Object { ($_ -split 'stitch-update-v')[1] } | Where-Object { $_ -match '^\d+\.\d+\.\d+$' }
$last = $tags | Sort-Object { [version]$_ } | Select-Object -Last 1
$suggest = if ($last) { $v = [version]$last; "$($v.Major).$($v.Minor).$($v.Build + 1)" } else { '0.1.1' }
$answer = Read-Host "`nTag the current Dev commit as release $suggest now? GitHub will build, sign and publish it. (y/N)"
if ($answer -match '^(y|yes)$') {
  git fetch origin Dev --quiet
  git tag -a "stitch-update-v$suggest" origin/Dev -m "Stitch Studio $suggest"
  git push origin "stitch-update-v$suggest"
  Write-Host "  Release $suggest started: https://github.com/$Repo/actions/workflows/desktop-production-checks.yml"
  Write-Host '  When it finishes, install from the workflow artifact once, then paste the access key from'
  Write-Host "  $(KeyFile 'update-access.key') into Settings > App updates. Later versions install themselves."
} else {
  Write-Host "  Later, run: git tag -a stitch-update-v$suggest origin/Dev -m `"Stitch Studio $suggest`"; git push origin stitch-update-v$suggest"
}
