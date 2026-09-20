---
status: wip
description: プレビューでPC表示/スマホ表示を切り替えられるようにする(設計確定済み。キャンバス寸法契約 + Container Queries、実装はPR-A/PR-Bの2本で完了、後から追加したPhone内のshape選択メニューまで実装済み。実機確認が残っている)
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
設計はFableに依頼して確定し、PR-A/PR-Bで実装した(実機確認だけが残っている。
後から加わった要望は「方針」の末尾に記録した)。

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
    セッション内のみ)。ただしPhoneのときに▾のメニューから選ぶ2択の
    shape(Tall / Same ratio as PC、下の「方針」の追加要望3)は含める。
    プリセット(端末の種類)を選ぶUIではなく、shapeもセッション内のみで
    永続化しない。
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
  - (追加要望)ヘッダーのスイッチはアイコン(PC=モニター、Phone=
    スマートフォン)で、文言("PC"/"Phone")を持たない。`aria-label`は
    維持され、各セグメントに`title`が付く。ヘッダー行の下線は無く、
    ピル自身の枠線は残る。ピルは1つだけで、shape用の別ピルは無い。
  - (追加要望)Phoneが選択中のときだけ、Phoneセグメントの右に区切り線と
    ▾が出る(PCのときは`hidden`)。▾を押すとその真下にメニュー(項目は
    Tall / Same ratio as PC。各項目はアイコン+ラベル+1行の説明+選択中の
    チェック)が開き、開くだけではモードもキャンバスも変わらない。
    既定はTallで、hostの`--peitho-canvas-height`は`2770px`。Same ratio
    as PCを選ぶと`720px`(4:3のデッキは幅960で`720px`)、Tallに戻すと
    `2770px`。項目を選ぶ・外側をクリックする・Escを押す・PCに切り替える
    のいずれか(右クリック、▾の再押下、選択スライドが失われたときも)で
    メニューは閉じ、開いている間はEsc以外のショートカット(矢印・Delete
    など)は待つ。メニューは画面内に収まり、キャンバス
    (デッキ自身のz-indexが大きくても)より手前に出る。PC↔Phoneを行き来
    してもshapeは保持され、`data-canvas="fixed"`のスライドとサムネイル
    一覧はshapeの影響を受けず、shape切替でも`--peitho-thumb-scale`が
    追従する。

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

### 後から加わったユーザー要望(2026-09-20、PR #70に追加コミットで実装)

kfly8からの追加要望3点(2026-09-20):

1. **PC/Phoneの文言をアイコンにする。** 依存を足さずインラインSVG
   (lucide風の線画、`aria-hidden`)で書いた。文言を消すぶん、ボタンの
   `aria-label`("Preview as phone")は維持し、各セグメントに
   `title="PC"`/`title="Phone"`を付けた。`data-viewport-toggle`・
   `role="switch"`・`aria-checked`の意味は変えていない。
2. **PC/Phoneを載せているコンテナの境界線をなくす。** 対象はヘッダー
   行の下線(`border-b border-border`)だけ。スイッチ自身の丸い枠線は
   残す(ユーザーが「ヘッダー行の下線だけ」を選んだ)。行の高さ
   (`h-9`)・余白(`px-3`)・`hidden`切替は変えていない(ピル自体は文字→
   アイコンで、セグメントの縦paddingが`py-0.5`→`py-1`になり約2px高い)。
