# サムネイル一覧の iframe 撤廃 実行計画

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

設計担当: Fable。実装・検証: Sonnet。発端は「スライド枚数が増えるごとに
`SlideList.tsx`の`<iframe>`が増える」というユーザー指摘
(`manifest.slides.map()`の1行=1`<iframe srcdoc>`)。プレビュー枠
(`SlidePreview.tsx`/`Studio.tsx`)は既に選択中スライド用の1個のみで
O(1)。

## 0. 採用方針: Shadow DOM 描画(iframe 0 個)

サムネイル1枚 = ホスト文書内の`<div>`に`attachShadow({mode:'open'})`
し、`peitho.css`由来の共有`CSSStyleSheet`を`adoptedStyleSheets`で当て、
中の`.peitho-slide`を`transform: scale(s)`で縮小表示する。「本物のCSSで
描いた見た目を縮小する」というiframeの存在理由をShadow DOMで満たしつつ、
iframe自体をなくす。

### 却下した案

- **(A) 一覧を1つのiframeに統合**: 内部に全スライドを並べ、クリック/
  右クリック/ドラッグの座標をpostMessageでホスト側へ連携する必要があり、
  しかもiframeである限り右クリックがWKWebViewのネイティブ「Open Frame
  in New Window」メニューに奪われる問題(現行の`SlideList.tsx`の対策)
  が残る。既存の複雑さを別の形に付け替えるだけで難度が下がらない。
- **(B) Canvas/SVGへのラスタライズ**: WKWebView/Tauri v2にDOMを画像化
  するJS APIがなく、SVG `foreignObject`はフォント・外部画像で
  汚染/失敗しうる。Rust側に描画エンジンを足すのは本物のCSSとの忠実度を
  捨てることになる。

段階移行は可能。「一覧1+プレビュー1=計2」を経由する案は捨て作業になる
ため踏まない。PR4完了時点で「一覧0+プレビュー1=合計1」、PR6で
「合計0」に到達する。

## 1. レイヤー配置と役割分担

- **Rust `src-tauri/src/peitho.rs::to_payload`**: `RenderPayload`に`css:
  String`を追加(`engine::pipeline::RenderOutput`は既に`css`フィールド
  を持っている — 追加ではなく配線するだけ)。`engine/`は無変更。
- **`domain/slideCss.ts`(純粋)**: `absolutizeCssUrls(css, base)`
  (`url(theme-fonts/…)`等を絶対化、`data:`/絶対URLは素通し)、
  `splitFontFaceRules(css) → { fontFaces, rest }`、
  `scopeRootToHost(css)`(`:root`セレクタを`:host`に書き換え。
  `--peitho-canvas-width/height`もここに乗せる)。
- **`domain/slideFragment.ts`(純粋)**: `absolutizeFragmentUrls(html,
  base)`(`src="assets/`のみ書き換え)。
- **`domain/geometry.ts`**: `containScale(avail: Size, canvas: Size):
  number`(`Math.min(w/W, h/H) * 1.02`。`previewDoc.ts`の`fit()`の数式を
  移植)。
- **`dom/slideCanvas.ts`(DOM操作のみ、signal禁止)**:
  `createSlideStylesheet(cssText): CSSStyleSheet`、
  `ensureFontFaces(fontFaceCss)`(`<style data-peitho-fonts>`を`<head>`
  に1つ維持)、`mountSlideCanvas(host, sheet, fragmentHtml, canvas)`、
  `patchSlideCanvas(host, fragmentHtml): boolean`(`.peitho-slide`を
  `replaceWith`、`outerHTML`同一ならno-op)、`observeCanvasScale(host)`
  (共有`ResizeObserver`1個で全hostを観測)。
- **`state/renderStore.ts`**: `css`を等値ガード付きsignalに追加、
  absolutize + scopeRootToHost済みの`slideStylesheetText` memo。
- **`components/SlideList.tsx`**: `<iframe>`+オーバーレイ2要素を
  `<div ref={el => mountSlideCanvas(...)}>`1つに置換。`ref`で一度だけ
  マウントする現行方式(fused-effect対策)は維持し、行を子コンポーネント
  に分割しない(`docs/architecture.md`のspike要件を回避)。
- **`components/Studio.tsx`**: `patchSlidePreviewIframes`を
  「`[data-slide-canvas-key]`のhostは`patchSlideCanvas`、
  `[data-slide-preview-key]`のiframeは従来通り」の2系統に分ける
  (PR6で後者も撤去)。css memo変化時に`sheet.replaceSync()`する
  effectを追加。

