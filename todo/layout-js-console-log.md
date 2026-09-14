---
status: todo
description: レイアウトHTML内JavaScriptのconsole logをStudio上で確認できるようにする
tags: [debug, layout, console]
---

# HTMLレイアウトのJavaScriptコンソールログ表示

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: HTMLレイアウトのJavaScriptの問題が出ているときに、
その`console.log`を見れるようにしてほしい。現状、Studioにはそういった
デバッグ用の仕組みが一切ない。

## スコープ

- **目的**: レイアウトHTMLに書かれたJavaScriptのログ/エラーを、
  Studio上で確認できるようにする。
- **やらないこと**: ブレークポイント等の本格的なJSデバッガ機能。
  Present側(配布ウィンドウ)を対象に含めるかは「背景・要調査」の結果
  次第 — 含めないと決まった場合はそれもここに明記する。
- **受け入れ条件**: 要調査(そもそもレイアウトにJSが書ける仕様かが
  未確定)。調査結果が出た時点でこの節を具体化する。

## 背景・要調査(着手前に必ず確認する)

- ユーザー定義のレイアウトHTML(`layouts/*.html`)に`<script>`を書いて
  よい仕様なのか、peitho-core側(`crates/peitho-core/src/layout.rs`)を
  読んで確認する。`layout.rs`にscriptタグ固有の除去/サニタイズ処理は
  見当たらなかった(素通りしている可能性が高い)が確証はない。
- 対象範囲を明確にする — 少なくとも以下のどちらか、あるいは両方:
  - Studio内のプレビュー/サムネイル(`dom/slideCanvas.ts`のShadow DOM。
    iframeと違い同一documentなので実行されたJSは同じ`window`を共有する)。
  - Present実行時(peitho-coreが生成する配布用プレイヤーHTML。
    `crates/peitho-core/src/render.rs`の`render_distribution_index`が
    生成する`<script>`はpeitho本体のプレイヤーロジックであり、レイアウト
    作者が書いたスクリプトとは別物 — 両者を混同しないこと)。

## 方針候補

- Shadow DOM内で実行されるスクリプトはページの`window.console`を
  そのまま使う(Shadow DOMはiframeのような別`window`を持たない)ため、
  `console.log`/`warn`/`error`をラップしてキャプチャし、専用のログパネル
  (StatusBarの近く、または折りたたみ式パネル)に流し込む方式が筋が良さ
  そう。ただしグローバルな`console`のオーバーライドはアプリ自身のログも
  巻き込むため、レイアウト由来のログだけを分離する方法(実行コンテキストの
  タグ付けなど)を設計する必要がある。
- Present側(実際に配布・投影されるウィンドウ)まで対象にする場合は、
  Studio側の仕組みとは別に、プレゼンウィンドウのWebviewWindowから
  ログを吸い上げる経路(Tauriのwebview console event等)が必要になる
  可能性がある — Rust側の調査が要る。

このタスクは技術的な前提(そもそもレイアウトにJSが書けるか)がまだ
裏取りできていないため、実装着手前にFableと方針を詰めること。

## 完了条件

自動で確認できる項目:
- [ ] 実装(決定した方式) + テスト
- [ ] `bun test` / `bun run typecheck` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] レイアウトHTMLへのJS埋め込みが仕様として認められているか調査
- [ ] 対象範囲(プレビューのみ/Presentも)を決定・スコープ節を更新
- [ ] 実装方式をFableと相談の上決定
- [ ] 実機確認

## 先送り事項

(実装時に見つかった、本筋と無関係な改善点があればここに書き出す)
