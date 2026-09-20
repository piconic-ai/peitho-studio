---
status: wip
description: プレビューでPC表示/スマホ表示を切り替えられるようにする(設計確定済み。キャンバス寸法契約 + Container Queries、実装はPR-A/PR-Bの2本)
tags: [ui, preview, viewport]
---

# プレビューのPC/スマホ表示切り替え

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: previewにPC表示、スマホ表示の切り替えボタンを
用意してほしい。

先行調査(PR #68)は「peitho-coreの出力がビューポート非依存なので意味の
ある差は出ない」と結論したが、これは**peitho-core単体についてしか言えて
いなかった**。ビューアが`--peitho-canvas-height`を上書きし、デッキが
それに反応するCSSを持てば縦長レイアウトを組める(実例: barefootjsの
overviewデッキ)。この結論は撤回し、下の「調査結果」に訂正を残す。
設計はFableに依頼して確定した(実装はまだ)。

## スコープ

- **目的**: Studioのプレビューペインに、PC(デッキ本来のキャンバス)と
  スマホ(縦長キャンバス)を切り替えるトグルを置き、スマホ表示のときに
  デッキのレイアウトが実際に縦長向けに切り替わった状態を確認できる
  ようにする。
- **やらないこと**:
  - peitho-core本体の改修(契約の明文化・`container-type`追加は任意の
    別タスクPR-Dで、出す先は`kfly8/peitho`。Studio単体の実装には不要)。
  - barefootjs overviewデッキ側の移行(`bf-compact`→`@container`。別
    リポジトリの提案PR-C)。
  - サムネイル一覧・レイアウトピッカーをトグルに追従させること
    (プレビューのみ)。
  - 端末プリセットの選択UI・トグル状態の永続化(390x844の1種固定、
    セッション内のみ)。
  - `body.bf-compact`のようなデッキ固有のbodyクラスを、Studioがシミュ
    レートすること。
- **受け入れ条件**:
  - トグルを押すと、プレビューのhostの`--peitho-canvas-height`が
    `effectiveCanvas`の値(1280x720のデッキ+390x844 → `2770px`)になり、
    PCに戻すと元の値に戻る。`data-canvas="fixed"`のスライドでは変わらない。
  - サムネイル一覧・レイアウトピッカーはトグルの影響を受けない。
  - デッキのCSSが`@container`(キャンバス自身の形に対するクエリ)で
    分岐していれば、スマホ表示でその分岐が発火する(e2e: mockのペイロード
    の`css`に`@container`を入れて確認)。
  - トグル後、プレビューの`--peitho-thumb-scale`がhostの現在サイズに
    追従している(`observeCanvasScale`の再フィット修正)。

## 背景・調査結果

### 契約の候補と結論(Fableの設計 + scratchpadでの検証)

推奨契約: **キャンバス寸法契約**。ビューアが`--peitho-canvas-width/
height`を渡し、デッキは`.peitho-slide`自身に`container-type: size`を
置いて`@container`のサイズクエリで分岐する。スライド単位の除外は
`data-canvas="fixed"`(root `<section>`)。現状これを尊重するのは
barefootjs overviewの`narration.ts`だけ(peitho-coreは定義していない)で、
この契約はStudioを含む全ビューアが尊重する対象に広げる。

| 候補 | ビューア中立 | Studio(Shadow DOM)で動く |
|---|---|---|
| A: `.peitho-slide`にContainer Queries | ◎ 既存変数のみ | ◎ 検証済 |
| B: host/section属性 | △ 3ビューア分の新契約が要る | △ `:root[data-x]`が`scopeRootToHost`で`:host[data-x]`になり**不一致** |
| C: 変数のみ(`calc`) | ◎ | ◎(離散分岐=1カラム化ができない。Aの補助) |
| D: `body.bf-compact`(barefootjs現状) | × ビューア固有 | × hostの外 |
| E: `@container style(--x)` | ○ | Chrome検証済、Safari 18+でpartial。将来の補助 |

検証した事実(Chrome 153 + Playwright、scratchpadの最小HTML。
**WKWebViewでは未検証**):

1. Shadow rootの`adoptedStyleSheets`内の`@container`(`max-aspect-ratio: 1`
   /`orientation: portrait`)が子孫に効く。hostのインライン
   `--peitho-canvas-height`を720→2500→720と書き換えるだけで動的に往復
   する。
2. `:host { --peitho-canvas-height: 720px }`(テーマ由来)があっても、
   hostのインライン宣言が勝つ。既存の`mountSlideCanvas`の書き方のまま
   でよい。
3. サイズクエリはコンテナ自身を変えられない(`.peitho-slide`のpadding
   は64pxのまま)。
4. `:host([data-x])`は一致、`:host[data-x]`は不一致。
5. caniuse(記憶ベースの部分あり): サイズCQはSafari 16.0+。Tauri v2の
   macOS下限でWebKitがCQ非対応の環境があり得る — 実機要確認。
6. **`ResizeObserver.observe()`を同じhostに再度呼んでも、コールバックが
   再発火しない**(Chrome)。現状の`observeCanvasScale`(`dom/
   slideCanvas.ts`)は再呼び出しで`canvasSizes`を更新するだけなので、
   hostがリサイズされない限り`--peitho-thumb-scale`が古いままになる。
   トグルは必ずこれを踏む。デッキの`aspect_ratio`変更時にも同じ潜在
   バグがある可能性(アプリでは未確認)。

### 訂正: PR #68の先行調査

- 撤回: 「意味のある差は出ない」。peitho-core単体は固定キャンバスだが、
  ビューアが`--peitho-canvas-height`を上書きすればデッキ側で縦長レイア
  ウトを組める。
- 事実として残る(先行調査の根拠1〜4): キャンバスは16:9(1280x720)/4:3
  (960x720)の2値のみ、既存ビューアは`transform: scale`で縮小するだけ、
  `render_source(deck_path, source)`にビューポート入力はない、
  `engine/builtin/base.css`に`@media`/`@container`/`container-type`はない。
- 「`@media`はShadow DOM内でもウィンドウ幅で評価される」(Chromiumで確認)
  は正しいが、結論の根拠にはならない: Container Queriesで代替できる。
- 実例: barefootjsの`site/core/slides/overview/`。配布ビューア専用の
  `component/narration.ts`が、幅820px以下のとき`fitCanvas`で高さを
  `1280 * (画面高さ - 下部バー) / 画面幅`に上書きして`--peitho-canvas-
  height`に書き、`body.bf-compact`を付与する。`css/base.css`の
  `body.bf-compact ...`が1カラム化・大きい文字を担当する。
  `data-canvas="fixed"`のスライド(arcade)は16:9のまま。chrome(言語
  切替・ページ数・前後ボタン)は画面下の固定バーに移す。

### narration.tsのうちStudioに必要なもの/不要なもの

- 必要: `fitCanvas`の高さ算出、`data-canvas="fixed"`判定、scale(=既存
  `containScale`)。
- 不要: `dockChrome`/`#bf-bar`/進捗バー/言語切替/`paintChrome`
  (配布ビューア固有のUI)。

## 方針(決定済み)

Fableの設計を採用した。判断を仰いだ5点はすべて推奨のとおり:

1. 除外契約は`data-canvas="fixed"`を継続(barefootjs overviewが既に
   使っている)。
2. スコープはプレビューのみ。サムネイル行の`ref`は一度きりでcanvasを
   捕捉するため、追従には全行の再マウント(#3009系)かhost全走査の
   effectが要り、176px幅の縦長サムネは実用性も低い。レイアウト
   ピッカーも対象外。
3. 端末プリセットは390x844の1種固定。配布ビューアは下部バー分を引く
   ため実機は約1280x2500で、Studioの2770とずれる — これは既知の差として
   受け入れる(Safari UI込みの実効高への変更は将来の判断)。
4. peitho-coreへのdocs/`themes/base.css`変更は任意・後回し。出すなら
   **`kfly8/peitho`(fork)**へ。upstream(`mizzy/peitho`)ではない。
5. `observeCanvasScale`の再フィット修正はPR-B内の**独立コミット**。

## レイヤー配置

- `domain/viewport.ts`(新規・純粋):
  ```ts
  export type ViewportMode = 'desktop' | 'mobile'
  export interface DevicePreset { name: string; width: number; height: number }
  export const DEFAULT_DEVICE: DevicePreset = { name: 'Phone (portrait)', width: 390, height: 844 }
  // Keeps the deck's width, grows the height to the device's proportion
  // (never below the deck's own height). Non-finite / non-positive device
  // dimensions fall back to the deck canvas unchanged.
  export function reshapeCanvas(deck: Size, device: Size): Size
  export function effectiveCanvas(deck: Size, mode: ViewportMode, device: Size, fixedCanvas: boolean): Size
  ```
- `domain/slideFragment.ts`: `hasFixedCanvas(fragmentHtml): boolean`
  (root `<section>`の開始タグだけを見る)。
- `state/uiStore.ts`: `viewportMode` signal + `toggleViewportMode()`。
  永続化なし(列幅と同じセッション内のみ)。
- `components/Studio.tsx`: `previewCanvasWidth`/`previewCanvasHeight`を
  **別々のnumber memo**にする(`effectiveCanvas(render.canvasWidth/
  Height, ui.viewportMode(), DEFAULT_DEVICE, hasFixedCanvas(選択
  スライドのfragment))`)。オブジェクト1個のmemoだと毎キーストローク
  で`SlidePreview`のeffectが再マウントする(`renderStore`がcanvasを
  分離している理由と同じ)。`<SlidePreview canvasWidth={previewCanvas
  Width()} …>`に渡す。`SlidePreview.tsx`のeffect(既にcanvas寸法を
  追跡→`mountSlideCanvas`がhostに変数を書く)は無変更で動く。
- `dom/slideCanvas.ts`: `observeCanvasScale`が既観測hostでcanvasが変わ
  ったとき、即座に`--peitho-thumb-scale`を書き直す。測定は既存の
  `handleResize`と同じ`contentRect`(小数・paddingを除く)に揃える:
  `host.clientWidth/Height`は整数でpaddingを含むため微妙にずれる。
  案: `unobserve`→`observe`し直して観測を最初からやり直す(Chromeでは
  `observe()`の再呼び出しだけでは再発火しなかった。`unobserve`を挟めば
  発火するかは未検証 — 実装時に確認する)。
- `components/SlidePreview.tsx`: ヘッダー行にトグルを足す。
  `viewportMode`/`onToggleViewportMode`(callback prop、setterは渡さない)
  をStudioから受ける。常時マウントで`hidden`切替にし、条件分岐`ref`内に
  `createEffect`を置かない(#2927)。スマホ枠を描くなら`inset-0`は使わず
  `top-0 right-0 bottom-0 left-0`と書く。
- Rust側(`src-tauri/`)は変更なし: レンダリング経路にビューポート入力は
  要らない。

## テスト

- `domain/viewport.test.ts`
  - spec: 1280x720 + 390x844 → 1280x2770、960x720 + 390x844 →
    960x2078、`desktop`・`fixedCanvas: true`では不変。
  - adversarial: device幅0/負/NaN/Infinity → deck不変、device高さ0 →
    deck高さ、横長端末 → deck高さ(縮まない)、1x10000のような極端な
    縦横比、deck自身が0。
  - property: 幅は不変、高さはdeck.height以上、結果は整数。
- `domain/slideFragment.test.ts`(`hasFixedCanvas`)
  - spec: root `<section data-canvas="fixed">`でtrue、属性なしでfalse。
  - adversarial: 子要素にだけ`data-canvas="fixed"`がある、引用符違い
    (`'fixed'`/無引用)、大文字、`<script>`内の文字列、前置コメント、
    空文字。
- `state/uiStore.test.ts`: トグル往復(desktop→mobile→desktop)。
- e2e(`e2e/`、mockTauri): トグル後にpreview hostのインライン
  `--peitho-canvas-height`が`2770px`、fixedなfragmentでは`720px`、
  サムネイルは不変。mockのペイロードの`css`に`@container`を入れれば
  分岐の発火も確認できる。できないこと: WKWebViewの実描画・実デッキCSS。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] PR-A: `domain/viewport.ts` + `hasFixedCanvas` + テスト
- [ ] PR-B: `dom/slideCanvas.ts`の再フィット(独立コミット)、`uiStore`、
      `SlidePreview.tsx`のトグルUI、`Studio.tsx`のmemo、e2e
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `bun run test:e2e`グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機(`run-peitho-studio` skill)での確認: WKWebViewで`@container`
      と`ResizeObserver`の再フィットが期待どおり動くか(Chromeでしか
      検証していない)。Tauri v2のmacOS下限でContainer Queriesが使えるか
- [ ] `container-type: size`(layout containmentを伴う)が実デッキの
      `.peitho-slide`に副作用を出さないか。`position: relative`は
      組み込みテーマ(`src-tauri/src/engine/builtin/base.css`)ではページ
      番号ありの場合だけで、barefootjs overviewのテーマは常時付いている。
      layout containmentは絶対配置の子孫のcontaining blockを変えるため、
      両方のテーマの実デッキで見た目が変わらないか確認する
- [ ] PR-C(barefootjs側の移行提案)を出すか / PR-D(`kfly8/peitho`の
      docs・`themes/base.css`)を出すか

## 先送り事項

- **PR-C(別リポジトリの提案)**: barefootjs overviewが`bf-compact`依存
  をやめる場合、`css/base.css`の`.peitho-slide`に`container-type: size;
  container-name: peitho-canvas`を足し、`body.bf-compact X {…}`を
  `@container peitho-canvas (max-aspect-ratio: 1) { X {…} }`に置換する
  (`html[lang="ja"] …`の複合セレクタもそのまま可)。`body.bf-compact
  .peitho-slide { padding }`だけは自己スタイルなので、内側ラッパに
  移すか`calc()`で表現する。`narration.ts`の`fitCanvas`は既に契約準拠
  で残す。移行中は新旧の規則を併置できる。唯一の退行はSafari 16未満で
  compactレイアウトが消えること。
- **PR-D(任意、`kfly8/peitho`)**: `--peitho-canvas-width/height`と
  `data-canvas="fixed"`を契約としてdocsに明文化する(現状`site/content`に
  記述なし)。`themes/base.css`の`.peitho-slide`に`container-type/name`
  を足し、組み込みテーマのデッキが再宣言なしで`@container peitho-
  canvas`を書けるようにする。
- 端末プリセットの選択UI・永続化、サムネイル/ピッカーの追従は、必要に
  なったら別todoとして切り出す。
- トグルでプレビューが再マウントされ、レイアウトの`<script>`が再実行
  される(選択変更時と同じ既存挙動)。