## 2. 既存DOM調整コードの要否整理

**不要になる**(Shadow DOM化で消える): iframeサイズ同期
(`clientWidth`/overscan/`clip-path`)、コーナー継ぎ目隠しのオーバーレイ
divとボーダー再描画、右クリック奪取対策オーバーレイ、`srcdoc`凍結、
パッチ後の`resize`イベント発火、KNOWN ISSUE(compositing layerの
塗り残し)、選択切替時に全サムネイルの`srcdoc`が再代入される残課題。

**引き続き必要**: ラッパーの`aspect-ratio`(通常要素には効く。壊れて
いたのはreplaced elementのみ)、`pointer-events:none` +
`user-select:none`(通常要素なら正しく透過する)、スケール計測に
`contentRect`を使う(ドラッグ中`scale(0.95)`の混入回避)、
`top/right/bottom/left`個別指定(`inset`ショートハンド禁止、
CLAUDE.md既知の制約)。

**簡素化できる**: 外側/内側2重spanは1要素に統合可能。選択枠を常時
`border-4`(色のみ切替)にすると全サムネイルのcontent-box幅が揃い、
スケール計算が単純になる。

## 3. リスク・実機で検証すべき点(PR3で潰す)

1. Shadow root内(`adoptedStyleSheets`/`<link>`)の`@font-face`が
   WKWebViewで登録されるか。設計上は`@font-face`を`<head>`にhoistする
   前提。実機で効くなら hoist を削れる。
2. `adoptedStyleSheets`の可用性(macOS 26ならSafari 16.4+相当で
   問題ないはず)。フォールバックは各rootへの`<style>`埋め込み。
3. `overflow:hidden; border-radius`がtransform済み子要素を正しく
   丸くクリップするか。
4. theme CSSの`html`/`body`ルールはShadow内で無効(忠実度の小差) —
   許容してCLAUDE.mdのpitfallsに記載する。
5. 50枚級デッキでのメモリ・初期描画時間(Activity Monitorでbefore/
   after比較)。
6. (PR6追加) プレビュー枠でテキスト選択ができる/`http(s)`・相対パス・
   `mailto:`リンクをクリックしても何も起きない(アプリが意図せず遷移
   しない)/サムネイル一覧・レイアウトピッカーの選択・右クリック・
   ドラッグ並べ替えが従来通り機能する、の3点。
7. 実機検証は`run-peitho-studio` skill、Cmd+Shift+Dスナップショットで
   行う。Playwright(ブラウザ)ではWKWebView固有挙動は再現しない。

**進捗メモ(PR3時点)**: `run-peitho-studio`での実機起動を試みたが、
マシンがロック状態にあることに気づかずGUI自動化コマンドを送ってしまう
事故があり中断(ユーザー了承済み、実害なし)。以降のPR3〜PR6は型
チェック・単体テスト・静的コードレビュー(Opus/Pullfrog)のみで進め、
上記1〜5の実機確認はユーザー環境が空いたタイミングで別途まとめて行う。
ユーザー了承の上、PR4以降も旧iframe実装をその都度削除する通常の
進め方で継続する(フィーチャーフラグ的な並行実装はしない — 実機で
問題が出れば追加PRで直す)。

**PR3レビューでの申し送り(PR4実装時に注意)**:
- ホストの`style`はもう`mountSlideCanvas`が`--peitho-canvas-width/
  height`を直接書き込む場所になった。同じホスト要素にBarefootJSの
  リアクティブな`style={...}`(例: `aspect-ratio`用)を後から足すと、
  その再代入でこの2変数が消える。「外側/内側2重spanを1要素に統合」
  する際は、リアクティブな`style`とこの2つの`setProperty`が同じ
  要素で衝突しないよう設計すること。
- `observeCanvasScale`を新しい`canvas`サイズで呼び直しても、
  `ResizeObserver.observe()`は同一targetに対してno-opなので、次に
  実際のリサイズが起きるまでスケールは再計算されない(デッキを開いた
  ままキャンバスサイズが変わるケースのみ影響。現行iframe経路も
  `srcdoc`凍結で同じ制約がある)。

## 4. PRスタック(Draft PR + CI、`gh-stack`で管理)

進行に応じてチェックを付ける。各PR: 実装 → CI → (困りごとがあれば
fableに相談) → レビュー/リファクタリング → Opusにcode-review/
simplify/t-wada why-not ruleでコメント最小化 → CI → Review Ready化 →
Pullfrogレビュー対応。

