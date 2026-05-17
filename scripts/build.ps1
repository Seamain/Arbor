#Requires -Version 5.1
<#
.SYNOPSIS
    Arbor — Windows build script (MSI, x86_64 & arm64)

.DESCRIPTION
    Builds Arbor installer packages for Windows using Tauri CLI.
    Produces MSI packages for x86_64 and/or arm64 architectures.

.PARAMETER Arch
    Target architecture: x86_64, arm64, or all (default: all)

.PARAMETER SkipFrontend
    Skip `npm run build` if the frontend is already built.

.EXAMPLE
    .\scripts\build.ps1
    .\scripts\build.ps1 -Arch x86_64
    .\scripts\build.ps1 -Arch arm64
    .\scripts\build.ps1 -Arch all -SkipFrontend

.NOTES
    Run from the repository root.
    Recommended: run as Administrator for best compatibility.
#>

[CmdletBinding()]
param(
    [ValidateSet("x86_64", "arm64", "all")]
    [string]$Arch = "all",

    [switch]$SkipFrontend
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Header([string]$msg) {
    Write-Host ""
    Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "══════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Log([string]$msg)  { Write-Host "[build] $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "[  ok ] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "[ warn] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host "[error] $msg" -ForegroundColor Red }

function Require-Command([string]$cmd) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Err "Required tool not found: $cmd"
        Write-Err "  Install it and re-run this script."
        exit 1
    }
}

function Collect-Artifact([string]$src, [string]$destDir) {
    if (Test-Path $src) {
        Copy-Item $src $destDir -Force
        Write-Ok "Collected: $(Split-Path $src -Leaf)"
    } else {
        Write-Warn "Expected artifact not found: $src"
    }
}

# ── Locate repo root ──────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir

Set-Location $RepoRoot

# ── Pre-flight ────────────────────────────────────────────────────────────────
Write-Header "Pre-flight checks"
Require-Command "cargo"
Require-Command "rustup"
Require-Command "node"
Require-Command "npm"

$RustVersion  = (rustc --version)
$NodeVersion  = (node --version)
$NpmVersion   = (npm --version)
$TauriVersion = & npx tauri --version 2>$null

Write-Log "Rust:      $RustVersion"
Write-Log "Node:      $NodeVersion"
Write-Log "npm:       $NpmVersion"
Write-Log "Tauri CLI: $TauriVersion"

# Read app version
$TauriConf = Get-Content "$RepoRoot\src-tauri\tauri.conf.json" | ConvertFrom-Json
$Version   = $TauriConf.version
Write-Log "App version: $Version"

# ── Output directory ──────────────────────────────────────────────────────────
$OutDir = "$RepoRoot\dist-packages\windows"
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
Write-Log "Output dir: $OutDir"

# ── Frontend build ────────────────────────────────────────────────────────────
if (-not $SkipFrontend) {
    Write-Header "Building frontend"
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Err "npm run build failed"; exit 1 }
    Write-Ok "Frontend build complete"
}

# ── Build function ────────────────────────────────────────────────────────────
function Build-Windows([string]$RustTarget, [string]$ArchLabel) {
    Write-Header "Windows — $ArchLabel ($RustTarget)"

    # Install target if needed
    $Installed = & rustup target list --installed
    if ($Installed -notcontains $RustTarget) {
        Write-Log "Installing Rust target $RustTarget ..."
        rustup target add $RustTarget
        if ($LASTEXITCODE -ne 0) { Write-Err "rustup target add failed"; exit 1 }
    }

    # Tauri build
    npx tauri build --target $RustTarget
    if ($LASTEXITCODE -ne 0) {
        Write-Err "tauri build failed for $RustTarget"
        exit 1
    }

    # Collect .msi artifacts
    $BundleDir = "$RepoRoot\src-tauri\target\$RustTarget\release\bundle\msi"
    if (Test-Path $BundleDir) {
        Get-ChildItem "$BundleDir\*.msi" | ForEach-Object {
            Collect-Artifact $_.FullName $OutDir
        }
    } else {
        Write-Warn "MSI bundle dir not found: $BundleDir"
    }
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
switch ($Arch) {
    "x86_64" { Build-Windows "x86_64-pc-windows-msvc" "x86_64" }
    "arm64"  { Build-Windows "aarch64-pc-windows-msvc" "arm64" }
    "all"    {
        Build-Windows "x86_64-pc-windows-msvc"   "x86_64"
        Build-Windows "aarch64-pc-windows-msvc"  "arm64"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Header "Build complete"
Write-Log "Artifacts in: $OutDir"
Write-Host ""
Get-ChildItem $OutDir | Format-Table Name, Length, LastWriteTime
Write-Ok "All done!"
