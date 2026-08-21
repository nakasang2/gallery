#!/usr/bin/env python3
"""Regenerate public/fonts/site/*.woff2 + public/fonts/site-fonts.css.

なぜこのスクリプトがあるか（リリース前監査 #15・2026-08-21）:
`app/layout.tsx` は以前、Google Fonts の CSS2 API を `<link>` で実行時に読み込んでいた。
これはEEA/UKを含む全訪問者のIPを、同意バナーより前に無条件でGoogleへ送る形になり、
ドイツの裁判例（LG München I, 2022, 3 O 17493/20）で同型の実装がGDPR違反と
認定されている。フォントファイル自体を自社ドメインへ同梱（自己ホスト化）することで、
この通信自体を無くす。

単純にフォントファイルを丸ごと自己ホストするだけだと、Google が本来やっている
「使う文字の範囲ごとに小さいファイルへ分割して配信する」仕組みが失われ、
日本語フォント（Zen Old Mincho・Zen Kaku Gothic New、素の状態で数MB）を
日本語を1文字も使わないページの訪問者にもまとめて配らせる形になり、
2026-08-18〜19に行ったLPの高速化の努力と逆行する。そこで、Google の
CSS2 API が実際に返す `unicode-range` の境界（頻度データに基づいて既にチューニング
済み）をそのまま読み取り、同じ境界でこちらも分割して自己ホストする。

## 使い方（新しい書体・ウェイトを足すとき、またはフォントを更新したいとき）

1. 依存関係を用意する（このリポジトリの通常の node_modules とは別。venvに閉じる）:
     python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli

2. 下の `GOOGLE_FONTS_QUERY` 定数の値（新しいウェイト/書体を足すならここも
   書き換える — `app/layout.tsx` はもう Google のクエリ文字列を持たない。
   自己ホスト化した時点で消えているので、そちらを参照しようとしても見つからない）
   をコピーして、Google の CSS2 API から境界を取得する（実際のフォントバイト自体は
   ここでは使わない。数値の境界だけ拝借する）:
     curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
       "https://fonts.googleapis.com/css2?<GOOGLE_FONTS_QUERYの値をここに>" \
       -o /tmp/google-fonts.css

3. 各フォントファミリーの実体（TTF）を https://github.com/google/fonts の `ofl/<family>/`
   から取得する（可変フォントなら `フォント名[wght].ttf` の形）。下の
   `VARIABLE_SOURCES`（可変フォント）/`STATIC_SOURCES`（ウェイトごとに個別配布の
   フォント）をダウンロードした場所に合わせて書き換える。

4. `python3 rebuild-self-hosted-fonts.py` を実行する。
   `public/fonts/site/*.woff2` と `public/fonts/site-fonts.css` が上書きされる。

5. 新しいフォントファミリーを足した場合は、そのライセンス（多くはSIL OFL）の
   `OFL.txt` を `public/fonts/<family-slug>/OFL.txt` として同梱する
   （再配布の条件。既存の各フォルダ参照）。

6. `app/layout.tsx` の `<link href="/fonts/site-fonts.css">` はそのままでよい
   （ファイル名を変えていなければ）。ブラウザで実際に文字化けしないか確認する
   （.claude/skills/preview-verify 参照）。
"""
import re
import subprocess
import sys
from collections import OrderedDict
from pathlib import Path

# The exact query app/layout.tsx used to send to fonts.googleapis.com before
# self-hosting (リリース前監査 #15). Kept here — not in app/layout.tsx, which no
# longer has any Google Fonts reference at all — so step 2 below has something
# to copy-paste. Update this FIRST when a weight/family need changes, then
# re-run step 2 to refetch boundaries for the new query.
GOOGLE_FONTS_QUERY = (
    "family=Vollkorn:ital,wght@0,400;0,500;1,400"
    "&family=Zen+Old+Mincho:wght@400"
    "&family=Zen+Kaku+Gothic+New:wght@400;700"
    "&family=Geist:wght@300;400;500;600"
    "&family=Geist+Mono:wght@400;500"
    "&display=swap"
)

ROOT = Path(__file__).resolve().parent.parent
SRC = Path("/tmp/fontsrc")  # downloaded TTF sources (step 3 above)
GOOGLE_CSS = Path("/tmp/google-fonts.css")  # fetched boundaries (step 2 above)
BUILD = Path("/tmp/fontbuild")
FONT_DIR = ROOT / "public" / "fonts" / "site"
CSS_OUT = ROOT / "public" / "fonts" / "site-fonts.css"
VENV_PY = "/tmp/fontenv/bin/python3"

# Families small enough (Latin-only) that a single self-hosted file per
# weight/style is fine — bucketing exists to avoid downloading a multi-MB CJK
# blob for text that never appears, and these fonts are nowhere near that size.
SINGLE_FILE_FAMILIES = {"Vollkorn", "Geist", "Geist Mono"}
# How many of Google's own (frequency-tuned) unicode-range blocks to merge into
# one output file for the CJK families. Smaller = more, smaller files (closer
# to Google's own granularity); larger = fewer, bigger files (less tooling
# overhead, still far better than one file for the whole font).
BUCKET_SIZE = 6

