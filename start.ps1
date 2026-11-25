# Start ThatFriend (web demo + Telegram if TELEGRAM_BOT_TOKEN is set in .env)
$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) { $node = "node" }
Set-Location $PSScriptRoot
Write-Host "Landing page: http://localhost:8787   Live demo: http://localhost:8787/demo"
& $node src/server.js
