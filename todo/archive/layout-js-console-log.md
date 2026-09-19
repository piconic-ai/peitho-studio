---
status: done
description: レイアウトHTMLにscriptを書けば実際に動く世界観にする — Studio/peitho present/peitho build全経路で実機確認済み。kfly8/peitho(PR#1-#3)・barefootjs(piconic-ai/barefootjs#3051,#3052)ともコミット・マージ済み。mizzy/peitho本家への上流PRのみ先送り。
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

### 続報(2026-09-16): kfly8が実機(`bunx tauri dev`)で確認 →
`data-bf`マウント問題も解消

kfly8が実際に`/Users/kfly8/src/github.com/piconic-ai/barefootjs/site/core/
slides/overview`のデッキを`bunx tauri dev`で開いたところ、動画(1枚目)・
Arcadeゲーム(12枚目)・他のコンポーネント(Compiler/Trace/Terminal/
Showcase)いずれも動いていないと報告。原因は2つ重なっていた:

1. **アセット配信の欠落**: `engine::serve::AssetServer`は
   `image_assets`(peitho-coreがmarkdown画像記法から発見したものだけ)
   にあるファイルしか`assets/<name>`で返さない。`hero.mp4`/`hero.jpg`
   (layoutの`<video>`/`poster`から参照、markdown画像記法を経由しない)
   や`assets/deck.js`のようなファイルは404だった。
   - 修正: `RenderOutput`にデッキ自身のディレクトリ(`deck_dir`)を
     追加し、`image_assets`に見つからない`assets/<name>`要求は
     `deck_dir/assets/<name>`から直接読むフォールバックを追加
     (`DraftImageResolver`と同じパストラバーサル対策付き)。
     content-typeテーブルもvideo/js/json/css用に拡張
     (`type="module"`スクリプトは誤ったMIMEタイプだとロード自体
     拒否されるため重要)。Rustテスト8件追加、既存87件と合わせて
     グリーン。
2. **`data-bf`+`MutationObserver`のShadow DOM非対応**(前回の
   「先送り事項」で指摘した問題)。解消策として、`dom/slideCanvas.ts`
   の`mountSlideCanvas`/`patchSlideCanvas`が(再)マウントのたびに
   `host`から`CANVAS_MOUNTED_EVENT`(`'peitho:canvas-mounted'`、
   `bubbles: true, composed: true`、`detail: { root: shadow }`)を
   発火するようにした。`composed: true`によりlight DOM側の
   リスナーまでイベントが届く。e2e 2件で、初回マウント・編集後の
   再パッチいずれでもイベントが正しいshadow rootと共に届くことを
   検証。

### 続報2(2026-09-16): DevToolsコンソールで実機デバッグ → 追加で3件のバグを発見・修正、全コンポーネント動作確認完了

前回時点の修正(アセット配信フォールバック+CustomEvent橋渡し)を
入れた状態でも、kfly8からは「動画・Arcadeは相変わらず見れない。
デバッグ方法を疑っている」との指摘。まずキャプチャで実際の表示状態を
確認し、次に(devtools:trueを一時的に有効化して)実機の`bunx tauri
dev`アプリでDevTools Consoleを直接使ってデバッグする方針に切替え、
以下3件の未発見バグを特定・修正した(いずれも単体テストだけでは
検出できず、実機のWKWebView + 実CORS + 実DevToolsコンソールで
初めて顕在化したもの):

1. **`poster`属性が絶対URL化されていなかった**: `domain/
   slideFragment.ts`の`FRAGMENT_ASSET_SRC_PATTERN`は`src="assets/…"`
   だけを見ており、`<video poster="assets/hero.jpg">`のような`src`
   以外の属性は無視されていた。実機コンソールで
   `Failed to load resource: 404 → http://localhost:3003/assets/hero.jpg`
   を確認(Studio自身のdevサーバーの方に解決されてしまっていた —
   本来はRustの`AssetServer`の動的ポート宛であるべき)。
   - 修正: パターンを`/(\s)(src|poster)="(assets\/[^"]*)"/g`に拡張し、
     `absolutizeSrcAttributes`もキャプチャした属性名を使うよう変更。
     テスト2件追加(`domain/slideFragment.test.ts`、`poster`を
     正しく絶対化するspec + `data-poster`のような紛らわしい属性名を
     誤検出しないadversarial)。
2. **`AssetServer`のレスポンスにCORSヘッダーがなかった**: `<script
   type="module" src="…">`は通常のスクリプトと違い、たとえ200が
   返っていてもCORSヘッダーがなければ実行そのものを拒否される。実機
   コンソールで
   `Origin http://localhost:3003 is not allowed by
   Access-Control-Allow-Origin. Status code: 200 →
   http://127.0.0.1:.../assets/mount.js`
   を確認(前回セッションで追加したdeck_dirフォールバック自体は
   正しく機能し200を返していたが、CORSヘッダーがないため
   ブラウザ側が実行を拒否していた)。
   - 修正: `src-tauri/src/engine/serve.rs`の`AssetServer::start()`で
     全レスポンス(成功・404両方)に`Access-Control-Allow-Origin: *`
     を付与。生のTCPソケットで実サーバーに接続するRust統合テスト
     (`asset_server_spec_every_response_allows_cross_origin_reads`)
     を追加、修正前は実際に失敗することを確認。
3. **`<video>`がRangeリクエストに対応していなかった**: 上記2件を
   修正してもposter画像は表示されるようになったが、動画自体は
   `paused: true, currentTime: 0, readyState: 0, networkState: 3`
   (`NETWORK_NO_SOURCE`)のまま止まっていた。`curl -H "Range:
   bytes=0-1023"`で実サーバーを直接叩いたところ、Rangeヘッダーの
   有無にかかわらず常に`200 OK`+`Transfer-Encoding: chunked`(ボディ
   全体)を返すだけで、`206`/`Content-Range`/`Accept-Ranges`は
   一切返していないことを確認。WKWebViewの`<video>`はRange対応
   サーバーでないと初期化自体を拒否する(Chromiumより厳格な挙動)。
   - 修正: `parse_range_header`(`bytes=start-end`/`bytes=start-`/
     `bytes=-suffix`の単一レンジのみサポート、複数レンジ・不正な
     範囲・空リソースは`None`)を追加し、`AssetServer::start()`の
     レスポンス組み立てで`Range`ヘッダーがあれば`206`+
     `Content-Range`+`Accept-Ranges`、なければ`Accept-Ranges: bytes`
     付きの通常レスポンスを返すよう変更。Rustテスト11件追加(純粋な
     `parse_range_header`のspec/adversarial8件+実サーバーに対する
     TCP統合テスト2件、うち206系は修正前に実際に失敗することを確認)。

**実機再検証(すべてDevToolsコンソールで直接確認)**:
- 動画: `paused:false`かつ`currentTime`が時間経過で進行
  (5.6秒→21.6秒)していることを2回のクエリで確認。ポスター画像
  だけでなく実際に再生されている。
- Arcade(12枚目): スコア・WAVE・LEVEL・エイリアンスプライト・
  GAME START/DEMOボタンまで含め完全にレンダリングされることを
  スクリーンショットで確認。
- Terminal(13枚目 “One command.”)・Showcase(11枚目)も同様に
  完全にレンダリングされることを確認。
- DevTools ConsoleのErrorsフィルタで、これら全スライドを表示した後も
  エラーが0件であることを確認。

barefootjs側(`site/core/`)も、kfly8の許可のもと編集・実機同等の
検証まで実施(未コミット):
- `component/mount.ts`: `document`レベルの素朴なMutationObserver
  (light DOM、`peitho build`の配布ビューア向けにそのまま維持)に加え、
  上記`CANVAS_MOUNTED_EVENT`を購読して`event.detail.root`だけを
  対象にマウントする経路を追加。
- `scripts/build-slides.ts`: 既存の「mount.ts+narration.ts合体+
  index.htmlのheadに注入」という`assets/deck.js`はそのまま維持しつつ
  (公開サイト専用のchrome機能ぶん)、**narration.tsを含まない
  mount専用バンドル**を新たに`assets/mount.js`としてビルドし、
  **デッキ自身のソースディレクトリ**(`slides/overview/assets/`、
  ビルド出力ではなく)に直接書き出すようにした。narration.tsは
  `document.body`に無条件でプログレスバー等のchrome UIを注入するため、
  present/Studio(このバンドルを直接読み込む側)に混入させると
  実害がある。
- 7つのlayout(arcade/compiler/cover/live/showcase/terminal/trace)
  それぞれに`<script type="module" src="assets/mount.js"></script>`
  を追加。ESモジュールはURL単位で重複評価されないため、複数layoutに
  同じタグがあっても実害なし。
- **実機同等の検証**: `bun run slides:build overview`で実際に
  `assets/mount.js`(160KB、narration関連の識別子を含まないことを
  確認)をビルドし、Playwrightで実ブラウザに読み込んで(a)light DOM
  で`data-bf="Rotator"`が実際にBarefootJSでレンダリングされること、
  (b)Shadow DOM + `CANVAS_MOUNTED_EVENT`経由でも同様に動くことの
  両方を確認(いずれも実際のレンダリング結果`<p class="tagline"...
  Your stack...out.</p>`が現れることを確認)。`peitho build deck.md`
  でのビルド自体も、layoutへのscriptタグ追加後も壊れていないことを
  確認済み。

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
- [x] アセット配信のフォールバック(`engine::serve.rs`)+ Rustテスト8件
- [x] `CANVAS_MOUNTED_EVENT`によるShadow DOM橋渡し + e2eテスト2件
- [x] `bun test` / `bun run typecheck` / 全e2e(51件) / `cargo test`
      (99件)すべてグリーン

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
- [x] 実機確認(Studio側) — kfly8が`bunx tauri dev`で実際に確認し、
      動画・Arcade・他コンポーネントいずれも動いていないと報告
      (2026-09-16)。上記の追加修正(アセット配信+CustomEvent橋渡し+
      barefootjs側mount.js)を入れた後も動画・Arcadeは動いておらず、
      DevToolsコンソールでの実機デバッグにより`poster`絶対化漏れ・
      CORS未対応・Range未対応の3件を追加で発見・修正(続報2参照)。
- [x] 追加修正後の実機再確認(Studio側、`bunx tauri dev`で
      `barefootjs/site/core/slides/overview`のデッキを開き、動画・
      Arcade・Terminal・Showcaseがすべて動くこと) — 2026-09-16、
      DevToolsコンソールで直接確認済み(続報2参照)。
- [x] Compiler/Traceの実機確認 — 別セッションでこの2つの自動デモが
      「めくる前から動いている」バグを発見・修正(`peitho:slidechange`
      でリセット)、`peitho present`実プロセスに対するPlaywright検証で
      確認済み(barefootjs側でコミット、後述)。
- [x] `kfly8/peitho`側のコミット・PR化 — asset copy fallback・Range
      request・script re-execution・shadow-mounted eventを含む3PRを
      作成しマージ済み(kfly8/peitho#1, #2, #3)。peitho-studioの
      `peitho-core`依存もこのforkに切り替え済み。
- [x] barefootjs側のコミット・PR化 — Shadow DOM mount bridge +
      Trace/Compilerの自動デモタイミング修正 + ビルド簡素化を
      `piconic-ai/barefootjs#3051`、CI/デプロイのpeitho調達をkfly8/peitho
      ソースビルドに切り替える変更を`#3052`としてPR化、pullfrogレビュー
      対応込みでともにマージ済み。

## 先送り事項

- **`mizzy/peitho`への上流PR**: `kfly8/peitho`に実装・テストは揃って
  マージ済みだが、本家`mizzy/peitho`へのissue/PR化はまだ行っていない。
- **状態持続性の経路間の違い**(present: 初回のみ実行・持続 / build・
  Studio: 訪問/編集のたびに再実行・古いタイマー等は残ったまま)を
  統一するかどうかは意図的に未決着(kfly8: 「悩む場合は一旦様子見」)。
- **作業中の事故(復旧済み)**: 検証用の一時ビルド成果物を消すつもりで
  `barefootjs`リポジトリの`site/core/public/`を丸ごと`rm -rf`した際、
  同ディレクトリ配下の追跡対象ファイル4件
  (`site/core/public/static/snippets/*.txt`)も巻き込んで削除して
  しまった。`git checkout --`で即座に復元し実害なし。以後、削除前に
  対象ディレクトリの追跡状態を確認する。
