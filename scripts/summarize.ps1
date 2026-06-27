# クリップボードにコピーした文字起こしを要約し、ファイルに保存して開く。
# 通常は summarize.bat をダブルクリックして実行する（直接実行も可）。

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Python を UTF-8 で動かす（日本語の文字化け防止）
$env:PYTHONUTF8 = "1"

$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "仮想環境が見つかりません。先に README のセットアップを実行してください。" -ForegroundColor Red
    Read-Host "Enter キーで閉じます"
    exit 1
}

if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host "ANTHROPIC_API_KEY が設定されていません。" -ForegroundColor Red
    Write-Host '一度だけ次を実行し、PowerShell を開き直してください:' -ForegroundColor Yellow
    Write-Host '  setx ANTHROPIC_API_KEY "sk-ant-自分のキー"' -ForegroundColor Yellow
    Read-Host "Enter キーで閉じます"
    exit 1
}

# クリップボードを UTF-8(BOMなし) の一時ファイルに保存
$text = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($text)) {
    Write-Host "クリップボードが空です。先に文字起こしをコピーしてください。" -ForegroundColor Red
    Read-Host "Enter キーで閉じます"
    exit 1
}
$tmp = Join-Path $env:TEMP "yt_transcript.txt"
[System.IO.File]::WriteAllText($tmp, $text, (New-Object System.Text.UTF8Encoding($false)))

# 出力先: summaries\日時.txt
$outDir = Join-Path $PSScriptRoot "summaries"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$out = Join-Path $outDir "$stamp.txt"

Write-Host "要約しています… 少しお待ちください。"
& $py youtube_summary.py --from-file $tmp --out $out

if (Test-Path $out) {
    Write-Host "保存しました: $out" -ForegroundColor Green
    Start-Process notepad.exe $out
} else {
    Write-Host "要約に失敗しました。上のメッセージを確認してください。" -ForegroundColor Red
    Read-Host "Enter キーで閉じます"
}
