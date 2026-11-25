# Run ZeroClaw as the Telegram front door, using Claude Code (via the local bridge) as its model.
# Prereqs: start.ps1 running in another terminal with TELEGRAM_MODE=zeroclaw in .env,
#          and the bot token stored in ZeroClaw (masked prompt, run once):
#   & "$env:USERPROFILE\tools\zeroclaw\zeroclaw.exe" --config-dir "$PSScriptRoot\zeroclaw\home" config set channels.telegram.thatfriend.bot-token
$zc = "$env:USERPROFILE\tools\zeroclaw\zeroclaw.exe"
& $zc --config-dir "$PSScriptRoot\zeroclaw\home" daemon
