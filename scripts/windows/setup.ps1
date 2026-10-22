# ProjectOS Health - one-click local setup/start for Windows (synthetic data only).
# Safe to re-run: installs only what is missing, then starts Postgres (Docker) + the web app.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$Log = Join-Path $Root "setup.log"
Set-Location $Root

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Write-Host $line
  Add-Content -Path $Log -Value $line -Encoding UTF8
}
function Run($what, [scriptblock]$cmd) {
  Log ">> $what"
  & $cmd 2>&1 | ForEach-Object { $s = "$_"; if ($s.Trim()) { Log "   $s" } }
  if ($LASTEXITCODE -ne 0) { Log "!! FAILED: $what (exit $LASTEXITCODE)"; Fail }
}
function Fail { Log "SETUP STOPPED. See messages above."; Read-Host "Press Enter to close"; exit 1 }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Has($exe) { [bool](Get-Command $exe -ErrorAction SilentlyContinue) }

Set-Content -Path $Log -Value "" -Encoding UTF8
Log "=== ProjectOS Health setup starting in $Root ==="

# 1. winget
if (-not (Has "winget")) { Log "!! winget not found. Install 'App Installer' from the Microsoft Store, then re-run."; Fail }

# 2. Node.js (>= 22)
Refresh-Path
$nodeOk = $false
if (Has "node") { $v = (node -v) -replace "v",""; if ([int]($v.Split(".")[0]) -ge 22) { $nodeOk = $true } ; Log "Node found: v$v" }
if (-not $nodeOk) {
  Run "Installing Node.js LTS (approve the Windows prompt if asked)" { winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent }
  Refresh-Path
}
if (-not (Has "node")) { Log "!! Node still not on PATH. Close this window and run START-WINDOWS.cmd again."; Fail }
Log ("Node: " + (node -v))

# 3. pnpm (user-level install, no admin)
if (-not (Has "pnpm")) { Run "Installing pnpm 10.28.0" { npm install -g pnpm@10.28.0 }; Refresh-Path; $env:Path += ";$env:APPDATA\npm" }
Log ("pnpm: " + (pnpm -v))

# 4. Docker Desktop
$dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerExe)) {
  Run "Installing Docker Desktop (large download; approve the Windows prompt)" { winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements }
  Refresh-Path
  Log "Docker Desktop installed. If Windows asks you to restart (WSL 2 setup), restart and run START-WINDOWS.cmd again."
}
if (-not (Has "docker")) { $env:Path += ";$env:ProgramFiles\Docker\Docker\resources\bin" }
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Log "Starting Docker Desktop... (first start: accept its license screen if shown)"
  Start-Process $dockerExe
  $deadline = (Get-Date).AddMinutes(6)
  do { Start-Sleep 5; docker info *> $null } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
  if ($LASTEXITCODE -ne 0) { Log "!! Docker engine did not become ready in 6 minutes. Open Docker Desktop, finish its first-run steps (WSL 2 / restart), then re-run."; Fail }
}
Log "Docker engine is running."

# 5. .env (local only, never committed)
if (-not (Test-Path ".env")) {
  $bytes = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  (Get-Content ".env.example") `
    -replace "^BETTER_AUTH_SECRET=.*", "BETTER_AUTH_SECRET=$secret" `
    -replace "^DEMO_PASSWORD=.*", "DEMO_PASSWORD=Riverbend-Demo-2026" |
    Set-Content ".env" -Encoding ASCII
  Log "Created .env (demo password: Riverbend-Demo-2026)"
} else { Log ".env already exists - keeping it." }
# Add settings introduced by later phases to an existing .env (never overwrites a value you set).
foreach ($line in @("SCHEDULING_MODE=DEMO_ONLY", "SCHEDULING_HOLD_MINUTES=5")) {
  $key = ($line -split "=", 2)[0]
  if (-not (Select-String -Path ".env" -Pattern "^$key=" -Quiet)) { Add-Content ".env" $line; Log "Added $line to .env" }
}

# Use this project's .env for DB settings in this window (overrides any system-wide DATABASE_URL).
Get-Content ".env" | Where-Object { $_ -match "^(DATABASE_URL|TEST_DATABASE_URL)=" } | ForEach-Object { $k, $v = $_ -split "=", 2; Set-Item "env:$k" $v }
Log "Database: 127.0.0.1:5433 (Docker container healtho-db-1)"

# 6. Database
Run "Starting PostgreSQL 16 container" { docker compose up -d db }
$deadline = (Get-Date).AddMinutes(2)
do { Start-Sleep 2; $h = docker inspect -f "{{.State.Health.Status}}" (docker compose ps -q db) 2>$null } until ($h -eq "healthy" -or (Get-Date) -gt $deadline)
if ($h -ne "healthy") { Log "!! Postgres container not healthy (is port 5432 used by another Postgres?)."; Fail }
Log "PostgreSQL is healthy."

# 7. App dependencies, migrations, synthetic seed
Run "pnpm install" { pnpm install --frozen-lockfile }
Run "Apply database migrations" { pnpm db:migrate }
Run "Seed SYNTHETIC demo data" { pnpm db:seed }

# 8. Start the web app in its own window and open the browser
Log "Starting web app on http://localhost:3000 (new window; close it to stop the app)"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle='ProjectOS Health - web (close to stop)'; pnpm dev"
Log "Starting background worker (new window): expired holds, recurring tasks, credential deadlines, RCM/task reminders (in-app notifications)"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; `$host.UI.RawUI.WindowTitle='ProjectOS Health - worker (close to stop)'; pnpm worker"
$deadline = (Get-Date).AddMinutes(3)
do { Start-Sleep 3; try { $ok = (Invoke-WebRequest "http://localhost:3000/api/v1/health/ready" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $ok = $false } } until ($ok -or (Get-Date) -gt $deadline)
if ($ok) {
  Log "READY: http://localhost:3000  (sign in as avery.admin@riverbend.example / password from .env DEMO_PASSWORD)"
  Start-Process "http://localhost:3000"
} else { Log "!! Web app did not answer yet - check the 'ProjectOS Health - web' window for errors." }
Log "=== Setup finished ==="
Read-Host "Press Enter to close this window (the app keeps running in the other window)"
