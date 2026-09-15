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

### 調査結果(2026-09-15、Sonnetが確認)

- **レイアウトHTMLに`<script>`は書ける。peitho-core側に除去/サニタイズは
  一切ない**。`crates/peitho-core/src/layout.rs`の`parse_layout`は
  `lol_html::HtmlRewriter`で`<section>`と`<slot>`だけを読み取り、
  `Layout.html`には元のHTML文字列をそのまま(`html.to_owned()`)保持する。
  レンダリング時(`render.rs:263`付近)も同じく`<slot>`だけを置換する
  rewriterで、それ以外の要素(`<script>`含む)はバイト列としてそのまま
  素通りする。サニタイズ用クレート(ammonia等)の依存も一切ない。つまり
  `<script>`はスロット置換後の最終スライドHTMLにそのまま残る。

- **重要な新発見: Studioのプレビュー/サムネイルでは、埋め込まれた
  `<script>`は現状まったく実行されない。** `dom/slideCanvas.ts`の
  `mountSlideCanvas`(`shadow.innerHTML = fragmentHtml`)も
  `patchSlideCanvas`(`wrapper.innerHTML = ...`→`replaceWith`/`append`)も
  `innerHTML`経由でフラグメントを挿入している。HTML仕様上、
  `innerHTML`(fragment parsing algorithm)で生成された`<script>`要素は
  「既に開始済み」フラグが立てられ、DOMに挿入されても**絶対に実行されない**
  ("同一documentなので実行されたJSは同じwindowを共有する"という
  `todo/archive/thumbnail-iframe-removal.md`の想定は、そもそも実行される
  ことが前提になっていた点で誤り)。Playwrightで実際に
  `shadow.innerHTML = '<script>...</script>'`と
  `wrapper.innerHTML = ...; shadow.appendChild(wrapper.firstElementChild)`
  の両方を検証し、どちらも`<script>`要素はDOM上に残るが実行されない
  ことを確認済み。旧`<iframe srcdoc>`時代は実文書のパースだったため
  実行されていたはずで、iframe撤廃(Shadow DOM化)によって**Studio上での
  レイアウトJS実行が黙って失われた**可能性が高い(そもそも実際のレイアウト
  でJSを使う例が無ければ実害なしだが、未検証)。

- **Present側は、そもそもTauriのWebviewWindowではない。**
  `src-tauri/src/peitho.rs`の`present_deck`は`peitho present`(別リポジトリ
  `mizzy/peitho`のCLIバイナリ)を完全に独立したOSサブプロセスとして
  `spawn()`するだけ。`peitho`側(`crates/peitho/src/main.rs`の`present`
  関数)はローカルHTTPサーバーを立て、`browser::open_browser_plan`で
  **ユーザーのシステムの実ブラウザ**(Tauri管理下ではない)を開く。
  peitho-studioはこのサブプロセスのstdout(準備完了シグナル用)としか
  繋がっておらず、開かれたブラウザの中身・コンソールには一切アクセス
  できない。Present側のログを拾うには、`peitho`本体をリモートデバッグ
  有効化した状態で起動しCDP等で接続する、といった**mizzy/peitho側の
  大掛かりな変更**が必要で、peitho-studio単独では閉じない。

### 上記を踏まえた対象範囲の選択肢

- **(A) Studioのプレビュー/サムネイルのみ、狭いスコープ**: まず前提として
  `dom/slideCanvas.ts`のmount/patchで、挿入したフラグメント内の
  `<script>`を実際に実行させる仕組み(新しい`<script>`要素を作り直して
  `appendChild`する、いわゆる"re-execute injected script"パターン)を
  追加する必要がある(現状は一切実行されていないため、ここが無いと
  始まらない)。実行されるようになれば同一window/documentなので、
  実は既存のTauri Web Inspector(devtools)のコンソールにそのまま出る
  はずで、「専用ログパネルが本当に要るか」(アプリ自身のログと混ざる
  問題への対処が要るか)は、実際に混ざってみてから決めても遅くない。
- **(B) Present側も含む、広いスコープ**: `mizzy/peitho`側の変更が要る
  cross-repoタスクになり、このtodo単体では完結しない。別タスクとして
  切り出すか、少なくとも`mizzy/peitho`側に対応するtodoを別途起票する
  必要がある。

## 方針候補

(上記調査結果を踏まえて要決定 — 未着手)

## 完了条件

自動で確認できる項目:
- [ ] 実装(決定した方式) + テスト
- [ ] `bun test` / `bun run typecheck` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] レイアウトHTMLへのJS埋め込みが仕様として認められているか調査 —
      調査済み(上記「背景・要調査」参照)。書ける・除去されない。ただし
      Studioのプレビュー/サムネイルでは現状**実行すらされない**という
      追加の前提条件が判明した。
- [ ] 対象範囲((A) Studioのプレビュー/サムネイルのみ / (B) Present込み)
      を決定・スコープ節を更新 — 上記「対象範囲の選択肢」参照。(B)は
      cross-repoタスクになる点に注意。
- [ ] 実装方式をFableと相談の上決定(対象範囲(A)の場合: script再実行の
      仕組み+専用ログパネルの要否。対象範囲(B)を含む場合はmizzy/peitho
      側の設計も要る)
- [ ] 実機確認

## 先送り事項

(実装時に見つかった、本筋と無関係な改善点があればここに書き出す)
