@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%zipfin-backend"
set "VENV=%BACKEND%\venv"
set "PYTHON=%VENV%\Scripts\python.exe"
set "ACTIVATE=%VENV%\Scripts\activate.bat"
set "REQUIREMENTS=%BACKEND%\requirements.txt"
set "MARKER=%VENV%\.zipright-requirements.sha256"

if "%~1"=="" (
    set "PORT=8000"
) else (
    set "PORT=%~1"
)

if exist "%PYTHON%" (
    "%PYTHON%" -c "import sys" >nul 2>nul
    if errorlevel 1 goto recreate_venv
    goto activate_venv
)

:recreate_venv
if exist "%VENV%" (
    echo Existing backend venv is not usable; recreating it.
    rmdir /s /q "%VENV%"
)

where py >nul 2>nul
if not errorlevel 1 (
    py -3 -m venv "%VENV%"
    goto check_created
)

where python >nul 2>nul
if not errorlevel 1 (
    python -m venv "%VENV%"
    goto check_created
)

echo Python 3 is required to create %VENV%. Install Python 3.12 or add Python to PATH.
exit /b 1

:check_created
if not exist "%PYTHON%" (
    echo Failed to create backend virtual environment at %VENV%.
    exit /b 1
)

:activate_venv
call "%ACTIVATE%"

"%PYTHON%" -m pip --version
if errorlevel 1 exit /b 1

"%PYTHON%" -c "import hashlib, importlib.util, pathlib, sys; req=pathlib.Path(r'%REQUIREMENTS%'); marker=pathlib.Path(r'%MARKER%'); expected=hashlib.sha256(req.read_bytes()).hexdigest(); missing=[m for m in ('fastapi','pytest','uvicorn') if importlib.util.find_spec(m) is None]; sys.exit(0 if marker.exists() and marker.read_text().strip()==expected and not missing else 1)"
if errorlevel 1 (
    echo Installing backend dependencies from %REQUIREMENTS%
    "%PYTHON%" -m pip install -r "%REQUIREMENTS%"
    if errorlevel 1 exit /b 1
    "%PYTHON%" -c "import hashlib, pathlib; req=pathlib.Path(r'%REQUIREMENTS%'); pathlib.Path(r'%MARKER%').write_text(hashlib.sha256(req.read_bytes()).hexdigest())"
)

"%PYTHON%" -c "import uvicorn" >nul 2>nul
if errorlevel 1 (
    echo uvicorn is not installed in %VENV%.
    exit /b 1
)

cd /d "%BACKEND%"
set "PORT=%PORT%"
"%PYTHON%" -m uvicorn main:app --reload --port %PORT%
