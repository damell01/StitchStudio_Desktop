# Stitch Studio Desktop commercial release plan

The current source distribution retains Apache-2.0 and upstream attribution. Paid services or separately licensed original components must not revoke rights already granted under Apache-2.0. Audit third-party notices and modified-file notices before distribution.

## Versioning
Use Cargo package version as the source of truth. Stable tags must match vMAJOR.MINOR.PATCH. Build and test Windows, macOS Intel/Apple Silicon and Linux where supported before publishing. Include platform, architecture, SHA-256 checksums, release notes and applicable notices. Never publish signing keys.

## Updates
Use only the official repository release channel. Automatic checks should be opt-out, asynchronous, time-limited and compare semantic versions. Ignore drafts and prereleases on stable. Never replace binaries from an unsigned manifest. Sign update metadata with an offline-held signing key and verify against a bundled public key; verify artifact hash and platform signature before offering installation. Preserve user documents, support rollback and require consent before restarting. Until signing and installation are implemented, direct users to official release pages.

## Commercial entitlements
Suggested plans: trial, monthly, annual, lifetime. Pricing and trial limits are not yet approved. Use a server-side payment webhook to issue entitlements, not a client-reported payment status. Store signing secrets on the server only. Signed entitlement payloads should include product, license ID, plan, issued-at, expiry (if applicable), and key ID. Verify locally with a bundled public key. Keep an offline grace period for subscriptions, and do not delete or block access to existing designs on expiry. Lifetime entitlements have no subscription expiry; define update eligibility explicitly. Device activation, revocation, account recovery and refund policy require a backend and customer-facing terms. Never treat an editable local JSON flag as proof of purchase.

## Release gate
Run Rust formatting, core tests, GUI compilation and platform package smoke tests. Test upgrade from prior release and offline behavior. No commercial activation or unattended binary installation is enabled by this document.
