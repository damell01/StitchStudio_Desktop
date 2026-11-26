# Stitch Studio Desktop

Run the React and Tauri application from `desktop-ui`. The root Rust package also contains the legacy ZigZag editor and the shared embroidery engine.

## Windows development and packaging

Use the VS Code PowerShell terminal in your existing checkout. The desktop build uses the MSVC toolchain, Windows SDK, WebView2, and Node.js 22 or newer. Rust 1.95 or newer is required by the engine.

```powershell
git switch Dev
git pull --ff-only origin Dev
cd desktop-ui
npm.cmd ci
npm.cmd run tauri dev
```

Press Ctrl+C to stop the development app. From the same directory, build and locate the installer.

```powershell
npm.cmd run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm.cmd run tauri build -- --bundles nsis -- --locked
Get-ChildItem .\src-tauri\target\release\bundle\nsis\*.exe
```

Run the resulting setup executable to install the app. Use Windows **Installed apps** to uninstall. To run the release executable before installing, use `& .\src-tauri\target\release\stitch-studio-desktop.exe`. The local installer is unsigned unless you configure a Windows signing identity. Build dependencies can require network access. The installed app processes designs locally.

## Design and editing shortcuts

- **Maximize in hoop** and **Fill hoop** regenerate stitches when size changes. When only placement needs to change, they move the existing stitch plan as a unit.
- For a dense logo, compare **Balanced** and **Maximum** first. Maximum tries up to two additional passes on eligible fills and checks each result against the original design. Choose **Deep optimization** in the digitizer or Simplify dialog to inspect **Fast Stitch** and **Solid silhouette** when available. Fast Stitch can use longer penetrations and wider spacing in broad fills. Solid silhouette can change decorative shading. Review stitch count, trims, and footprint before applying an option.
- To simplify a bow or other ornament, choose **Solid area** in the canvas toolbar, choose **Box** or **Oval**, then drag around it. The tool uses whole editable objects enclosed by the outline. Change the fill thread color and compare stitches, trims, and estimated sewing time before applying. You can also select objects and choose **Make selection solid**.
- Choose **Insert design** or press Ctrl+I on Windows or Cmd+I on macOS to add to the current workspace. Machine import accepts DST, PES, PEC, EXP, JEF and VP3. Save as `.stitchstudio` to keep editable geometry and layer properties.
- Open **Layers** or **Inspector** from the editor toolbar. Smaller windows open one panel at a time. Press F11 for focus view. Drag the camera toolbar grip up or down to dock it above or below the canvas.
- Select an object. Choose **Edit artwork nodes** or **Edit stitch points** to move, add, or erase individual points. Applying changes creates one undo step.
- Open **Garment mockup** to choose clothing, fabric color and placement. Choose **Save mockup PNG** to save the flat preview or the current 3D hoodie view.

## Offline design assistant

Open **Design assistant** from the editor toolbar. Pick a quick action or describe one edit in your own words. For example:

- “Could you replace all black thread with navy blue?”
- “Fit my design in my 8 × 9 hoop.”
- “Make this design take less than 15 minutes.”
- “Simplify the bow into a solid shape.” The assistant matches named layers in the current design.

The proposal shows what the action will change. Simplification shows the existing and proposed stitch paths, point counts, trims, and estimated sewing times. Use **Apply change** to run the native edit, or **Skip** to keep the design as it is. Named thread colors map to exact RGB values. Confirm dimensions against your machine's usable sewing field. The timing estimate uses your saved machine speed and trim settings.

## macOS development and packaging

Use macOS with Xcode Command Line Tools, Node.js 22 or newer, and Rust 1.95 or newer.

```sh
git switch Dev
git pull --ff-only origin Dev
cd desktop-ui
npm ci
npm run tauri dev
```

