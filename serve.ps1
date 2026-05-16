# Simple static-file HTTP server (PowerShell)
param([int]$Port = 3000)

$root = Join-Path $PSScriptRoot 'public'
$prefix = "http://localhost:${Port}/"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "`n  Exchange Rate Tool is running at:" -ForegroundColor Cyan
Write-Host "  -> $prefix`n" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop.`n"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json'
    '.png'  = 'image/png'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $urlPath = $req.Url.LocalPath
        if ($urlPath -eq '/') { $urlPath = '/index.html' }

        $filePath = Join-Path $root ($urlPath.TrimStart('/').Replace('/', '\'))

        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host "  200  $urlPath" -ForegroundColor DarkGray
        }
        else {
            $res.StatusCode = 404
            $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
            $res.ContentType = 'text/plain'
            $res.ContentLength64 = $body.Length
            $res.OutputStream.Write($body, 0, $body.Length)
            Write-Host "  404  $urlPath" -ForegroundColor Yellow
        }

        $res.Close()
    }
}
finally {
    $listener.Stop()
    Write-Host "`nServer stopped." -ForegroundColor Cyan
}
