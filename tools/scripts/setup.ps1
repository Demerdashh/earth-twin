# Analog Finder — local toolchain setup (Windows).
# Installs everything INSIDE ./tools. Safe to re-run: each step is skipped when already done.
# Nothing is installed globally; no system or user settings are modified.
param([switch]$PythonOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$UvVersion = '0.13.8'
$PythonVersion = '3.11'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Tools = Join-Path $Root 'tools'
$Bin = Join-Path $Tools 'bin'
$Cache = Join-Path $Tools 'cache'
$Venv = Join-Path $Tools 'python'

foreach ($d in @($Bin, $Cache, (Join-Path $Tools 'node'))) { New-Item -ItemType Directory -Force $d | Out-Null }

# Keep every tool cache inside the project.
$env:UV_CACHE_DIR = Join-Path $Cache 'uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Bin 'cpython'
$env:UV_NO_MODIFY_PATH = '1'
$env:PIP_CACHE_DIR = Join-Path $Cache 'pip'
$env:npm_config_cache = Join-Path $Cache 'npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Bin 'ms-playwright'

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# 1. uv (only used to fetch a standalone CPython 3.11; the venv itself is plain `python -m venv`)
$Uv = Join-Path $Bin 'uv.exe'
$haveUv = (Test-Path $Uv) -and ((& $Uv --version) -match [regex]::Escape($UvVersion))
if (-not $haveUv) {
  Step "Downloading uv $UvVersion into tools/bin"
  $zip = Join-Path $Cache "uv-$UvVersion.zip"
  Invoke-WebRequest "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip" -OutFile $zip
  $tmp = Join-Path $Cache "uv-$UvVersion"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -Confirm:$false }
  Expand-Archive $zip -DestinationPath $tmp
  Copy-Item (Get-ChildItem $tmp -Recurse -Filter 'uv*.exe').FullName $Bin -Force
} else { Step "uv $UvVersion already present" }

# 2. CPython 3.11 (standalone build, stored in tools/bin/cpython)
Step "Ensuring CPython $PythonVersion in tools/bin/cpython"
& $Uv python install $PythonVersion | Out-Host
$Py311 = (& $Uv python find $PythonVersion).Trim()
if (-not $Py311.StartsWith($Bin)) { throw "uv resolved Python outside tools/: $Py311" }

# 3. Virtual environment in tools/python
$VenvPy = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $VenvPy)) {
  Step 'Creating venv tools/python'
  & $Py311 -m venv $Venv
} else { Step 'venv tools/python already exists' }
& $VenvPy -m pip install --disable-pip-version-check -q -r (Join-Path $Root 'requirements.txt')

if ($PythonOnly) {
  Write-Host ("python:     " + (& $VenvPy --version))
  Write-Host 'Python toolchain ready (-PythonOnly: skipped npm and Playwright).' -ForegroundColor Green
  exit 0
}

# 4. JavaScript dependencies (project-local node_modules)
Step 'Installing npm dependencies'
Push-Location $Root
try {
  if (Test-Path 'package-lock.json') { npm ci --no-fund --no-audit } else { npm install --no-fund --no-audit }
  # 5. Playwright Chromium, stored in tools/bin/ms-playwright
  Step 'Installing Playwright Chromium into tools/bin/ms-playwright'
  npx --no-install playwright install chromium
} finally { Pop-Location }

# 6. Verify versions
Step 'Versions'
Write-Host ("uv:         " + (& $Uv --version))
Write-Host ("python:     " + (& $VenvPy --version))
Write-Host ("node:       " + (node --version))
Write-Host ("npm:        " + (npm --version))
& $VenvPy -c "from importlib.metadata import version as v; print(' | '.join(f'{p} {v(p)}' for p in ('numpy','pillow','jsonschema','pytest','mypy')))"
Push-Location $Root
try { Write-Host ("playwright: " + (npx --no-install playwright --version)) } finally { Pop-Location }
Write-Host 'Setup complete.' -ForegroundColor Green
