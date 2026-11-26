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
    $model = Get-Item (Join-Path $target 'local-assistant\qwen2.5-0.5b-instruct-q4_k_m.gguf')
    if ($model.Length -ne 491400032) { throw 'The bundled assistant model is incomplete.' }
    $runtime = Join-Path $target 'local-assistant\runtime\llama-cli.exe'
    & $runtime --version
    if ($LASTEXITCODE -ne 0) { throw 'The bundled assistant runtime could not start.' }
} finally {
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        $remove = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($remove.ExitCode -ne 0) { throw "NSIS removal failed with exit code $($remove.ExitCode)." }
    }
}
if (Test-Path -LiteralPath $program) { throw 'The uninstaller left the application executable behind.' }
Write-Host 'Windows NSIS installation and removal passed.'
