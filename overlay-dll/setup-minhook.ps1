# MinHook Setup Script
# Downloads MinHook v1.3.3 source (MIT license) for bundling with the overlay DLL.

$MINHOOK_VERSION = "1.3.3"
$MINHOOK_URL = "https://github.com/TsudaKageyu/minhook/archive/refs/tags/v$MINHOOK_VERSION.zip"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$VENDOR_DIR = Join-Path $SCRIPT_DIR "vendor"
$MINHOOK_DIR = Join-Path $VENDOR_DIR "minhook"
$ZIP_PATH = Join-Path $env:TEMP "minhook-$MINHOOK_VERSION.zip"
$EXTRACT_DIR = Join-Path $env:TEMP "minhook-extract"

Write-Host "Setting up MinHook v$MINHOOK_VERSION..."

# Clean existing
if (Test-Path $MINHOOK_DIR) {
    Remove-Item -Recurse -Force $MINHOOK_DIR
}

# Download
Write-Host "Downloading from GitHub..."
try {
    Invoke-WebRequest -Uri $MINHOOK_URL -OutFile $ZIP_PATH -UseBasicParsing
} catch {
    Write-Error "Failed to download MinHook. Please download manually from https://github.com/TsudaKageyu/minhook/releases/tag/v$MINHOOK_VERSION"
    exit 1
}

# Extract
Write-Host "Extracting..."
if (Test-Path $EXTRACT_DIR) { Remove-Item -Recurse -Force $EXTRACT_DIR }
Expand-Archive -Path $ZIP_PATH -DestinationPath $EXTRACT_DIR -Force

# Move into place
$EXTRACTED = Get-ChildItem -Path $EXTRACT_DIR -Directory | Select-Object -First 1
New-Item -ItemType Directory -Path $VENDOR_DIR -Force | Out-Null
Move-Item -Path $EXTRACTED.FullName -Destination $MINHOOK_DIR

# Cleanup
Remove-Item -Force $ZIP_PATH -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $EXTRACT_DIR -ErrorAction SilentlyContinue

Write-Host "MinHook installed to $MINHOOK_DIR"
Write-Host ""
Write-Host "Verify structure:"
Get-ChildItem -Path $MINHOOK_DIR -Recurse -Name | Select-Object -First 20
