param([Parameter(Mandatory = $true)][string]$Bundle)
$ErrorActionPreference = 'Stop'
$installers = @(Get-ChildItem (Join-Path $Bundle 'nsis') -Filter '*.exe' -File)
if ($installers.Count -ne 1) { throw "Expected exactly one NSIS installer, found $($installers.Count)." }
$target = Join-Path $env:RUNNER_TEMP "StitchStudio-$([guid]::NewGuid())"
$program = Join-Path $target 'stitch-studio-desktop.exe'
$uninstaller = Join-Path $target 'uninstall.exe'

$install = Start-Process -FilePath $installers[0].FullName -ArgumentList "/S /D=$target" -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "NSIS installation failed with exit code $($install.ExitCode)." }
try {
    foreach ($path in @($program, $uninstaller, (Join-Path $target 'licenses\LICENSE'))) {
        if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing installed file: $path" }
    }
    if (Test-Path -LiteralPath (Join-Path $target 'local-assistant')) { throw 'The installer bundled an unexpected local model.' }
} finally {
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        $remove = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($remove.ExitCode -ne 0) { throw "NSIS removal failed with exit code $($remove.ExitCode)." }
    }
}
if (Test-Path -LiteralPath $program) { throw 'The uninstaller left the application executable behind.' }
Write-Host 'Windows NSIS installation and removal passed.'
