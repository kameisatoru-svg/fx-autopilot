# YouTube 文字起こし要約スクリプト

YouTube 動画の文字起こし（字幕）を取得し、Claude で日本語に要約する CLI ツールです。
手元にコピーした文字起こしテキストを要約するだけにも使えます。

## セットアップ

```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

要約機能を使う場合は、Anthropic の API キーを環境変数に設定します。

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # Windows(PowerShell): $env:ANTHROPIC_API_KEY="sk-ant-..."
```

API キーは https://console.anthropic.com/ で発行できます。

## 使い方

```bash
# YouTube の URL（または 11 文字の動画ID）から取得して要約
python youtube_summary.py "https://www.youtube.com/watch?v=XXXXXXXXXXX"

# 取得だけして要約しない（文字起こしをそのまま出力）
python youtube_summary.py "https://youtu.be/XXXXXXXXXXX" --no-summary

# Chrome拡張などでコピーした文字起こしファイルを要約
python youtube_summary.py --from-file transcript.txt

# 標準入力（パイプ / 貼り付け）から要約
pbpaste | python youtube_summary.py --from-file -      # macOS
```

### 主なオプション

| オプション | 説明 | 既定値 |
|---|---|---|
| `--from-file PATH` | 文字起こしをファイルから読む（`-` で標準入力） | — |
| `--lang ja,en` | 字幕の優先言語（カンマ区切り） | `ja,en` |
| `--no-summary` | 要約せず取得した文字起こしをそのまま出力 | off |
| `--model` | 要約に使う Claude モデル | `claude-opus-4-8` |
| `--effort` | 思考の深さ/コストの目安（low〜max） | `medium` |
| `--max-tokens` | 要約の最大出力トークン数 | `8000` |
| `--out PATH` | 結果をファイルに保存 | 標準出力 |

## 注意

- **このリポジトリのクラウド実行環境では YouTube への通信がブロックされています。** そのため
  YouTube からの自動取得（URL を渡す使い方）は、あなたのローカル PC など YouTube に
  アクセスできる環境で実行してください。`--from-file` での要約はテキストさえあれば
  どこでも動きます。
- 字幕が無い動画は取得できません（`--no-summary` でも空になります）。
- 自動字幕は誤変換や句読点欠落がありますが、要約時に文脈で補正します。
