# AnalogLens: local toolchain setup (Windows).
# Installs everything INSIDE ./tools. Safe to re-run: each step is skipped when already done.
# Nothing is installed globally; no system or user settings are modified.
#   -PythonOnly         skip npm and Playwright
#   -Extras real,serve  also install pipeline extras from pyproject.toml (real data, API)
param([switch]$PythonOnly, [string]$Extras = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$UvVersion = '0.13.8'
$PythonVersion = '3.11'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Tools = Join-Path $Root 'tools'
$Bin = Join-Path $Tools 'bin'
$Cache = Join-Path $Tools 'cache'
$Venv = Join-Path $Tools 'python'

foreach ($d in @($Bin, $Cache)) { New-Item -ItemType Directory -Force $d | Out-Null }

# Keep every tool, cache and environment inside the project.
$env:UV_CACHE_DIR = Join-Path $Cache 'uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Bin 'cpython'
$env:UV_NO_MODIFY_PATH = '1'
$env:PIP_CACHE_DIR = Join-Path $Cache 'pip'
$env:npm_config_cache = Join-Path $Cache 'npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Bin 'ms-playwright'

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# 1. uv
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

# 2. CPython 3.11 (standalone build in tools/bin/cpython) and a plain venv in tools/python
Step "Ensuring CPython $PythonVersion in tools/bin/cpython"
& $Uv python install $PythonVersion | Out-Host
$Py311 = (& $Uv python find $PythonVersion).Trim()
if (-not $Py311.StartsWith($Bin)) { throw "uv resolved Python outside tools/: $Py311" }
$VenvPy = Join-Path $Venv 'Scripts\python.exe'
if (-not (Test-Path $VenvPy)) {
  Step 'Creating venv tools/python'
  & $Py311 -m venv $Venv
}

# 3. Exact versions from uv.lock (exported), installed with pip, then the analoglens package itself.
#    (pip instead of `uv sync`: uv's cache renames are blocked by antivirus on some Windows machines.)
Step 'Installing pinned pipeline dependencies from uv.lock'
$lockReq = Join-Path $Cache 'requirements.lock.txt'
$exportArgs = @('export', '--frozen', '--no-hashes', '--no-emit-project', '--project', $Root, '-o', $lockReq)
foreach ($e in ($Extras -split ',' | Where-Object { $_ })) { $exportArgs += @('--extra', $e.Trim()) }
& $Uv @exportArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw "uv export failed ($LASTEXITCODE)" }
& $VenvPy -m pip install --disable-pip-version-check -q -r $lockReq
if ($LASTEXITCODE -ne 0) { throw "pip install failed ($LASTEXITCODE)" }
& $VenvPy -m pip install --disable-pip-version-check -q --no-deps -e $Root
if ($LASTEXITCODE -ne 0) { throw "pip install -e failed ($LASTEXITCODE)" }

if ($PythonOnly) {
  Write-Host ("python:     " + (& $VenvPy --version))
  Write-Host 'Python toolchain ready (-PythonOnly: skipped npm and Playwright).' -ForegroundColor Green
  exit 0
}

# 4. JavaScript dependencies (project-local node_modules) and Playwright Chromium
Step 'Installing npm dependencies'
Push-Location $Root
try {
  if (Test-Path 'package-lock.json') { npm ci --no-fund --no-audit } else { npm install --no-fund --no-audit }
  Step 'Installing Playwright Chromium into tools/bin/ms-playwright'
  npx --no-install playwright install chromium
} finally { Pop-Location }

# 5. Versions
Step 'Versions'
Write-Host ("uv:         " + (& $Uv --version))
Write-Host ("python:     " + (& $VenvPy --version))
Write-Host ("node:       " + (node --version))
Write-Host ("npm:        " + (npm --version))
& $VenvPy -c "from importlib.metadata import version as v; print(' | '.join(f'{p} {v(p)}' for p in ('numpy','scipy','pillow')))"
Push-Location $Root
try { Write-Host ("playwright: " + (npx --no-install playwright --version)) } finally { Pop-Location }
Write-Host 'Setup complete.' -ForegroundColor Green
