# Private Stitch Studio updates on Hostinger

The Windows and macOS installers are needed once. Install a feed-enabled release, open **Settings → App updates**, and save your update access key. Stitch Studio stores it in Windows Credential Manager or macOS Keychain. The app checks periodically and asks before installing an update or closing your work.

## Connect the Hostinger account

Use the existing production domain at `www.dbellcreations.com`. The GitHub release workflow can install the endpoint directly over SSH on the first publish. Your website repo and normal website deployment can continue handling the rest of the site.

In hPanel, enable SSH, authorize a deployment public key, and record the SSH username, hostname, port and verified server host key. In File Manager, locate the domain folder that contains `public_html`. For `HOSTINGER_FEED_DIR`, use the absolute path to that domain folder followed by `/stitch-studio-private/feed`. Configure the GitHub values below. The publishing script creates the private feed and the two public endpoint files when needed. It keeps any existing site files and checks the feed before publishing a release.

## Set up Hostinger with File Manager

1. In hPanel File Manager, open the domain directory that contains `public_html`. Create `stitch-studio-private` beside `public_html`. Inside it create a `feed` folder. Keep the private folder outside the document root of every domain.
2. Create `public_html/stitch-updates`. Upload `index.php` and `.htaccess` from this directory. Enable hidden files in File Manager so you can see `.htaccess`.
3. Generate the access key on Windows using the PowerShell commands below. Upload only `access-key.sha256` to `stitch-studio-private`. Give the 64-character access key only to the people allowed to install updates. Keep it out of source control and URLs.
4. Open `https://www.dbellcreations.com/stitch-updates/latest.json` without credentials. It must return **401**. An authenticated request returns **204** until the first release is uploaded. Use the `www` address directly so the app never sends its access key across a redirect.

```powershell
$stitchRelease = Join-Path $env:LOCALAPPDATA 'StitchStudioRelease'
New-Item -ItemType Directory -Force $stitchRelease | Out-Null
node -e "const c=require('node:crypto'),f=require('node:fs'),p=require('node:path');const d=process.argv[1];const key=c.randomBytes(32).toString('hex');f.writeFileSync(p.join(d,'update-access.key'),key,{flag:'wx'});f.writeFileSync(p.join(d,'access-key.sha256'),c.createHash('sha256').update(key).digest('hex'),{flag:'wx'});f.writeFileSync(p.join(d,'artifact.key'),c.randomBytes(32).toString('hex'),{flag:'wx'})" $stitchRelease
cd desktop-ui
npm.cmd ci
npm.cmd run tauri signer generate -- --write-keys (Join-Path $stitchRelease 'update-signing.key')
```

The three keys have different jobs. `update-signing.key` signs releases. `artifact.key` encrypts the packages built by GitHub. `update-access.key` grants access to the Hostinger downloads. Back them up privately. Keep the same signing key and URL for later releases so existing installations can update.

## Configure GitHub once

In **Settings → Secrets and variables → Actions**, add the following. An authenticated repository administrator must set these values.

| Type | Name | Value |
| --- | --- | --- |
| Variable | `STITCH_UPDATE_PUBLIC_KEY` | Contents of `update-signing.key.pub` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | Contents of `update-signing.key` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used to create the signing key |
| Secret | `STITCH_ARTIFACT_KEY` | Contents of `artifact.key` |

The workflow defaults to the dbellcreations.com address. For another hostname, override `STITCH_UPDATE_FEED` and `STITCH_UPDATE_ASSETS`, with the latter ending in a slash. Both must use the same HTTPS origin. Apple's Developer ID and notarization are separate from updater signing. Configure the Apple certificate and notarization credentials named in the workflow to distribute Mac builds without the unsigned-app prompt.

## Build and publish a release

Choose a new version higher than every installed build using this feed. Keep the same updater public key in every build.

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

For automatic publishing, enable SSH in hPanel and add an authorized deployment public key. Set Actions variables `HOSTINGER_UPDATE_DEPLOY=1`, `HOSTINGER_SSH_HOST` (SSH user and host), `HOSTINGER_SSH_PORT`, and `HOSTINGER_FEED_DIR` (absolute path to `stitch-studio-private/feed`). Add secrets `HOSTINGER_SSH_KEY` (deployment private key), `HOSTINGER_KNOWN_HOSTS` (verified Hostinger SSH host key), and `STITCH_FEED_ACCESS_KEY` (contents of `update-access.key`). The release job checks that the feed requires authorization, uploads to a private staging folder, publishes the packages first, and then makes the new manifest live. No public release is created.

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
