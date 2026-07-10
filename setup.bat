@echo off
setlocal EnableDelayedExpansion

title Project Setup

echo ==================================================
echo           Project Environment Setup
echo ==================================================
echo.

cd python

:: --------------------------------------------------
:: Step 1 - Check Python Installation
:: --------------------------------------------------
echo [1/5] Checking Python installation...

python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Python is not installed or is not added to PATH.
    echo Please install Python 3.8 or later and try again.
    pause
    exit /b 1
)

for /f "tokens=2" %%i in ('python --version') do set PYTHON_VERSION=%%i

echo [SUCCESS] Python Version Detected: %PYTHON_VERSION%
echo.

:: --------------------------------------------------
:: Step 2 - Check Python Version
:: --------------------------------------------------
echo [2/5] Checking Python version...

for /f "tokens=1,2 delims=." %%a in ("%PYTHON_VERSION%") do (
    set MAJOR=%%a
    set MINOR=%%b
)

if %MAJOR% LSS 3 (
    echo.
    echo [ERROR] Python 3.8 or higher is required.
    pause
    exit /b 1
)

if %MAJOR% EQU 3 (
    if %MINOR% LSS 8 (
        echo.
        echo [ERROR] Python 3.8 or higher is required.
        pause
        exit /b 1
    )
)

echo [SUCCESS] Python version is supported.
echo.

:: --------------------------------------------------
:: Step 3 - Create Virtual Environment
:: --------------------------------------------------
echo [3/5] Checking virtual environment...

if exist myenv (
    echo [SUCCESS] Existing virtual environment found.
) else (
    echo Creating virtual environment...

    python -m venv myenv

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )

    echo [SUCCESS] Virtual environment created.
)

echo.

:: --------------------------------------------------
:: Step 4 - Activate Virtual Environment
:: --------------------------------------------------
echo [4/5] Activating virtual environment...

call myenv\Scripts\activate.bat

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to activate the virtual environment.
    pause
    exit /b 1
)

echo [SUCCESS] Virtual environment activated.
echo.

:: --------------------------------------------------
:: Step 5 - Install Dependencies
:: --------------------------------------------------
echo [5/5] Installing project dependencies...

if not exist requirements.txt (
    echo.
    echo [ERROR] requirements.txt was not found.
    pause
    exit /b 1
)

pip install -r requirements.txt

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install project dependencies.
    pause
    exit /b 1
)

echo.
echo ==================================================
echo            Setup Completed Successfully!
echo ==================================================
echo.
echo Your development environment is ready.
echo You can now start the project.
echo.

pause