After stopping the development process, package it with:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app dmg -- --locked
open "src-tauri/target/release/bundle/macos/Stitch Studio.app"
ls src-tauri/target/release/bundle/dmg/
```

For installation, open the DMG and copy the app into Applications. Local packaging targets the build machine’s architecture. Distribution outside your machine needs a Developer ID signing identity and Apple notarization. See [Tauri signing and notarization](https://v2.tauri.app/distribute/sign/macos/).

## Download a Mac or Windows installer

Open **Desktop production checks** and select a completed run on **Dev**. Download the Mac or Windows artifact. The Mac download contains a `.dmg` and a ZIP with the `.app`. Open the DMG on your Mac and move Stitch Studio to Applications. Check the filename for `aarch64` (Apple silicon) or `x64` (Intel). Windows uses the NSIS setup `.exe`. Standard builds are unsigned. [Desktop production checks](https://github.com/damell01/StitchStudio_Desktop/actions/workflows/desktop-production-checks.yml)

## Signed automatic updates

Install a feed-enabled build once. It checks after startup and periodically while open. Save open projects before choosing **Settings → App updates → Install and restart**. Future releases install from that screen. A regular local or CI build uses manual updates. The embroidery tools remain available offline.

Set `STITCH_UPDATE_FEED` to the HTTPS `latest.json` URL and `STITCH_UPDATE_ASSETS` to its HTTPS payload directory URL, ending in `/`. From `desktop-ui`, generate one updater key pair with `npm run tauri signer generate -- --write-keys /path/outside/repo/stitch-update.key`. Keep the private key and password outside the repository and use the same key pair on both build machines.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = 'C:\secure\stitch-update.key'
$env:STITCH_UPDATE_PUBLIC_KEY = (Get-Content 'C:\secure\stitch-update.key.pub' -Raw).Trim()
npm.cmd run package:update -- 0.1.1
```

```sh
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.stitch-studio/stitch-update.key"
export STITCH_UPDATE_PUBLIC_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY.pub")"
npm run package:update -- 0.1.1
```

Set `STITCH_UPDATE_REQUIRE_KEY=1` for the Hostinger feed, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for an encrypted signing key. Configure Developer ID signing and notarization for Mac distribution. The release directory under `src-tauri/target/release/bundle/updates` contains the signed updater packages and the installer files. See the Hostinger guide for creating one feed and publishing it.

You can build Windows, Apple silicon and Intel Mac versions from GitHub while using Windows. The workflow encrypts signed update artifacts and can deploy them to the private Hostinger feed. [Hostinger setup and release instructions](../packaging/update-host/README.md)

## Offline lettering recognition

The React/Tauri digitizer includes OCRS and RTen with embedded model weights. On the first build, Cargo uses curl to obtain approximately 12.2 MB of checksum-pinned model data; subsequent builds reuse cached weights. For an air-gapped build, set `STITCHSTUDIO_OCR_MODELS` to a folder containing the two verified `.rten` files. The installed application does not download anything or require Tesseract, Python, a GPU, or a cloud account.

After pulling the OCR dependency changes, run `cargo check --manifest-path src-tauri/Cargo.toml` from `desktop-ui` without `--locked` once to refresh the Cargo lockfile, then launch the normal Tauri dev command. The root legacy editor lockfile also needs refreshing when building it.

Choose raster artwork, click **Recognize lettering**, correct the text or font, select regions to replace, and click **Preview editable lettering**. Compare the generated stitches against the source, then open the design studio. If the traced region is inseparable from other artwork, leave it unchecked. Small or decorative lettering may need manual correction.

Model provenance: Robert Knight's OCRS models, fetched from `https://ocrs-models.s3-accelerate.amazonaws.com/`; pinned digests are in `build.rs`. Review the model redistribution terms before publishing an installer.

## First design

1. From Home, choose **Digitize artwork**. Select or drop a raster image, SVG, or PDF. For a multipage PDF, choose the page before tracing. The digitizer compares checked plans with a default **Stitch-count goal** of 10,000. Change the goal to compare again without retracing. The finished size and artwork determine which counts are achievable.
2. Review the stitch paths alongside the source. For raster artwork, use **Processed** to inspect the cleanup result. **Density** shows up to 512 one-square-millimeter cells with the highest needle penetration counts in the DST stream.
3. Adjust fabric or open **Advanced artwork options**. The draft updates automatically after a short pause. Choose **Open in design studio** to apply it.
4. Set the machine's verified embroidery field and preferred format in **Machine Manager**. Select the intended hoop in the editor. Hoops measure the usable sewing field.
5. Use the canvas zoom and pan to inspect stitches. Layers and Inspector open by default. In Select mode, click or drag an editable object. Use **Move whole design** to drag all objects and stitch paths together. Drag a corner to resize proportionally or a side to adjust one dimension. Use the grip to move the camera controls above or below the design. Use **Insert design** to preview and place templates, saved layouts, or machine designs inside the current workspace. Use the design transformation controls to change physical dimensions or placement. Save an editable `.stitchstudio` project before exporting.
6. Use **Thread order** to match numbered color blocks to the spools or needles you assign on the machine. Use the numbered thread cards and format buttons in Export Review to check the machine format, dimensions and thread sequence, then save the machine file. Keep a separate project file for edits. Use the [sew-out worksheet](SEW_OUT.md) for the first machine test.

## Preview placement on a garment

