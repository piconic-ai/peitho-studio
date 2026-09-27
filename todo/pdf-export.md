---
status: inbox
description: StudioからデッキをPDFに書き出せるようにする(resolutionの設定もここで扱う)
tags: [export, pdf, deck-settings]
---

# PDF出力

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: デッキ設定の配置を検討した壁打ち(2026-09-28)で、ユーザーから
「PDF出力あった方が良いね」。frontmatterの`resolution`はPDFにしか効かない
ため、`todo/deck-settings-menu.md`からは外してこちらで扱う。

## 分かっていること(未整理 — リファインメント時に方針を決める)

peitho-core v1.34.0 を読んだ結果:

- CLIに`peitho export pdf [INPUT] [-o OUT]`がある(`crates/peitho/src/
  main.rs:852,873-880`)。出力の既定は`<入力のstem>.pdf`。
- 実装はheadless Chrome。`render_pdf_document`(peitho-core
  `render.rs:2243`)でPDF用HTMLを作り、CLI側がChromeを探して
  (`locate_chrome`、`PEITHO_CHROME_PATH`かPATH)CDPの`Page.printToPDF`を
  呼ぶ(`crates/peitho/src/cdp.rs`)。**Chrome/CDPの部分はCLIクレートに
  だけあり、Studioが埋め込んでいるpeitho-coreにはない。**
- `resolution`はPDFのページ寸法。既定はaspect_ratioから決まり、
  aspect_ratioと比率が一致し、キャンバス寸法以上である必要がある
  (`domain.rs:84-150`)。
- Studioには書き出し機能がまだない。CLIを呼んでいるのは`peitho present`
  だけ(`peitho.rs:782-796`)で、CLIが見つからない問題は
  `todo/peitho-cli-discovery.md`で扱っている。PDF出力も同じ問題に加えて
  Chromeの有無の問題を抱える。

## 決めること

- CLIの`peitho export pdf`を呼ぶか、Studio側でPDFを作るか。
- Chromeが見つからないときの案内。
- 書き出し先の選び方(保存ダイアログ)と、Fileメニューへの配置。
- `resolution`をどこで設定するか(Deckメニューの候補、書き出し時の
  選択など)。
