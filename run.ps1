# One-command launcher for native Windows (no WSL / Git Bash required).
# Builds the React dashboard (app/) if needed, starts the FastAPI backend
# (creating the venv on first run), and opens the dashboard, which the
# backend serves at http://localhost:8000/app/.
#
# Usually launched by double-clicking run.bat, which calls this script.

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Root ".venv"
$BackendDir = Join-Path $Root "project\backend"
$AppDir = Join-Path $Root "app"
$AppUrl = "http://localhost:8000/app/"

function Fail($Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Preflight: find a usable Python 3.9+.
# ---------------------------------------------------------------------------
$PythonBin = $null
foreach ($candidate in @("python", "py")) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    $verArgs = if ($candidate -eq "py") { @("-3", "-c") } else { @("-c") }
    $check = & $candidate @verArgs "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $PythonBin = $candidate
        $PythonArgsPrefix = if ($candidate -eq "py") { @("-3") } else { @() }
        break
    }
}
if (-not $PythonBin) {
    Fail "GrantFlow needs Python 3.9 or newer, and it wasn't found on your PATH.`nInstall it from https://www.python.org/downloads/ and check `"Add python.exe to PATH`" during setup, then run this script again."
}

# ---------------------------------------------------------------------------
# Load local identity and Microsoft Graph configuration when present.
# ---------------------------------------------------------------------------
$EnvFile = Join-Path $BackendDir ".sharepoint.env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $pair = $line -split "=", 2
        if ($pair.Length -eq 2) {
            [System.Environment]::SetEnvironmentVariable($pair[0].Trim(), $pair[1].Trim())
        }
    }
}

$VenvPython = Join-Path $Venv "Scripts\python.exe"
$VenvPip = Join-Path $Venv "Scripts\pip.exe"

if (-not (Test-Path $Venv)) {
    Write-Host "Setting up Python virtual environment..."
    & $PythonBin @PythonArgsPrefix -m venv $Venv
    if ($LASTEXITCODE -ne 0) {
        Fail "Could not create a Python virtual environment. See the error above, then run this script again."
    }
}

if (-not (Test-Path $VenvPython) -or -not (Test-Path $VenvPip)) {
    Fail "The existing .venv is incomplete. Delete the .venv folder and run run.bat again."
}

$RequirementsFile = Join-Path $BackendDir "requirements.txt"
$RequirementsStamp = Join-Path $Venv ".grantflow-requirements.sha256"
$RequirementsHash = (Get-FileHash -Algorithm SHA256 $RequirementsFile).Hash.ToLowerInvariant()
$InstalledHash = if (Test-Path $RequirementsStamp) {
    (Get-Content $RequirementsStamp -Raw).Trim().ToLowerInvariant()
} else {
    ""
}
if ($InstalledHash -ne $RequirementsHash) {
    Write-Host "Installing backend dependencies..."
    & $VenvPip install -q -r $RequirementsFile
    if ($LASTEXITCODE -ne 0) {
        Fail "Installing backend dependencies failed. See the error above."
    }
    Set-Content -Path $RequirementsStamp -Value $RequirementsHash -Encoding Ascii
}

# ---------------------------------------------------------------------------
# Build the dashboard when its build output is missing or older than its
# source (or the design system's). Needs node only when a rebuild is due.
# ---------------------------------------------------------------------------
$DistIndex = Join-Path $AppDir "dist\index.html"
$NeedsBuild = $false
if (-not (Test-Path $DistIndex)) {
    $NeedsBuild = $true
} else {
    $distTime = (Get-Item $DistIndex).LastWriteTime
    $sourcePaths = @(
        (Join-Path $AppDir "src"),
        (Join-Path $AppDir "index.html"),
        (Join-Path $Root "design-system\src")
    ) | Where-Object { Test-Path $_ }
    $newest = Get-ChildItem -Path $sourcePaths -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest -and $newest.LastWriteTime -gt $distTime) {
        $NeedsBuild = $true
    }
}

if ($NeedsBuild) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Fail "GrantFlow needs Node.js 18 or newer to build the dashboard, and it wasn't found on your PATH.`nInstall the LTS version from https://nodejs.org, then run this script again."
    }
    Write-Host "Building the dashboard (app/)..."
    Push-Location $AppDir
    try {
        if (-not (Test-Path (Join-Path $AppDir "node_modules"))) {
            npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { Fail "Installing dashboard dependencies failed. See the error above." }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { Fail "Building the dashboard failed. See the error above." }
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Start (or reuse) the backend.
# ---------------------------------------------------------------------------
function Test-Url($Url) {
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

$BackendStartedHere = $false
$BackendProcess = $null

if (Test-Url "http://localhost:8000/") {
    $authConfig = try { (Invoke-WebRequest -Uri "http://localhost:8000/auth/config" -UseBasicParsing -TimeoutSec 2).Content } catch { "" }
    if ($authConfig -notmatch '"mode"') {
        Fail "A backend is running on http://localhost:8000 but does not include identity access.`nStop that process, then run this script again."
    } elseif (-not (Test-Url $AppUrl)) {
        Fail "A backend is running on http://localhost:8000 but isn't serving the dashboard.`nStop that process, then run this script again."
    } else {
        Write-Host "Backend already running on http://localhost:8000 - reusing it."
    }
} else {
    Write-Host "Starting backend on http://localhost:8000..."
    $BackendProcess = Start-Process -FilePath $VenvPython -ArgumentList "main.py" -WorkingDirectory $BackendDir -WindowStyle Hidden -PassThru
    $BackendStartedHere = $true

    $started = $false
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-Url "http://localhost:8000/") { $started = $true; break }
        if ($BackendProcess.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $started) {
        Fail "The backend didn't start within 15 seconds. Run this to see why:`n  $VenvPython $BackendDir\main.py"
    }
}

try {
    Write-Host "Opening the dashboard..."
    Start-Process $AppUrl

    Write-Host ""
    Write-Host "GrantFlow is running at $AppUrl. Press Ctrl+C to stop the backend."

    if ($BackendStartedHere) {
        Wait-Process -Id $BackendProcess.Id
    } else {
        while ($true) { Start-Sleep -Seconds 3600 }
    }
} finally {
    if ($BackendStartedHere -and -not $BackendProcess.HasExited) {
        Write-Host ""
        Write-Host "Stopping backend (pid $($BackendProcess.Id))..."
        Stop-Process -Id $BackendProcess.Id -ErrorAction SilentlyContinue
    }
}