# Where each (family, style, weight) tuple's ttf source lives after step 3.
# `[wght]` variable fonts get instantiated to a static weight first.
VARIABLE_SOURCES = {
    "Vollkorn": (SRC / "Vollkorn[wght].ttf", ["400", "500"]),
    "Vollkorn-Italic": (SRC / "Vollkorn-Italic[wght].ttf", ["400"]),
    "Geist": (SRC / "Geist[wght].ttf", ["300", "400", "500", "600"]),
    "Geist Mono": (SRC / "GeistMono[wght].ttf", ["400", "500"]),
}
STATIC_SOURCES = {
    ("Zen Old Mincho", "normal", "400"): ROOT / "public/fonts/zen-old-mincho/ZenOldMincho-Regular.ttf",
    ("Zen Kaku Gothic New", "normal", "400"): SRC / "ZenKakuGothicNew-Regular.ttf",
    ("Zen Kaku Gothic New", "normal", "700"): SRC / "ZenKakuGothicNew-Bold.ttf",
}
SLUG = {
    "Vollkorn": "vollkorn", "Geist": "geist", "Geist Mono": "geist-mono",
    "Zen Old Mincho": "zen-old-mincho", "Zen Kaku Gothic New": "zen-kaku-gothic-new",
}


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True)


def instance(src: Path, wght: str, out: Path) -> None:
    run([VENV_PY, "-m", "fontTools.varLib.instancer", "-o", str(out), str(src), f"wght={wght}"])


def subset_range(src: Path, unicodes: str, out: Path) -> None:
    run([
        VENV_PY, "-m", "fontTools.subset", str(src),
        f"--unicodes={unicodes}", "--flavor=woff2", "--layout-features=*",
        f"--output-file={out}",
    ])


def parse_google_css(css: str):
    """(family, style, weight, unicode_range) per @font-face, in file order —
    Google's own ordering already groups frequency-adjacent ranges together."""
    for block in re.findall(r"@font-face\s*\{([^}]*)\}", css, re.S):
        yield (
            re.search(r"font-family:\s*'([^']+)'", block).group(1),
            re.search(r"font-style:\s*(\w+)", block).group(1),
            re.search(r"font-weight:\s*(\d+)", block).group(1),
            re.search(r"unicode-range:\s*([^;]+);", block).group(1).strip(),
        )


def main() -> None:
    if not GOOGLE_CSS.exists():
        sys.exit(f"missing {GOOGLE_CSS} — see step 2 in this file's docstring")
    BUILD.mkdir(exist_ok=True)
    FONT_DIR.mkdir(parents=True, exist_ok=True)

    static_sources = dict(STATIC_SOURCES)
    for family, (src, weights) in VARIABLE_SOURCES.items():
        base_family = family.removesuffix("-Italic")
        style = "italic" if family.endswith("-Italic") else "normal"
        for w in weights:
            out = BUILD / f"{family}-{w}.ttf"
            instance(src, w, out)
            static_sources[(base_family, style, w)] = out

    grouped: "OrderedDict[tuple[str, str, str], list[str]]" = OrderedDict()
    for fam, style, weight, ur in parse_google_css(GOOGLE_CSS.read_text()):
        grouped.setdefault((fam, style, weight), []).append(ur)

    manifest = []
    skipped: list[str] = []
    for (fam, style, weight), ranges in grouped.items():
        src = static_sources.get((fam, style, weight))
        if not src or not src.exists():
            skipped.append(f"{fam} {style} {weight}")
            continue
        single_file = fam in SINGLE_FILE_FAMILIES
        buckets = [ranges] if single_file else [
            ranges[i:i + BUCKET_SIZE] for i in range(0, len(ranges), BUCKET_SIZE)
        ]
        for i, bucket in enumerate(buckets):
            fname = f"{SLUG[fam]}-{weight}{'i' if style == 'italic' else ''}-{i}.woff2"
            subset_range(src, ",".join(bucket), FONT_DIR / fname)
            # `unicode-range` exists to let the browser pick among SEVERAL
            # competing files for one family/weight/style without downloading
            # all of them — meaningless (and ~700 bytes of dead weight per rule)
            # when there is only ever one file for it, so omit it there and let
            # it default to "matches everything" (別視点レビューで発見).
            manifest.append({
                "family": fam, "style": style, "weight": weight, "file": fname,
                "unicode_range": None if single_file else ",".join(bucket),
            })

    # A silently-incomplete stylesheet (missing a family nobody noticed wasn't
    # instantiated) is worse than a script that stops and says so — this used to
    # just `print()` one line per skip and carry on to write the CSS anyway,
    # which would ship however many families/weights happened to have sources on
    # whatever machine last ran this (別視点レビューで発見・2026-08-21).
    if skipped:
        sys.exit(
            "Missing TTF source for: " + "; ".join(skipped) + "\n"
            "Add it to STATIC_SOURCES/VARIABLE_SOURCES above (see step 3 in this "
            "file's docstring) — refusing to write a stylesheet that would be "
            "silently missing @font-face rules for these."
        )

    lines = [
        "/* Self-hosted fonts (リリース前監査 #15) — generated by",
        "   scripts/rebuild-self-hosted-fonts.py. Do not hand-edit; re-run that",
        "   script instead. See the license file under each family's folder here",
        "   for attribution (SIL OFL). */",
        "",
    ]
    for e in manifest:
        lines += [
            "@font-face {",
            f"  font-family: '{e['family']}';",
            f"  font-style: {e['style']};",
            f"  font-weight: {e['weight']};",
            "  font-display: swap;",
            f"  src: url('/fonts/site/{e['file']}') format('woff2');",
            *([f"  unicode-range: {e['unicode_range']};"] if e["unicode_range"] else []),
            "}",
            "",
        ]
    CSS_OUT.write_text("\n".join(lines))
    print(f"\nWrote {len(manifest)} font files to {FONT_DIR} and {CSS_OUT}")


if __name__ == "__main__":
    main()
