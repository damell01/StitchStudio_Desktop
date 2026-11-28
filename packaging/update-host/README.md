# Private Stitch Studio updates on Hostinger

## Quick setup (one script)

From the repo root in PowerShell on your PC, with Node.js, Git and the GitHub CLI installed (`gh auth login` once):

```powershell
powershell -ExecutionPolicy Bypass -File packaging\update-host\setup-release-keys.ps1
```

It creates the release keys in `%LOCALAPPDATA%\StitchStudioRelease`, makes a Hostinger deployment SSH key and copies it to your clipboard for hPanel, checks the SSH connection, finds the private feed folder, saves every GitHub secret and variable listed below, and can tag the first release. Back up that folder afterwards. The manual steps below do the same thing by hand.

The Windows and macOS installers are needed once. Install a feed-enabled release, open **Settings → App updates**, and save your update access key. Stitch Studio stores it in Windows Credential Manager or macOS Keychain. The app checks periodically and asks before installing an update or closing your work.

## Connect the Hostinger account

The PHP endpoint is in the [production website repository](https://github.com/damell01/DBELLCREATIONS_PRODSITE/tree/main/stitch-updates). The live route returns **503** until the private access-key hash is configured, **401** without a key once configured, and **204** with a valid key until a release is published. The release workflow can create the missing private folder and hash on the first automatic publish.

In hPanel, enable SSH, authorize a deployment public key, and record the SSH username, hostname, port and verified server host key. In File Manager, locate the domain folder that contains `public_html`. For `HOSTINGER_FEED_DIR`, use the absolute path to that domain folder followed by `/stitch-studio-private/feed`. Configure the GitHub values below. The publishing script creates the private feed and the two public endpoint files when needed. It keeps any existing site files and checks the feed before publishing a release.

## Set up Hostinger with File Manager

1. In hPanel File Manager, open the domain directory that contains `public_html`. Create `stitch-studio-private` beside `public_html`. Inside it create a `feed` folder. Keep the private folder outside the document root of every domain.
2. Create `public_html/stitch-updates`. Upload `index.php` and `.htaccess` from this directory. Enable hidden files in File Manager so you can see `.htaccess`.
3. Generate or locate the access key using the steps below. Upload only `access-key.sha256` to `stitch-studio-private`. Give the 64-character access key only to the people allowed to install updates. Keep it out of source control and URLs.
4. Open `https://www.dbellcreations.com/stitch-updates/latest.json` without credentials. It must return **401**. Use the `www` address directly so the app never sends its access key across a redirect.

To verify your access key from PowerShell, read it directly from your private release folder. A **204** confirms the endpoint accepts the key and is waiting for its first release. A **200** means it serves a manifest. A **503** means the server cannot read the access-key hash or the hash is invalid. A **401** with the key means the header or key did not match.

```powershell
$stitchRelease = Join-Path $env:LOCALAPPDATA 'StitchStudioRelease'
$feedUrl = 'https://www.dbellcreations.com/stitch-updates/latest.json'
$feedKey = (Get-Content (Join-Path $stitchRelease 'update-access.key') -Raw).Trim()
try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $feedUrl -MaximumRedirection 0 -Headers @{Authorization = "Bearer $feedKey"}
    $response.StatusCode
} finally {
    Remove-Variable feedKey
}
```

## Generate or locate the keys on Windows

Run this from the Stitch Studio repo in PowerShell. If you already have signing keys for an installed feed-enabled build, reuse that key pair and password. Keep the files in your private release folder and back them up before publishing.

```powershell
$stitchRelease = Join-Path $env:LOCALAPPDATA 'StitchStudioRelease'
New-Item -ItemType Directory -Force $stitchRelease | Out-Null
node -e "const c=require('node:crypto'),f=require('node:fs'),p=require('node:path');const d=process.argv[1];const key=c.randomBytes(32).toString('hex');f.writeFileSync(p.join(d,'update-access.key'),key,{flag:'wx'});f.writeFileSync(p.join(d,'access-key.sha256'),c.createHash('sha256').update(key).digest('hex'),{flag:'wx'});f.writeFileSync(p.join(d,'artifact.key'),c.randomBytes(32).toString('hex'),{flag:'wx'})" $stitchRelease
cd desktop-ui
npm.cmd ci
npm.cmd run tauri signer generate -- --write-keys (Join-Path $stitchRelease 'update-signing.key')
```

If you plan to publish automatically and need a new deployment key, run `ssh-keygen -t ed25519 -C stitch-studio-deploy -f (Join-Path $stitchRelease 'hostinger-deploy')`. Use a dedicated deployment key for this workflow. Authorize `hostinger-deploy.pub` in hPanel. The deployment job needs a key it can open without an interactive passphrase. Get the verified server host key from Hostinger and save the corresponding OpenSSH known-hosts entry as `hostinger-known-hosts`. For a custom SSH port, the host field in that entry uses `[hostname]:port`.

The three release keys have different jobs. `update-signing.key` signs releases. `artifact.key` encrypts the packages built by GitHub. `update-access.key` grants access to the Hostinger downloads. Back them up privately. Keep the same signing key and URL for later releases so existing installations can update.

## Configure GitHub once

Open **Settings → Secrets and variables → Actions** in **StitchStudio_Desktop**. Use **New repository secret** for each secret and the **Variables** tab for each variable. Paste file contents into the matching value field. GitHub stores secret values write-only. [Actions settings](https://github.com/damell01/StitchStudio_Desktop/settings/secrets/actions)

| Type | Name | Value |
| --- | --- | --- |
| Variable | `STITCH_UPDATE_PUBLIC_KEY` | Contents of `update-signing.key.pub` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Contents of `update-signing.key` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used to create the signing key |
| Secret | `STITCH_ARTIFACT_KEY` | Contents of `artifact.key` |
| Secret | `STITCH_FEED_ACCESS_KEY` | Contents of `update-access.key`, a single 64-character line |
| Secret | `HOSTINGER_SSH_KEY` | Contents of `hostinger-deploy`, including the private-key header and footer |
| Secret | `HOSTINGER_KNOWN_HOSTS` | Contents of `hostinger-known-hosts` |
| Variable | `HOSTINGER_UPDATE_DEPLOY` | `1` to publish automatically |
| Variable | `HOSTINGER_SSH_HOST` | Hostinger SSH username and hostname as `user@hostname` |
| Variable | `HOSTINGER_SSH_PORT` | SSH port shown in hPanel |
| Variable | `HOSTINGER_FEED_DIR` | Absolute domain directory followed by `/stitch-studio-private/feed` |

For the manual File Manager route, enter the first four values for signing and leave deployment disabled. Use the remaining values when you want GitHub to publish to Hostinger automatically.


The workflow defaults to the dbellcreations.com address. For another hostname, override `STITCH_UPDATE_FEED` and `STITCH_UPDATE_ASSETS`, with the latter ending in a slash. Both must use the same HTTPS origin. Apple's Developer ID and notarization are separate from updater signing. Configure the Apple certificate and notarization credentials named in the workflow to distribute Mac builds without the unsigned-app prompt.

## Build and publish a release

Choose a new version higher than every installed build using this feed. Keep the same updater public key in every build.

You can provision Hostinger and save the GitHub settings before releasing. Publish from a Dev revision that passes **Desktop production checks**. The signed release uses those checks before publishing its packages to Hostinger.

From the repo root in PowerShell, tag the current `Dev` commit with a new release version. This starts the workflow from `Dev` even when GitHub's **Run workflow** button is unavailable.

```powershell
git switch Dev
git pull --ff-only origin Dev
git tag -a stitch-update-v0.1.1 -m "Stitch Studio 0.1.1"
git push origin stitch-update-v0.1.1
```

The workflow builds Windows, Apple silicon, and Intel Mac packages. Download the resulting **stitch-studio-update-feed** artifact and extract its ZIP to `Desktop\encrypted-feed`. Decrypt from the repo root.

```powershell
$stitchRelease = Join-Path $env:LOCALAPPDATA 'StitchStudioRelease'
$env:STITCH_ARTIFACT_KEY = (Get-Content (Join-Path $stitchRelease 'artifact.key') -Raw).Trim()
node .github/scripts/crypt-desktop-release.mjs decrypt "$env:USERPROFILE\Desktop\encrypted-feed" (Join-Path $stitchRelease 'feed-0.1.1')
Remove-Item Env:STITCH_ARTIFACT_KEY
```

Using hPanel, upload the version directory to `stitch-studio-private/feed`. Upload `latest.json` **after** every payload is in place. Reuse the `latest.json` address for every release and give each release a higher version. Keep the version directories immutable. For the first manual install, the three initial installers are inside the platform directories. Windows uses the `.exe`, and Macs use the architecture-specific `.dmg`.

With automatic publishing set up, the workflow checks the endpoint, uploads to private staging, publishes the payloads, and switches the live manifest. The first installer comes from the workflow artifact or the private feed. Once installed and paired, use **Settings → App updates** for later versions.

## Publish from your terminal

Run this from the repo root in Git Bash on Windows or in Terminal on Mac. Collect the three signed platform outputs for the same version in `signed-artifacts/`. Each platform build produces its payload, manifest and, on macOS, its DMG. Download encrypted artifacts from GitHub or build locally on each supported OS with the same signing key. Local packaging is covered in the [desktop guide](../../docs/DESKTOP.md#signed-automatic-updates).

```bash
export STITCH_UPDATE_ASSETS='https://www.dbellcreations.com/stitch-updates/'
export STITCH_UPDATE_FEED="${STITCH_UPDATE_ASSETS}latest.json"
node .github/scripts/stage-desktop-release.mjs 0.1.1 signed-artifacts update-feed
```

Load `HOSTINGER_SSH_HOST`, `HOSTINGER_SSH_PORT`, `HOSTINGER_FEED_DIR`, `HOSTINGER_SSH_KEY`, `HOSTINGER_KNOWN_HOSTS` and `STITCH_FEED_ACCESS_KEY` into your local shell from your deployment configuration. Use the contents of the private files for the final three values. Then run:

```bash
bash .github/scripts/deploy-hostinger-update.sh 0.1.1 update-feed
```

This runs the same checks and atomic publish as GitHub Actions. For endpoint setup by itself, run `bash .github/scripts/setup-hostinger-update.sh`. Verify the unauthenticated URL returns **401** before publishing.

Before adopting the updater, install an initial build on each supported OS, pair it with the access key, then publish a higher version. Verify that each device detects the new version, installs it, relaunches, and opens the same saved project.