3. **Phoneの中で、縦長(390x844比)とPCと同じ比率を選べるようにする。**
   ユーザーが選んだ解釈。`domain/viewport.ts`に`PhoneShape`
   (`'portrait' | 'deck'`)・`deviceForShape(shape, deck)`を足し、
   `deviceForShape('deck', deck)`がdeck自身の寸法を返す
   ことで実現した。`effectiveCanvas(deck, 'mobile', deck自身, fixed)`は
   `reshapeCanvas(deck, deck)`、つまり幅はそのまま・高さは
   `max(deck.height, round(deck.width * deck.height / deck.width))`=
   deck.heightになる。**`reshapeCanvas`/`effectiveCanvas`/
   `toggledViewportMode`のシグネチャ・挙動は変えていない**(整数寸法の
   デッキで恒等になることをpropertyテストで固定。小数の高さは最大で
   次の整数へ切り上がる)。状態は`uiStore`の`phoneShape`(初期値
   `'portrait'`)と、明示選択の`selectPhoneShape(shape)`(setterは非公開)
   で、`viewportMode`とは独立のsignalなのでPC↔Phoneを行き来しても保持
   される。永続化なし。`Studio.tsx`のcanvas memoは
   `effectiveCanvas(deck, mode, deviceForShape(shape, deck), fixed)`
   で、幅・高さは別々のnumber memoのまま。
   - UI(初版は別ピルの縦長/横長アイコン2つだったが、意味が分からない
     との指摘で作り直した)。ピルは`[PC | Phone]`の1つだけで、Phoneが
     選択中のときだけ、Phoneセグメントの右に区切り線と▾が出る
     (`DeckHeader.tsx`のPresent ▾と同じスプリットボタンの形)。▾
     (`data-phone-shape-menu-button`、`aria-haspopup="menu"`/
     `aria-expanded`)を押すと真下にメニュー(`role="menu"`、項目は
     `role="menuitemradio"`+`aria-checked`、`data-phone-shape-option=
     "portrait|deck"`)が開く。項目はTall("A tall canvas shaped like a
     portrait phone")とSame ratio as PC("Keeps the deck's own ratio
     (16:9 / 4:3)")。開閉は`uiStore`の`phoneShapeMenuOpen`+
     `openPhoneShapeMenu()`/`closePhoneShapeMenu()`(`variantMenuOpen`に
     倣う)。Phone表示でなければ開けず、PCに戻すと閉じるので、「PC表示で
     メニューが開いている」状態はstoreが取り得ない(PCへの切り替えでは
     先に閉じてからモードを変えるので、途中の状態もobserverから見えない)。
     外側クリックと右クリックは全面オーバーレイ(`fixed`、`z-10`)が受け、
     Escは`Studio.tsx`のkeydownが閉じる(開いている間は他のショートカット
     を通さない)。▾はPresent ▾と同じくトグルで、キーボードからも閉じ
     られる。選択スライドが失われると(ドラフトのプレースホルダなど)
     ヘッダーごとメニューも閉じる。メニューとオーバーレイは常時マウントで`hidden`
     クラス切替(`variantMenuOpen`のメニューと同じ流儀。この▾とメニュー
     には`ref`も`createEffect`も無いので#2927のリークは起きないが、
     コンポーネント全体の流儀に合わせている)。プレビューのhostに
     `isolate`を付け、デッキ自身の`z-index`(大きい`z-index`を持つ
     `.peitho-slide`がメニューとオーバーレイを覆うことをプローブで
     確認した)がメニューより手前に出ないようにしている。
   - **既知の帰結**: Phone + 「PCと同じ比率」のキャンバス寸法は
     PCと同一(1280x720 / 960x720)になる。ユーザーはそれを承知で
     選択した。phone枠(デバイスのフレーム)の描画はスコープ外で、
     別todo候補として「先送り事項」に残した。

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
  // 追加要望3(後から追記): Phone内のshapeと、それに対応するdevice。
  export type PhoneShape = 'portrait' | 'deck'
  // 'portrait' → DEFAULT_DEVICE、'deck' → deck自身の寸法
  export function deviceForShape(shape: PhoneShape, deck: Size): Size
  ```
- `domain/slideFragment.ts`: `hasFixedCanvas(fragmentHtml): boolean`
  (root `<section>`の開始タグだけを見る)。
- `state/uiStore.ts`: `viewportMode` signal + `toggleViewportMode()`。
  永続化なし(列幅と同じセッション内のみ)。追加要望3で、`phoneShape` +
  `selectPhoneShape(shape)`、メニューの`phoneShapeMenuOpen` +
  `openPhoneShapeMenu()`/`closePhoneShapeMenu()`を足した(setterはどれも
  非公開)。
- `components/Studio.tsx`: `previewCanvasWidth`/`previewCanvasHeight`を
  **別々のnumber memo**にする(`effectiveCanvas(render.canvasWidth/
  Height, ui.viewportMode(), deviceForShape(ui.phoneShape(), deck)
  〔初版はDEFAULT_DEVICE固定〕, hasFixedCanvas(選択
  スライドのfragment))`)。オブジェクト1個のmemoだと毎キーストローク
  で`SlidePreview`のeffectが再マウントする(`renderStore`がcanvasを
  分離している理由と同じ)。`<SlidePreview canvasWidth={previewCanvas
  Width()} …>`に渡す。`SlidePreview.tsx`のeffect(既にcanvas寸法を
  追跡→`mountSlideCanvas`がhostに変数を書く)は無変更で動く。
- `dom/slideCanvas.ts`: `observeCanvasScale`が既観測hostでcanvasが変わ
  ったとき、即座に`--peitho-thumb-scale`を書き直す。測定は既存の
  `handleResize`と同じ`contentRect`(小数・paddingを除く)に揃える:
  `host.clientWidth/Height`は整数でpaddingを含むため微妙にずれる。
  `unobserve`→`observe`し直して観測を最初からやり直す。Chrome 153で
  確認済み: `observe()`の再呼び出しだけでは再発火せず、`unobserve`を
  挟むと毎回1回発火する(WKWebViewは未確認、下の人間判断項目)。
- `components/SlidePreview.tsx`: ヘッダー行にトグルを足す。
  `viewportMode`/`onToggleViewportMode`(callback prop、setterは渡さない)
  をStudioから受ける。常時マウントで`hidden`切替にし、条件分岐`ref`内に
  `createEffect`を置かない(#2927)。スマホ枠を描くなら`inset-0`は使わず
  `top-0 right-0 bottom-0 left-0`と書く。追加要望3では、Phone選択中だけ
  出る▾とそのメニュー(`phoneShape`/`phoneShapeMenuOpen`と開閉・選択の
  callback prop)をここに足した。
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
- (追加要望3)`domain/viewport.test.ts` / `domain/viewport.examples.ts`
  (`deviceForShape`。`phoneShapeCanvasExamples`のGiven-When-Then)
  - spec: `'portrait'`はDEFAULT_DEVICE、`'deck'`はdeck自身の寸法。16:9・
    4:3のデッキで`effectiveCanvas(deck, 'mobile', deviceForShape('deck',
    deck), false)`がdeckそのもの(1280x720 / 960x720)、Tallは1280x2770 /
    960x2078、`desktop`と`fixedCanvas: true`はshapeによらず不変。
  - adversarial: deckの幅・高さが0/負/NaN/Infinity/両方負のとき、NaNや
    無限のキャンバスにならずdeckのまま。小数の高さ(720.3はdeckのまま、
    720.7は721へ切り上がる)、極端な寸法、オーバーフロー、未知のshape
    文字列(Tallとして扱う)、frozenなdeckで純粋。
  - property: 整数寸法のdeckで恒等、`'portrait'`は任意のdeckで
    DEFAULT_DEVICE、任意のdeck(非有限を含む)で幅は不変、小数のdeckで
    高さは縮まず1px未満しか伸びない。
- (追加要望3)`state/uiStore.test.ts`: `selectPhoneShape`(明示選択・
  同じshapeの再選択・PC↔Phoneで保持・windowごとに独立)、
  `phoneShapeMenuOpen`(PC表示では開けない、PCに戻すと閉じてPhoneに戻して
  も再び開かない、開閉がshape・モードに触れない、setterを公開しない)、
  PC表示でメニューが開いた状態をどのobserverも見ないこと(effectで検証)。
- (追加要望)e2e: アイコン(各titleの下の図形・stroke・サイズ)、ヘッダー
  行の下線なし・高さ36px・ピル1つ、▾のPC/Phoneでの出し分け、メニューの
  項目・チェック・a11y属性、メニューが画面内で(大きいz-indexのデッキ
  でも)キャンバスより手前に出ること、Tall→`2770px`/Same ratio as PC→
  `720px`(4:3は幅960)、Esc・外側クリック・右クリック・▾の再押下(キー
  ボード)・PCへの切り替え・選択スライドが失われたときの閉じ方、メニュー
  が開いている間ショートカットが待つこと、PC↔Phoneでのshape保持、
  fixedなスライド、サムネイル、`--peitho-thumb-scale`の追従、1タスク内の
  連続選択、編集時に再マウントしないこと、リロードで戻ること。
- e2e(`e2e/`、mockTauri): トグル後にpreview hostのインライン
  `--peitho-canvas-height`が`2770px`、fixedなfragmentでは`720px`、
  サムネイルは不変。mockのペイロードの`css`に`@container`を入れれば
  分岐の発火も確認できる。できないこと: WKWebViewの実描画・実デッキCSS。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] PR-A: `domain/viewport.ts` + `hasFixedCanvas` + テスト
- [x] PR-B: `dom/slideCanvas.ts`の再フィット(独立コミット)、`uiStore`、
      `SlidePreview.tsx`のトグルUI、`Studio.tsx`のmemo、e2e
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `bun run test:e2e`グリーン
- [x] 追加要望(2026-09-20): `domain/viewport.ts`の`PhoneShape`/
      `deviceForShape`+テスト、`uiStore`の`phoneShape`/`selectPhoneShape`/
      `phoneShapeMenuOpen`+テスト、`SlidePreview.tsx`のアイコン化・
      ヘッダー下線の削除・Phone選択中だけ出る▾とshapeメニュー、
      `Studio.tsx`の配線、e2e。`bun test`/`bun run typecheck`/
      `bun run test:e2e`グリーン(Playwrightで PC / Phone(メニュー閉) /
      Phone(メニュー開)の3状態を目視確認済み。メニューはPresentの
      メニューと同じ見た目で、画面内に収まりキャンバスより手前に出る)

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
- [ ] 実機(WKWebView)での確認(2026-09-20の追加要望分。Chromeでしか
      検証していない): ヘッダーのインラインSVGアイコン(PC/Phone、
      メニュー内のTall/Same ratio as PC)が潰れず描画され、lit/unlitが
      見分けられるか。ヘッダー行の下線が消えているか。▾のメニューが
      WKWebViewでも切れず、実デッキ(`z-index`を持つテーマを含む)の
      キャンバスより手前に出るか。外側クリック・Escで閉じるか。Phoneで
      shapeを切り替えたとき`--peitho-thumb-scale`が追従し、スライドが
      再フィットされるか。Phone + Same ratio as PCがPCと同一の見た目に
      なることを承知の上で、phone枠の描画(別todo候補)を要するか

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
- **Phone + Same ratio as PC がPCと見分けにくい**: 2つはキャンバス寸法が
  同一なので、プレビューの見た目だけではどちらの表示か分からない
  (スイッチの点灯とメニューのチェックだけが手がかり)。phone枠(デバイス
  のフレーム)をプレビューに描くことを別todoとして検討する(枠を描く
  ときは`inset-0`を使わず`top-0 right-0 bottom-0 left-0`と書く)。
- **Phoneでもキャンバス幅は390にならない**: `reshapeCanvas`はデッキの幅を
  保って高さだけ伸ばすので、Tallでも幅は1280(4:3なら960)のまま。幅に
  対する`@container (max-width: …)`で分岐するデッキは、このトグルでは
  狭い側の分岐を確認できない(高さ/縦横比に対するクエリだけが発火する)。
  幅も端末に合わせる案(390幅の実キャンバス)は、レイアウトが別物になる
  ので別todoとして検討する。
- 選択中のスライドが`data-canvas="fixed"`のとき、PC/Phoneのスイッチと
  shapeメニューは操作できるがキャンバスは変わらない(スイッチの点灯と
  メニューのチェックだけが動く)。無効化やヒントの表示は必要になったら
  別todoで検討する。
- トグルでプレビューが再マウントされ、レイアウトの`<script>`が再実行
  される(選択変更時と同じ既存挙動)。
- スマホ表示中に固定キャンバスのスライドと通常のスライドをまたいで選択
  すると、プレビューのmount effectが同一フレーム内に2回走る(スライドの
  keyとcanvas高さの2つのmemoがそれぞれ通知するため)。どちらの回も新しい
  canvasで一貫した値を書くので見た目は正しいが、レイアウトの`<script>`は
  その分2回実行される。実害が出たらbatch化を検討する。
