---
status: inbox
description: プレビューのPhone表示で、幅も端末に合わせた実幅(390)のキャンバスにできるようにする
tags: [ui, preview, viewport]
---

# プレビューのPhone表示で実幅(390)のキャンバスにする

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `todo/preview-viewport-toggle.md`(PR #68〜#70でマージ済み)の
先送り事項。`reshapeCanvas`はデッキの幅を保って高さだけ伸ばすので、
Tallでもキャンバス幅は1280(4:3なら960)のまま。そのため、幅に対する
`@container (max-width: …)`で分岐するデッキは、このトグルでは狭い側の
分岐を確認できない(高さ・縦横比に対するクエリだけが発火する)。

## 分かっていること(未リファインメント)

- リファインメント前。幅も端末に合わせる案(390幅の実キャンバス)は、
  文字やレイアウトが別物になる(barefootjs overviewの`narration.ts`は
  意図的に幅1280を保ち、縮尺で画面に収めている)ので、設計から相談が要る。
- 検討点(未調査): 現行のTall/Same ratio as PCとの関係(3つ目のshapeにするか、
  置き換えるか)、`data-canvas="fixed"`との関係、デッキが幅基準の
  クエリで書かれているか高さ・縦横比基準かで見え方がどう変わるか。
- 関連: 親の`todo/preview-viewport-toggle.md`の「契約の候補と結論」
  (なぜ幅を保つ設計にしたか)。
