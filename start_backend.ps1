param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "zipfin-backend"
$Venv = Join-Path $Backend "venv"
$Python = Join-Path $Venv "Scripts\python.exe"
$Activate = Join-Path $Venv "Scripts\Activate.ps1"
$Requirements = Join-Path $Backend "requirements.txt"
$RequirementsMarker = Join-Path $Venv ".zipright-requirements.sha256"

function New-ZiprightVenv {
    Write-Host "Creating backend virtual environment at $Venv"

    $basePython = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($basePython) {
        & $basePython.Source -3 -m venv $Venv
        return
    }

    $basePython = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($basePython) {
        & $basePython.Source -m venv $Venv
        return
    }

    throw "Python 3 is required to create $Venv. Install Python 3.12 or add Python to PATH."
}

function Test-VenvPython {
    if (-not (Test-Path $Python)) {
        return $false
    }

    & $Python -c "import sys" *> $null
    return $LASTEXITCODE -eq 0
}

function Get-RequirementsHash {
    return (Get-FileHash -Algorithm SHA256 $Requirements).Hash
}

function Test-Dependencies {
    if (-not (Test-Path $RequirementsMarker)) {
        return $false
    }

    $expected = Get-RequirementsHash
    $actual = (Get-Content $RequirementsMarker -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($actual -ne $expected) {
        return $false
    }

    & $Python -c "import fastapi, pytest, uvicorn" *> $null
    return $LASTEXITCODE -eq 0
}

if (-not (Test-VenvPython)) {
    if (Test-Path $Venv) {
        Write-Host "Existing backend venv is not usable; recreating it."
        Remove-Item -LiteralPath $Venv -Recurse -Force
    }
    New-ZiprightVenv
}

. $Activate

& $Python -m pip --version | Out-Host

if (-not (Test-Dependencies)) {
    Write-Host "Installing backend dependencies from $Requirements"
    & $Python -m pip install -r $Requirements
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed."
    }
    Get-RequirementsHash | Set-Content -NoNewline $RequirementsMarker
}

& $Python -c "import uvicorn" *> $null
if ($LASTEXITCODE -ne 0) {
    throw "uvicorn is not installed in $Venv."
}

Set-Location $Backend
$env:PORT = "$Port"
& $Python -m uvicorn main:app --reload --port $Port
