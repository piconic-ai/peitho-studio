---
status: inbox
description: プレビューのPhone表示に端末フレームを描き、Phone + Same ratio as PCがPCと見分けられるようにする
tags: [ui, preview, viewport]
---

# プレビューのPhone表示に端末フレームを描く

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `todo/preview-viewport-toggle.md`(PR #68〜#70でマージ済み)の
先送り事項。Phoneのshapeを「Same ratio as PC」にすると、キャンバス寸法が
PCと同一になり、プレビューの見た目だけではPCかPhoneか分からない
(手がかりはスイッチの点灯とメニューのチェックだけ)。ユーザーは
この帰結を承知でshapeの選択肢を選んだ。フレーム(端末の枠)をプレビューに
描けば、Phoneの表示であることが一目で分かるようになる。

## 分かっていること(未リファインメント)

- リファインメント前。まだ調べていない: フレームの見た目、Tall / Same
  ratio as PCそれぞれでの収め方(縦長の枠の中に16:9のキャンバスを収める
  と縮尺が小さくなる)、`containScale`(`domain/geometry.ts`)との関係。
- 枠を描くときは`inset-0`を使わず`top-0 right-0 bottom-0 left-0`と書く
  (CLAUDE.md、WKWebViewで`inset`ショートハンドが効かない)。
- 関連: 親の`todo/preview-viewport-toggle.md`の「契約」「レイヤー配置」
  (キャンバス寸法契約。`domain/viewport.ts`の`effectiveCanvas`は変えずに
  済ませられるかも要確認)。
