# Installation de SOVID AI (Windows PowerShell).
# Usage : powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Link]
param([switch]$Link)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host "Installation de SOVID AI" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js est introuvable. Installez Node.js 20 LTS ou plus recent : https://nodejs.org (ou : winget install OpenJS.NodeJS.LTS)" -ForegroundColor Red
  exit 1
}
$version = (node -p "process.versions.node").Trim()
$parts = $version.Split('.')
if ([int]$parts[0] -lt 20 -or ([int]$parts[0] -eq 20 -and [int]$parts[1] -lt 3)) {
  Write-Host "Node.js $version detecte : la version 20.3 ou plus recente est requise." -ForegroundColor Red
  exit 1
}
Write-Host "OK Node.js $version" -ForegroundColor Green

Write-Host "-> Installation des dependances..."
if (Test-Path package-lock.json) { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { throw "npm install a echoue" }

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "OK Fichier .env cree (a completer avec vos cles API si besoin)" -ForegroundColor Green
} else {
  Write-Host "OK Fichier .env existant conserve" -ForegroundColor Green
}

Write-Host "-> Compilation..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "La compilation a echoue" }

if ($Link) {
  Write-Host "-> Installation de la commande globale video-agent (npm link)..."
  npm link
}

Write-Host ""
node bin/video-agent.js doctor
Write-Host ""
Write-Host "Installation terminee !" -ForegroundColor Green
Write-Host "Essayez :"
Write-Host "  npm run demo"
Write-Host '  node bin\video-agent.js "Cree une video de 20 secondes pour presenter mon application"'
Write-Host "  npm run web   (interface web sur http://127.0.0.1:3210)"
