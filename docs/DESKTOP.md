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

## First design

1. From Home, choose **Digitize artwork**. Select or drop a raster image, SVG, or PDF. For a multipage PDF, choose the page before tracing.
2. Review the stitch paths alongside the source. For raster artwork, use **Processed** to inspect the cleanup result. **Density** shows up to 512 one-square-millimeter cells with the highest needle penetration counts in the DST stream.
3. Adjust fabric or open **Advanced artwork options**. The draft updates automatically after a short pause. Choose **Open in design studio** to apply it.
4. Set the machine's verified embroidery field and preferred format in **Machine Manager**. Select the intended hoop in the editor. Hoops measure the usable sewing field.
5. Use the canvas zoom and pan to inspect stitches. In Select mode, click or drag an editable object. Use **Insert design** to preview and place templates or saved designs. Use the design transformation controls to change physical dimensions or placement. Save an editable `.stitchstudio` project before exporting.
6. Review the machine format, dimensions and thread sequence, then save the machine file. Keep a separate project file for edits. Use the [sew-out worksheet](SEW_OUT.md) for the first machine test.

## Browse and reuse designs

- **Template Library** includes built-in bow, sports, botanical, animal, monogram and patch artwork. Filter by category, favorites or recent designs. Licensed character and seasonal templates carry source credits in the preview. **Preview design** generates a stitch preview before you open the template.
- **Design Library** imports compatible embroidery files or scans a folder for editable Stitch Studio projects. Search for a machine file and choose **Insert design** to add its stitch paths to the workspace.
- Choose disk files or a folder that you have permission to use. Keep original machine files for reference. Imported needle paths stay as manual stitches and editable artwork remains in the project. Use **Import ZIP** to add supported machine files from a single-volume archive.
- In the editor, open **Workspace options** to adjust the Layers and Inspector widths. The workspace remembers both widths. Use the top toolbar to toggle either panel. Press **F11** or choose **Focus canvas** to enter full-screen editing. Press **Esc** to return. In the Inspector, choose **Hoop**, **Stitches**, or **Size** for the task at hand.

## Find commands and fonts

Press **Ctrl+K** or **Cmd+K** to search pages and available editing actions. Type part of a name, then press **Enter** to run the first result. Font Manager and the lettering font picker show short pages of results. Where a name includes inches, centimeters, or millimeters, versions in the same family are sorted by physical size. Font Manager also filters by format and favorites. Template, project, character, profile, and thread lists use the same page controls.

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
