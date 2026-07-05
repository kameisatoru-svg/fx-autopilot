#!/usr/bin/env python3
"""YouTube の文字起こしを取得して、Claude で要約する CLI ツール。

主な使い方:

  # YouTube の URL（または動画ID）から取得して要約
  python youtube_summary.py "https://www.youtube.com/watch?v=XXXXXXXXXXX"

  # 取得だけして要約しない（文字起こしをそのまま出力）
  python youtube_summary.py "https://youtu.be/XXXXXXXXXXX" --no-summary

  # 手元のテキストファイル（コピペした文字起こしなど）を要約
  python youtube_summary.py --from-file transcript.txt

  # 標準入力（パイプ / 貼り付け）から要約
  pbpaste | python youtube_summary.py --from-file -

必要なもの:
  - pip install -r requirements.txt
  - 要約を使う場合は環境変数 ANTHROPIC_API_KEY を設定
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Optional

# YouTube の URL から動画 ID を取り出すためのパターン
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_URL_PATTERNS = [
    re.compile(r"(?:v=|/v/|/embed/|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})"),
]


def extract_video_id(url_or_id: str) -> str:
    """URL でも生の動画 ID でも受け取り、11 文字の動画 ID を返す。"""
    candidate = url_or_id.strip()
    if _VIDEO_ID_RE.match(candidate):
        return candidate
    for pat in _URL_PATTERNS:
        m = pat.search(candidate)
        if m:
            return m.group(1)
    raise ValueError(
        f"動画 ID を特定できませんでした: {url_or_id!r}\n"
        "YouTube の URL か 11 文字の動画 ID を渡してください。"
    )


def fetch_transcript(video_id: str, languages: list[str]) -> str:
    """youtube-transcript-api で字幕を取得し、1 本のテキストに連結して返す。

    ライブラリのバージョン差（1.x の instance API / 0.6.x の static API）を
    両方とも吸収する。
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as e:  # pragma: no cover - 環境依存
        raise SystemExit(
            "youtube-transcript-api が見つかりません。"
            "`pip install -r requirements.txt` を実行してください。"
        ) from e

    snippets = _fetch_snippets(YouTubeTranscriptApi, video_id, languages)
    # 各スニペットの text を空白でつなぐ（改行は読みづらいので空白に寄せる）
    parts = [re.sub(r"\s+", " ", s).strip() for s in snippets]
    return "\n".join(p for p in parts if p)


def _fetch_snippets(api_cls, video_id: str, languages: list[str]) -> list[str]:
    """バージョン差を吸収して、テキスト文字列のリストを返す。"""
    # 新しい API（1.x）: インスタンスを作って .fetch()
    if hasattr(api_cls, "fetch") or hasattr(api_cls(), "fetch"):
        try:
            fetched = api_cls().fetch(video_id, languages=languages)
            return [getattr(s, "text", "") for s in fetched]
        except TypeError:
            # シグネチャ差のフォールバック
            fetched = api_cls().fetch(video_id)
            return [getattr(s, "text", "") for s in fetched]

    # 古い API（0.6.x 以前）: クラスメソッド .get_transcript()
    if hasattr(api_cls, "get_transcript"):
        rows = api_cls.get_transcript(video_id, languages=languages)
        return [row.get("text", "") for row in rows]

    raise SystemExit(
        "対応していない youtube-transcript-api のバージョンです。"
        "`pip install -U youtube-transcript-api` で更新してください。"
    )


SUMMARY_SYSTEM_PROMPT = """\
あなたは日本語で動画の内容を要約するアシスタントです。
渡されるのは YouTube 動画の文字起こし（自動字幕のため誤変換・句読点なしの場合あり）です。
文字起こしの誤りは文脈から適切に補完し、次の構成で日本語で出力してください。

## 概要
（2〜3文で動画全体の要点）

## 主なポイント
- 箇条書きで5〜10項目。各項目は1〜2文で具体的に。

## 結論・まとめ
（視聴者が得られる学びや結論を2〜3文で）

冗長な前置きや「この動画は〜」といった決まり文句は避け、内容そのものを簡潔に。
"""


