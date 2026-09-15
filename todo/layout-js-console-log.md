---
status: wip
description: レイアウトHTMLにscriptを書けば実際に動く世界観にする(Studio側は実装済み、mizzy/peitho側は検証済み未コミット)
tags: [debug, layout, console, script-execution]
---

# HTMLレイアウトのJavaScriptコンソールログ表示

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: HTMLレイアウトのJavaScriptの問題が出ているときに、
その`console.log`を見れるようにしてほしい。現状、Studioにはそういった
デバッグ用の仕組みが一切ない。調査の過程で「そもそもレイアウトの
`<script>`が(Shadow DOM化以降)どこでも実行されていない」ことが
判明し、専用ログパネルより前に「まずscriptが動く」こと自体が前提
条件だと分かった。壁打ちの結果、「HTML/CSSだけでなくJSも動く世界観に
したい」という方向に発展し、スコープをPresent・Studio両方に広げた。

## スコープ

- **目的**: レイアウトHTMLに書かれたJavaScriptが、Studio・
  `peitho present`・`peitho build`のどの経路でも実際に実行されるように
  する(専用のconsole log表示パネルは今回作らない — script実行が
  復活すれば既存のWeb Inspector/ブラウザDevToolsでそのまま見える)。
- **やらないこと**: ブレークポイント等の本格的なJSデバッガ機能。
  専用ログパネルUI(アプリ自身のログと混ざる問題への対処含む)。
  Shadow DOM対応の`data-bf`+`MutationObserver`マウントパターン(別問題、
  上記「対象範囲の選択肢」参照)。script実行ごとの状態持続性を
  present/build/Studio間で統一すること(様子見中)。
- **受け入れ条件**: Studio・`peitho present`・`peitho build`いずれでも、
  layoutに直接書いた素朴な`<script>`(`console.log`含む)が実際に
  実行され、同じlayoutを複数スライド/複数回訪問しても「既に宣言済み」
  エラーが出ない。Studio側は`bun test`/`bun run typecheck`/e2eグリーン
  で達成済み。`mizzy/peitho`側は実証済みだが上流へのPRがまだ。

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

### 対象範囲の決定(kfly8確認、2026-09-15): (A)+(B)両方、フォークで実証済み

「HTML/CSSだけでなくJSも動く世界観にしたい」という方針のもと、(A)
Studioのプレビュー/サムネイルと(B)Present両方を対象にすることに決定。
`/Users/kfly8/src/github.com/kfly8/peitho`(`mizzy/peitho`のfork)で
実際に検証・実装まで済ませた:

- **"re-execute injected script"パターン**: `innerHTML`でパースされた
  `<script>`は仕様上「既に開始済み」フラグが立ち、DOM上のどこに移動
  しても二度と実行されない。属性とソースをコピーした新しい`<script>`
  要素(`document.createElement('script')`)で置き換えると実行される。
- **`peitho present`のプレイヤー**(`packages/peitho-present/src/
  shell.ts`、Shadow DOM方式): `scripts.ts`に`executeInlineScripts`を
  新設し配線。Vitestで構造的な検証4件+実ブラウザ(Playwright、CDP経由の
  `console`購読)で`peitho present`実プロセスを起動して`console.log`/
  `warn`/`error`/`setInterval`すべて動くことを確認。
- **`peitho build`の配布ビューア**(`crates/peitho-core/src/render.rs`
  に埋め込まれた別の軽量スクリプト、light DOM方式・
  `canvas.innerHTML = slides[next].html`): 同じ仕組みを移植し、Rust
  テスト3件追加(既存14件+新規3件、計17件グリーン)。実際に`peitho
  build`した静的HTMLをブラウザで動かし、初回ロード・スライド間移動・
  再訪問いずれでも`console.log`が出て`pageerror`が出ないことを確認。
- **重要な追加発見(scope wrap)**: kfly8指摘「スライドごとにスコープを
  包んであげる方がライブラリとして親切」を受け、classic inline
  script(`src`なし・`type="module"`でない)を`(function () { ... })();`
  で自動的にIIFE包みする改善も両実装に追加。理由: 1ページに1つしかない
  JSグローバルスコープを、Shadow DOMもlight DOMの差し替えも分離しない
  ため、同じlayoutが複数スライドに使われる(present)/同じスライドに
  再訪問する(build)と、トップレベルの`let`/`const`が「既に宣言済み」
  エラーになる(実際に2枚同じlayoutのデッキで再現・修正確認済み)。
  `type="module"`は自前のモジュールスコープを持つので対象外、`src`
  付きは包みようがないので対象外。