Open a design and choose the shirt icon in the editor toolbar. Choose a T-shirt, hoodie, cap, or shorts. Pick toddler, kids, or adult sizing and select a placement. The preset anchor follows the current design position relative to the hoop center. Use the offsets and fabric color to compare placements. With Hoodie selected, drag the 3D preview or use the rotation slider. **Flat view** is available in the same preview. The mockup uses the current stitch paths and an approximate garment scale. It leaves the project and exports as they were.

## Browse and reuse designs

- **Template Library** includes built-in bow, sports, botanical, animal, monogram and patch artwork. Filter by category, favorites or recent designs. Licensed character and seasonal templates carry source credits in the preview. **Preview design** generates a stitch preview before you open the template.
- **Design Library** includes 19 original machine-readable DST designs with matching thread colors in the app. It also imports compatible embroidery files or scans a folder for editable Stitch Studio projects. Search for a machine file and choose **Insert design** to add its stitch paths to the workspace.
- Choose disk files or a folder that you have permission to use. Keep original machine files for reference. Imported needle paths stay as manual stitches and editable artwork remains in the project. Use **Design Library → Import ZIP** to add DST, PES, PEC, EXP, or JEF files, including files in nested folders. To reuse a full, editable layout, save it as a .stitchstudio project and include it in a ZIP. Open **Template Library → My editable templates → Import template ZIP**, preview the layout, and choose **Use as new design**. Save the new design under its own filename.
- In the editor, open **Workspace options** to adjust the Layers and Inspector widths. The workspace remembers both widths. Use the top toolbar to toggle either panel. Press **F11** or choose **Focus canvas** to enter full-screen editing. Press **Esc** to return. In the Inspector, choose **Hoop**, **Stitches**, or **Size** for the task at hand.

## Find commands and fonts

Press **Ctrl+K** or **Cmd+K** to search pages and available editing actions. Type part of a name, then press **Enter** to run the first result. Font Manager and the lettering font picker show short pages of results. Where a name includes inches, centimeters, or millimeters, versions in the same family are sorted by physical size. Font Manager also filters by format and favorites. Template, project, character, profile, and thread lists use the same page controls.

## Design assistant

Windows x64 and macOS installers package a CPU-based Qwen 0.5B model and its llama.cpp runtime. The assistant uses built-in commands for familiar phrases and runs the bundled model automatically for unfamiliar wording. The model translates the request into a supported editor command on the computer. Design changes still go through the existing review and apply flow. Use **Settings → Design assistant** to turn off model interpretation.

To decorate an existing design, select an object and try “Add lavender bows on both sides of the selection” or “Add a 1-inch heart below the design as appliqué.” For a blank hoop, try “Add a small bow at the hoop center.” The proposal compares the original and generated stitch plans. Apply the change to keep each motif editable, or undo the insertion in one step. Imported character artwork can be added by its library name after importing it in **Design Library → Artwork**. Appliqué uses the largest closed area as the fabric piece and keeps the other details as embroidery. Test sew and verify machine pauses before production.

Native packaging downloads and verifies the pinned runtime and model once. The model file adds about 470 MiB before installer compression. Set `STITCH_ASSISTANT_CACHE` to a directory containing the same verified files to build from a local cache. Development builds can use the editor's built-in commands without downloading the model.

To use Codex CLI or Claude Code, choose **Settings → Design assistant → Start agent connection**, select the client, and copy its setup command. Run that command on the computer running Stitch Studio. The optional connection is available over MCP on loopback and shares a limited design summary. An external agent can queue one edit, which appears under **Review agent edit** in the Studio assistant. The connection address changes after the app or connection restarts. Remove a stale client entry before registering the new address if your client requires it.

## Developer checks

From the repository root:

```sh
cargo test --locked
cargo run --locked --example digitizing_benchmark
```

From `desktop-ui`:

```sh
npm ci
npm run build
npx playwright install chromium
npm test
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

On Linux, native Tauri checks need the WebKitGTK 4.1 and GTK development packages. Browser tests replace the Tauri command transport with a test implementation and exercise the React workflow. The engine tests and native Tauri tests verify the Rust side independently.

The native bridge is in `desktop-ui/src-tauri/src/main.rs`. It maintains saved artwork, the current design, undo history and an uncommitted digitizing draft. `src/trace.rs` prepares raster artwork. `src/document` handles editable SVG and hoop transforms. `src/design.rs` generates stitch plans and `src/formats` encodes machine commands. Engine geometry uses tenths of a millimeter. The SVG viewport is independent of these coordinates.

Bundled files include the repository license and upstream notices. For manual updates, install a later build of the same app identity after backing up project files.