def summarize(transcript: str, model: str, effort: str, max_tokens: int) -> str:
    """Claude で文字起こしを要約して返す（ストリーミング）。"""
    try:
        from anthropic import Anthropic
    except ImportError as e:  # pragma: no cover - 環境依存
        raise SystemExit(
            "anthropic SDK が見つかりません。"
            "`pip install -r requirements.txt` を実行してください。"
        ) from e

    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit(
            "環境変数 ANTHROPIC_API_KEY が未設定です。\n"
            "要約には API キーが必要です。--no-summary を付ければ取得のみ実行できます。"
        )

    client = Anthropic()

    # 長い入出力になりうるためストリーミングで受け取る（タイムアウト回避）。
    with client.messages.stream(
        model=model,
        max_tokens=max_tokens,
        system=SUMMARY_SYSTEM_PROMPT,
        thinking={"type": "adaptive"},
        output_config={"effort": effort},
        messages=[
            {
                "role": "user",
                "content": f"次の文字起こしを要約してください。\n\n---\n{transcript}\n---",
            }
        ],
    ) as stream:
        message = stream.get_final_message()

    # text ブロックだけを連結して返す（thinking ブロックは無視）。
    return "".join(
        block.text for block in message.content if block.type == "text"
    ).strip()


def load_input(args: argparse.Namespace) -> tuple[str, Optional[str]]:
    """要約対象のテキストと、（あれば）動画 ID を返す。"""
    if args.from_file is not None:
        if args.from_file == "-":
            return sys.stdin.read(), None
        with open(args.from_file, encoding="utf-8") as f:
            return f.read(), None

    if not args.source:
        raise SystemExit(
            "YouTube の URL/動画ID か、--from-file を指定してください。"
        )

    video_id = extract_video_id(args.source)
    languages = [s.strip() for s in args.lang.split(",") if s.strip()]
    transcript = fetch_transcript(video_id, languages)
    return transcript, video_id


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="YouTube の文字起こしを取得し、Claude で要約する。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "source",
        nargs="?",
        help="YouTube の URL または 11 文字の動画 ID",
    )
    parser.add_argument(
        "--from-file",
        metavar="PATH",
        help="文字起こしテキストをファイルから読む（'-' で標準入力）",
    )
    parser.add_argument(
        "--lang",
        default="ja,en",
        help="字幕の優先言語（カンマ区切り、既定: ja,en）",
    )
    parser.add_argument(
        "--no-summary",
        action="store_true",
        help="要約せず、取得した文字起こしをそのまま出力する",
    )
    parser.add_argument(
        "--model",
        default="claude-opus-4-8",
        help="要約に使う Claude モデル（既定: claude-opus-4-8）",
    )
    parser.add_argument(
        "--effort",
        default="medium",
        choices=["low", "medium", "high", "xhigh", "max"],
        help="思考の深さ/コストの目安（既定: medium）",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=8000,
        help="要約の最大出力トークン数（既定: 8000）",
    )
    parser.add_argument(
        "--out",
        metavar="PATH",
        help="結果をファイルに保存する（未指定なら標準出力）",
    )
    args = parser.parse_args(argv)

    transcript, video_id = load_input(args)

    if not transcript.strip():
        raise SystemExit("文字起こしが空でした。字幕が無い動画の可能性があります。")

    if args.no_summary:
        output = transcript
    else:
        if video_id:
            print(f"[info] 文字起こしを取得しました（動画ID: {video_id}）。要約します…",
                  file=sys.stderr)
        else:
            print("[info] 入力テキストを要約します…", file=sys.stderr)
        output = summarize(
            transcript,
            model=args.model,
            effort=args.effort,
            max_tokens=args.max_tokens,
        )

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(output + "\n")
        print(f"[info] 保存しました: {args.out}", file=sys.stderr)
    else:
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
