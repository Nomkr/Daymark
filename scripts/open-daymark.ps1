param([switch]$NoBrowser, [int]$PreferredPort = 5173)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $projectRoot 'dist\index.html'))) {
    Push-Location $projectRoot
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Daymark 构建失败。' }
    } finally {
        Pop-Location
    }
}

function Test-Daymark([int]$Port) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains('<title>Daymark')
    } catch {
        return $false
    }
}

function Test-PortOpen([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

$port = $PreferredPort
while ($port -le ($PreferredPort + 17)) {
    if (Test-Daymark $port) { break }
    if (-not (Test-PortOpen $port)) { break }
    $port++
}
if ($port -gt ($PreferredPort + 17)) { throw 'Daymark 无法找到可用端口。' }

if (-not (Test-Daymark $port)) {
    $env:PORT = [string]$port
    Start-Process -FilePath $node -ArgumentList @('server.js', '--production') -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 150
        if (Test-Daymark $port) { $ready = $true; break }
    }
    if (-not $ready) { throw 'Daymark 本地服务未能启动。' }
}

$url = "http://127.0.0.1:$port/"
Write-Output "Daymark: $url"
if ($NoBrowser) { return }

$edge = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
    Start-Process -FilePath $edge -ArgumentList "--app=$url"
} else {
    Start-Process $url
}
