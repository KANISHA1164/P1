$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $python) {
    throw "Python 3 is required to serve this local demo."
}

Set-Location $projectRoot
Write-Host "Karunya Campus Booking demo: http://127.0.0.1:5500/"
Write-Host "Press Ctrl+C to stop the server."
if ($python.Name -eq "py.exe") {
    & $python.Source -3 -m http.server 5500 --bind 127.0.0.1
} else {
    & $python.Source -m http.server 5500 --bind 127.0.0.1
}
