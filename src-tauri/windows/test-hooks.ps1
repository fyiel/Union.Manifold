param(
    [string]$MakeNsis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
    [string]$HooksFile = "$PSScriptRoot\hooks.nsh"
)
$ErrorActionPreference = 'Stop'
$work = Join-Path ([IO.Path]::GetTempPath()) ("manifold-hooks-" + [Guid]::NewGuid())
$install = Join-Path $work 'app with spaces'
$setup = Join-Path $work 'setup.exe'
$exe = Join-Path $install 'union-manifold.exe'
$dll = Join-Path $install '7z.dll'
New-Item -ItemType Directory -Path $install | Out-Null

function Run-Setup([string]$File, [string]$Arguments, [int]$Expected) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (!$process.WaitForExit(15000)) {
        $process.Kill()
        throw "Installer timed out: $Arguments"
    }
    if ($process.ExitCode -ne $Expected) {
        throw "Installer returned $($process.ExitCode), expected ${Expected}: $Arguments"
    }
}

try {
    & $MakeNsis /V2 "/DHOOKS_FILE=$HooksFile" "/DTEST_OUTFILE=$setup" "$PSScriptRoot\test-hooks.nsi"
    if ($LASTEXITCODE -ne 0) { throw 'NSIS compilation failed' }

    # Fresh install with no DLL must work and produce the test uninstaller.
    Run-Setup $setup "/S /D=$install" 0
    [IO.File]::WriteAllText($exe, 'old executable')
    [IO.File]::WriteAllText($dll, 'extractor library')

    # Windows denies write access while the extractor holds its library open.
    $lock = [IO.File]::Open($dll, 'Open', 'Read', 'Read')
    try {
        Run-Setup $setup "/S /EARLY /D=$install" 2
        if ([IO.File]::ReadAllText($exe) -ne 'old executable') { throw 'Early guard lost the executable' }
        Run-Setup $setup "/S /D=$install" 2
        if ([IO.File]::ReadAllText($exe) -ne 'old executable') { throw 'Install guard overwrote the executable' }
        Run-Setup (Join-Path $install 'uninstall.exe') "/S _?=$install" 2
        if ([IO.File]::ReadAllText($exe) -ne 'old executable') { throw 'Uninstall guard lost the executable' }
        if ([IO.File]::ReadAllText($dll) -ne 'extractor library') { throw 'Guard modified the DLL' }
    } finally {
        $lock.Dispose()
    }

    Run-Setup $setup "/S /D=$install" 0
    if ([IO.File]::ReadAllText($exe) -ne 'new executable') { throw 'Unlocked upgrade failed' }
    if ([IO.File]::ReadAllText($dll) -ne 'extractor library') { throw 'Probe changed an unlocked DLL' }
    Run-Setup (Join-Path $install 'uninstall.exe') "/S _?=$install" 0
    if (Test-Path $exe) { throw 'Unlocked uninstall failed' }
    Write-Host 'Windows installer lock regression checks passed.'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