- [x] **PR1** `render-payload-css`: Rust `RenderPayload`に`css`を追加
      (+ `domain/render.ts`型、`ipc/fakeDeckIpc.ts`更新)。(PR #42)
- [x] **PR2** `slide-css-domain`: `domain/slideCss.ts`・
      `slideFragment.ts`・`geometry.ts`(純粋関数) + spec/adversarial
      テスト(空文字、`url()`の引用符あり/なし、`data:`、`url(#id)`、
      大文字小文字、`:root:not()`等)。実装時判明: peitho-coreの
      フラグメント出力(`render.rs`)は常にダブルクォート
      (`src="assets/..."`)のみで、シングルクォートは契約に含まれない
      ため対応不要と判断(PR #43)。
- [x] **PR3** `slide-canvas-dom`: `dom/slideCanvas.ts` +
      `renderStore`のcss signal/memo。(PR #45)。WKWebView spike
      (上記リスク1〜3)の実機確認はロック事故で中断、静的チェックのみで
      進行(2章末の進捗メモ参照)。
- [x] **PR4** `slidelist-shadow-dom`: `SlideList.tsx`/`Studio.tsx`の
      置換、旧iframeコード削除完了(コード上はサムネイル一覧のiframeが
      0個、合計iframeは1個(プレビュー枠のみ)に到達)。実機検証記録は
      WKWebView spikeと合わせて後日まとめて行う。レビューで補った3点:
      PR2の`absolutizeFragmentUrls`が未配線だった
      (`renderStore.canvasFragmentOf`として配線)、`:host`の
      `pointer-events`/`user-select`が抜けていた(2章の「引き続き必要」
      通りに復元)、外側/内側2重spanを1要素に統合(2章の「簡素化できる」)。
      あわせてCLAUDE.mdに新pitfall(propに`const`を直接渡すと初期化式ごと
      インライン展開される)を追記。
- [x] **PR5** `layout-picker-shadow-dom`: レイアウトピッカー
      (`SlideContextMenu.tsx`)も同じcanvasに置換完了、
      `buildLayoutPreviewDoc`撤去。レビューで補った点: プレビュー用CSSも
      `scopeRootToHost` + `@font-face`除去を通す
      (`uiStore.layoutPreviewStylesheetText`)。`preview_layouts`は
      `build_theme_css`(deckのcssファイルをそのまま連結)を経由するので
      実スライドと同じテーマCSS = `:root`宣言も同じように入りうる。
      旧iframe版は完全なHTML文書だったため`:root`が効いていた =
      無変換のままだとテーマ変数がShadow DOM内で落ちるデグレになる。
      absolutizeだけは引き続き不要(アセットサーバーが解決できる相対
      `url()`は`theme-fonts/*`のみで、それらは除去する`@font-face`の中に
      あり、実デッキ側が`<head>`に絶対化済みで1つhoist済み)。
      (実機検証は他項目とまとめて後日)。
- [x] **PR6** `preview-pane-shadow-dom`: プレビュー枠もShadow DOM化、
      `previewDoc.ts`(+テスト)・`renderStore.buildSlideDoc`削除、
      `<iframe>`要素はコードベース全体で0個に到達。副産物: iframeが
      無くなったことで`dom/columnResize.ts`の右クリック/drag中
      pointer-events対策も不要と判断し削除(Shadow DOMは別の
      browsing contextではないため、mousemoveが遮られる問題自体が
      発生しない)。iframe時代の古いコメント(`docs/architecture.md`
      の手動検証項目、`docs/architecture.ja.md`、CLAUDE.md含む)も更新。
      レビューで見つかった重大バグ2件を修正: (1)
      `ref`内で条件分岐された要素に対し`createEffect`を呼ぶと、
      BarefootJSはbranch再突入のたびに古いeffectをdisposeせず
      増殖させる(選択スライド切替のたびにeffectが1つずつ増え、
      detachされたhostへのmountSlideCanvas/observeCanvasScaleを
      永久に実行し続けるリーク)。両方の子を常時マウントし`hidden`
      で切り替える方式に変更して解消、CLAUDE.mdに新pitfallとして
      記録。(2) `patchSlideCanvas`の`outerHTML`比較によるno-op判定が、
      `breaks: true`のデッキで常に不一致になり、打鍵のたびに全
      サムネイル+プレビュー枠が再構築されていた(PR3/PR4由来の
      既存バグ)。適用済みfragment文字列を`WeakMap`で保持する方式に
      修正。Pullfrogレビュー(#48)で重大な見落としを指摘: サムネイル用の
      `pointer-events:none; user-select:none`が無条件で全呼び出しに
      適用されており、プレビュー枠(旧iframeでは完全にインタラクティブ
      だった)がテキスト選択・クリック不可になっていた。fableに設計相談
      の上、`mountSlideCanvas`に`mode: 'thumbnail' | 'interactive'`を
      追加し、interactiveでは制約CSSを外しつつ、スライド内`<a href>`の
      クリックだけJSでpreventDefault(Shadow DOMはiframeと違い同一
      documentなので、リンクにアプリ全体が遷移してしまうのを防ぐため)。
      (実機検証は他項目とまとめて後日)。

**PR1〜PR6 Review Ready化後に見つかった重大バグ(実機検証中)**:
ユーザーが実機でNew Slide機能(右クリック→New Slide)を試したところ、
サムネイルが増えないという報告があった。実機での対話的デバッグは
手間がかかりすぎるため、Playwrightで`window.__TAURI_INTERNALS__.invoke`
をモックする恒久的なe2eテスト基盤(`e2e/helpers/mockTauri.ts`、
`domain/slides.ts`をNode側でpeitho-core代替として動かす)を新設し、
自律的に再現・特定した。原因はPR3の`mountSlideCanvas`: `SlideList.tsx`の
新規行の`ref`は、その要素がまだBarefootJSの`.map()`が構築中の
detached「template contents document」に属した状態で呼ばれ(`host.
ownerDocument`は実文書のままだが`host.isConnected`はfalse)、その状態で
`CSSStyleSheet`を`adoptedStyleSheets`に代入すると`NotAllowedError:
Sharing constructed stylesheets in multiple documents is not allowed`が
投げられる。`StatusBar`のエラー表示スロット自身も同じdetached-row問題を
初回条件分岐レンダリングで抱えているため、このエラーは画面上どこにも
表示されず、New Slideのコミット処理全体が黙って中断していた。
`mountSlideCanvas`冒頭に`host.isConnected`チェックを追加し、未接続なら
`queueMicrotask`で1回遅延させる修正をPR3に追加、PR4に回帰テスト
(`e2e/new-slide.e2e.ts`)を追加し、`gh stack rebase --upstack`で
PR4〜PR6に反映・再検証した。Pullfrogレビュー(#45)がさらに、同一
synchronous tick内で行が追加後すぐ削除された場合に`isConnected`が
永久にfalseのままとなり`queueMicrotask`の再試行が無限ループする
(クロージャの永久リーク)ケースを指摘、`MAX_MOUNT_RETRIES`(5回)を
上限とする修正を追加PR3コミットとして反映した。

## 5. 完了条件

- [x] PR1〜PR6すべてDraft PR作成・Review Ready化・Pullfrogレビュー
      対応済み(マージはユーザー判断)。
- [x] `grep -rn "<iframe" components domain dom` が0件(コメント上の
      歴史的言及のみ残存、実要素は0)。
- [x] `bun test` / `bun run typecheck` / `bun run build`が全てグリーン。
      Rust `cargo test`はPR1で確認済み(以降Rust側の変更なし)。
      e2e smokeは未実行(Welcome画面より先を検証しないため今回の変更
      と無関係、既存の`test:e2e`はそのまま維持)。
- [x] CLAUDE.mdのPitfallsセクションに、静的レビューで判明した新知見は
      既に追記済み(propに`const`を直接渡すと初期化式ごとインライン
      展開される問題、条件分岐された`ref`内の`createEffect`がbranch
      再突入のたびにリークする問題)。実機でしか分からない知見
      (`@font-face`/`adoptedStyleSheets`等)は下記の実機検証後に追記する。
- [ ] **残タスク**: 3章のリスク1〜6(`@font-face`登録、
      `adoptedStyleSheets`可用性、`border-radius`クリップ、`html`/
      `body`ルールの非適用、大規模デッキでのメモリ/描画時間、プレビュー
      枠のテキスト選択・リンク無効化・サムネイル操作の非デグレ確認)の
      実機WKWebView検証。ユーザーのマシンが利用可能になり次第、
      `run-peitho-studio` skillで実施し、結果をこの計画書とCLAUDE.md
      に記録する。