- **状態の持続性は経路ごとに違う(未解決、意図的に様子見)**: `peitho
  present`は全スライドのcanvasを最初に作って残す(選択切替のみ)ため
  scriptは初回のみ実行され状態が持続する。`peitho build`の配布
  ビューアとStudioの`patchSlideCanvas`は毎回`innerHTML`を差し替える
  ため、訪問/編集のたびにscriptが再実行され、かつ古い`setInterval`等
  は自動停止しない(タイマーが積み上がる)。どちらを「正」とするかは
  kfly8曰く「悩む場合は一旦様子見」— 統一を急がず現状のまま。
- **`kfly8/peitho`側の変更は検証済みだが未コミット**(2026-09-15
  時点)。上流(`mizzy/peitho`)へのPR化はまだ行っていない。
- **`data-bf`+`MutationObserver`によるBarefootJSコンポーネント
  マウント(barefootjs公式サイトのdeck例で実際に使われている手法)は
  別問題として残っている**: `document.querySelectorAll`/
  `MutationObserver`はデフォルトでShadow DOMの中まで届かないため、
  `peitho present`(Shadow DOM)やStudioでは動かない
  (`peitho build`の配布ビューアはlight DOMなのでそのまま動く)。
  Shadow DOM対応のmounter(各shadow root個別にobserveする、または
  マウント完了を`composed: true`のCustomEventで橋渡しする、など)は
  今回のtodoのスコープ外とし、着手していない。

### Studio側の実装(このリポジトリ、実装・テスト済み)

`dom/slideCanvas.ts`に`executeInlineScripts`(kfly8/peitho の
`scripts.ts`と同じロジック: script要素の作り直し+classic inline
script のIIFE自動包み)を追加し、`mountSlideCanvas`(初回マウント)と
`patchSlideCanvas`(編集のたびの差し替え)の両方に配線。`dom/`は
ユニットテスト対象外(CLAUDE.md)のため、`e2e/helpers/mockTauri.ts`に
`fragmentFor`オプション(スライドのフラグメントHTMLをテストごとに
差し替え可能にする)を追加し、`e2e/layout-script-execution.e2e.ts`で
(1)サムネイルマウント時にscriptが実際に実行されること、(2)編集で
`patchSlideCanvas`がscriptを再実行しても`let`の再宣言エラーが出ない
ことを検証。修正前は両方とも実際に失敗することを確認済み。

## 方針

上記の通り決定・実装済み。残る作業は「先送り事項」参照。

## 完了条件

自動で確認できる項目:
- [x] Studio側の実装(`dom/slideCanvas.ts`の`executeInlineScripts`) +
      テスト(`e2e/layout-script-execution.e2e.ts`、修正前に実際に
      失敗することを確認済み)
- [x] `bun test` / `bun run typecheck` / 全e2e グリーン(Rust変更なし)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] レイアウトHTMLへのJS埋め込みが仕様として認められているか調査 —
      調査済み(上記「背景・要調査」参照)。書ける・除去されない。ただし
      Studioのプレビュー/サムネイルでは現状**実行すらされない**という
      追加の前提条件が判明した。
- [x] 対象範囲を決定 — kfly8確認: (A)Studio + (B)Present + `peitho build`
      配布ビューアの全経路が対象(2026-09-15)。
- [x] 実装方式をkfly8と壁打ちの上決定 — "re-execute injected script"
      パターン+classic inline scriptのIIFE自動包み。専用ログパネルは
      作らない方針も確認済み。
- [ ] 実機確認(Studio側、`run-peitho-studio` skillで)

## 先送り事項

- **`mizzy/peitho`への上流PR**: `/Users/kfly8/src/github.com/kfly8/peitho`
  (fork)に、present側(`packages/peitho-present/src/scripts.ts`+
  `shell.ts`配線)・build側(`crates/peitho-core/src/render.rs`)両方の
  実装・テストが揃っているが、まだコミット・PR化していない。
- **状態持続性の経路間の違い**(present: 初回のみ実行・持続 / build・
  Studio: 訪問/編集のたびに再実行・古いタイマー等は残ったまま)を
  統一するかどうかは意図的に未決着(kfly8: 「悩む場合は一旦様子見」)。
- **`data-bf`+`MutationObserver`によるBarefootJSコンポーネント
  マウントパターンのShadow DOM対応**(`peitho present`・Studioでは
  今のmount.tsのまま動かない — 上記「対象範囲の選択肢」参照)は
  今回未着手。barefootjsサイトの`overview`デッキ(動画背景+Arcadeゲーム)
  を実際にStudio/present上で動かすには、この対応も別途必要。
