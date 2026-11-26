# Private Stitch Studio updates on Hostinger

The Windows and macOS installers are needed once. Install a feed-enabled release, open **Settings → App updates**, and save your update access key. Stitch Studio stores it in Windows Credential Manager or macOS Keychain. The app checks periodically and asks before installing an update or closing your work.

## Set up Hostinger once

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

Before adopting the updater, install an initial build on each supported OS, pair it with the access key, then publish a higher version. Verify that each device detects the new version, installs it, relaunches, and opens the same saved project.
