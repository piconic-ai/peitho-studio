---
status: inbox
description: レイアウト画面リニューアル(#155〜#166)で未決のまま残った細かな判断事項
tags: [layout, viewport, comments]
---

# レイアウト画面リニューアルの残り

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: レイアウト画面リニューアル一式(`todo/archive/standard-layouts.md`〜
`todo/archive/layout-screen-explorer.md`)をアーカイブする際(2026-10-05)、
決めきっていなかった事項をここに移した。

- **狭いパネルでのスマホの大きさ**(`todo/archive/viewport-device-presets.md`の実寸表示):
  プレビューのパネルが端末より狭いと、各端末をそれぞれパネル幅に縮めるため、小さめの
  スマホと標準のスマホが同じ大きさに見える(差はラベルの割合だけ)。案: スマホは共通の
  縮尺(例: 大きめのスマホ430pxが収まる縮尺)で縮め、「小さめ < 標準 < 大きめ」の差を
  保つ。タブレットは単独で収める。
- **コメント欄の見出しの言語**(`todo/archive/layout-screen-explorer.md`): 日本語のUIでも
  見出しは英語(例: 「All layouts」)。見出しがエージェントが受け取るラベルと同じ文字列の
  ため。表示だけ日本語にするか。
- 関連: issue #161(ライブプレビューの下書きフォントの分離)。
