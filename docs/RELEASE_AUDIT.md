# Desktop release audit

This checklist applies to the React and Tauri release. Record the packaged revision, installer hash, platform and version, and evidence for each run. Browser tests use mocked native IPC and cover the browser-side interaction path. Compilation, binary generation, and physical execution each have separate evidence.

## Release candidate evidence

| Check | Evidence to collect |
| --- | --- |
| Build and package | Successful Windows and macOS jobs, exact commit, installer artifact, and SHA-256. The Tauri production workflow creates NSIS and macOS packages. The repository's Windows release workflow packages the separate legacy ZigZag desktop target. [Desktop production checks](../.github/workflows/desktop-production-checks.yml) · [Windows release workflow](../.github/workflows/windows-release.yml) |
| Sign and verify | Verify the certificate and timestamps on the delivered files. For macOS distribution outside the App Store, verify Developer ID signing and notarization. The bundled artifacts from a successful build still require a signing verification. [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/) · [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/) |
| Install and launch | Install from the packaged artifact on a clean supported system. Verify startup, expected app name and icons, shortcut behavior, clean relaunch, project reopening, and a second launch after uninstall and reinstall. |
| Physical qualification | Save the test export hash, machine model and firmware, hoop field and setup, perimeter check, sewn dimensions, front and back photos, and observed trim/stop behavior. [Sew-out worksheet](SEW_OUT.md) |

A source audit at `d6eb2c3` matched 39 distinct frontend literal command names to the Tauri registration list. This check includes literal calls routed through the editor's edit helper. It establishes registration coverage at that revision. Native invocation and platform behavior are tested through the packaged workflow below.

## Packaged smoke walkthrough

Use a fresh application profile, then repeat the project and library checks using a copied profile with existing files.

| Screen or operation | Evidence and pass condition |
| --- | --- |
| Home, menus, and tour | Every available destination opens. New-user onboarding can be completed and dismissed using the keyboard. Ctrl/Cmd+K opens search, Escape dismisses it, and focus returns to the invoking control. |
| Digitizer | Load the shared BMP, transparent PNG, rotated JPEG, and one-page PDF fixtures. Confirm input orientation and size, drag-and-drop and picker parity, honest errors for corrupt input, and an editable draft opening in the studio. |
| Editor | Open the vector motif and insert a separate template. Move the insertion, undo, redo, save, quit, and reopen. Compare artwork and export bounds. Exercise overlay controls at the minimum window size and in full-screen mode. |
| Export | Export a valid hoop-bound design to DST and PES. Inspect decoded motion, bounds, orientation, and color stops. Try an out-of-hoop placement and verify an explanatory failure. Cancel native export and verify that no destination file is created. |
| Projects and recovery | Reopen a known version-1 project. Save to a new path. Verify source geometry remains editable after reopening. On a disposable copy, exercise interrupted writes and recovery with a malformed latest copy. |
| Templates, personal designs, and fonts | Search, page, preview, and insert a built-in template. Add an original supported machine file and verify it is visible after restart. Find a system font by name and create lettering. Check that saved and unavailable BX assets have accurate labels. |
| Specialty and machines | Create a patch and appliqué sample. Inspect bounds, preview, and export path. Confirm machine and hoop profile measurements against the UI and use the exact profile for the sew-out. |
| Appearance and accessibility | Check light and dark appearance, high display scaling, keyboard traversal, readable focus, dialog dismissal, and reduced-motion settings. Record OS, scaling, and screen reader if used. |

Mark each platform result with its revision and date. Use the [implementation tracker](IMPLEMENTATION_TRACKER.md) for feature status. Physical qualification, clean native installs, and proprietary format coverage require their own evidence.
