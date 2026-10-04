---
status: wip
description: レイアウト画面の配置を「エディタ | 一覧(選択行が下書きのライブプレビュー) | コメント」に組み替え、右のプレビューを廃止し、一覧にPC/スマホ切替を付ける
tags: [layout, ui, screen, viewport]
---

# レイアウト画面の配置の組み替え

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーとの相談(2026-10-04)。#157で入ったレイアウト画面(左=一覧、
中央=HTML/CSSエディタ、右=プレビュー、さらに右=コメント列)について:
- 右のプレビューは一覧のサムネイルと役割が重複するので無くしたい。
- 「左にエディタ」の方が慣習(コード左・結果右)に沿うので、一覧とエディタの
  順序を逆にしたい。
- スライド画面のプレビューにあるPC/スマホ切替を、レイアウト画面にも付けたい。

壁打ちの結論:
- プレビューを無くす代わりに、**一覧の選択行のサムネイルを、エディタの未保存の
  下書きでライブ描画する**(#157のライブプレビュー — 画像・フォント込み — を
  そのまま一覧に移す)。一覧がプレビューを兼ねる。
- 配置は **エディタ | 一覧 | コメント列**。コメント列が最右なのはスライド画面と同じ。
  スライド画面(一覧が左)とは一覧の位置が入れ替わるが、「見た目の結果が右側」で
  揃うので許容(ユーザー了承済み)。
- PC/スマホ切替は**スライド画面と同じ状態を共有**し(`uiStore`の`viewportMode`/
  `phoneShape`)、**一覧の全サムネイルに適用**する。ボタンは一覧の列の見出しに置く。

関連: `todo/layout-screen.md`(画面本体)、`todo/archive/preview-viewport-toggle.md`
(PC/スマホ切替の契約)、issue #161(下書きフォントの分離 — 本タスクでは扱わない)。

## スコープ

- **目的**: レイアウト画面の表示の重複を無くし、エディタ左・結果右の配置にし、
  スマホ表示でのレイアウトの見え方を一覧で確かめられるようにする。
- **やらないこと**:
  - スライド画面の配置変更(一覧は左のまま)。
  - ライブプレビューの描画方式の変更(`preview_layout_draft`、下書きの画像・
    フォント登録、issue #161のフォント分離)。表示先を移すだけ。
  - レイアウトの右クリックメニュー・モーダル・コメント導線の挙動変更(配置が
    変わるだけで機能は同じ)。
  - デバイスの選択肢を増やすこと(`DEFAULT_DEVICE`の1種のまま)。
- **受け入れ条件**:
  - レイアウト画面に右のプレビュー(`data-layout-preview`)が無い。
  - 左からエディタ、一覧、コメント列の順に並ぶ。エディタと一覧の境界は
    ドラッグで幅を変えられる(既存の`columnResize`)。
  - 一覧で選択中の行のサムネイルが、エディタで入力するとライブプレビューと
    同じタイミング(入力停止後約250ms)で下書きの内容に描き直される。
    保存/元に戻す/別レイアウトへの切替で保存済みの内容に戻る。他の行は
    保存済みの内容のまま。
  - 下書きが描画できないときのエラー(従来`data-layout-preview-error`)は、
    エディタか一覧のどこかに引き続き表示され、入力は妨げない。
  - 一覧の見出しにPC/スマホ切替(とスマホ形状の選択)があり、切り替えると
    一覧の全サムネイルの形がスマホのキャンバスに変わる。スライド画面の
    切替と状態を共有する(どちらで切り替えても両方に効く)。

## 背景・要調査

読んで分かったこと:

- `components/LayoutScreen.tsx`: 一覧(`data-layout-list`、幅`props.listWidth`)→
  エディタ(タブ+CodeMirrorホスト×2、`data-layout-editor-host`)→詳細列
  (`data-layout-detail`: notice・プレビュー`data-layout-preview`・
  `data-layout-preview-error`)の順。コメント列は`Studio.tsx`側で横に置かれる。
  列幅は`state/layoutScreenStore.ts`の`listWidth`/`editorWidth`。
- 一覧の各行のサムネイルは、keyed `.map()`の行内の`ref`で
  `mountSlideCanvas(el, props.layoutPreviewStylesheet(), props.fragmentOf(row.name), …)`
  を**マウント時に1回**呼んでいるだけ。CLAUDE.mdのBarefootJSの落とし穴
  (keyed `.map()`行の`ref`はマウント時のみ、`Map`全体を1つのsignalに
  持たない — `state/renderStore.ts`の`fragmentSignal`パターン)に従い、
  選択行の下書き反映は**キーごとのsignal+`createEffect`**で行う必要がある。
  `SlideList.tsx`のサムネイル更新の仕組みを参考にする。
- 下書きのライブプレビューの状態は`domain/layoutDraftPreview.ts`(番号付き
  リクエスト、最後の正常な描画を保持、エラー)と`state/layoutScreenStore.ts`。
  下書き用CSSは別スタイルシート(`layoutDraftStylesheet`)、下書きの
  `@font-face`は`dom/slideCanvas.ts`の`setDraftFontFaces`。これらを一覧の
  選択行に向け直す。
- PC/スマホ切替: `domain/viewport.ts`(`effectiveCanvas`/`deviceForShape`/
  `reshapeCanvas`)、`state/uiStore.ts`の`viewportMode`/`phoneShape`、
  UIは`components/SlidePreview.tsx`の`data-viewport-toggle`。`Studio.tsx` ~739の
  `effectiveCanvas(deck, ui.viewportMode(), deviceForShape(...), selectedSlideIsFixedCanvas())`
  はスライド前提(`selectedSlideIsFixedCanvas`)。レイアウトのサムネイルには
  スライドが無いので、固定キャンバスの扱いをどうするか要確認(推測: 固定
  キャンバスでないものとして扱う)。
- 一覧の行は`aspect-ratio: canvasWidth / canvasHeight`の箱+
  `observeCanvasScale`。スマホ表示では縦長になり1行が高くなる。

## 方針

- PC/スマホ切替のトグルは`SlidePreview.tsx`のものを小さなコンポーネントに
  切り出して両画面で共有する(重複実装しない)。
- 下書きの描画先を「詳細列のプレビュー」から「一覧の選択行」に移す。描画の
  状態管理(`layoutDraftPreview`)はそのまま使い、表示先だけ変える。
- 段階: (1) 配置の入れ替えとプレビュー廃止+選択行へのライブ描画、
  (2) PC/スマホ切替。1つのPRでよいが、コミットは分ける。

## レイヤー配置

- `domain/`: レイアウトのサムネイル用キャンバス寸法(`effectiveCanvas`の
  レイアウト向けの使い方)が純粋関数として要るならここ。
- `state/layoutScreenStore.ts`: 列幅(エディタ/一覧の順に合わせる)。
- `components/LayoutScreen.tsx`: 配置、詳細列の削除、一覧見出しへのトグル。
  共有トグルは新規コンポーネント(作成前に既存を確認)。
- `components/Studio.tsx`: 下書き描画の配線先の変更、ビューポートの受け渡し。

## テスト

- 新規/変更の純粋関数があればspec+adversarial。
- e2e(`e2e/layout-screen.e2e.ts`ほか、mockTauri):
  - 並び順(エディタ→一覧→コメント列)、`data-layout-preview`が無いこと。
  - 入力すると選択行のサムネイルだけが下書きになり、他の行は変わらない。
    元に戻す/保存/切替で戻る。壊れた下書きでエラーが出て入力が続けられる。
  - 既存のライブプレビューのe2e(画像・フォント・順序逆転)を選択行に向けて
    書き直す。
  - PC/スマホ切替で一覧のサムネイルの縦横比が変わり、スライド画面に戻っても
    同じモードのまま(逆も)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] (Rust変更があれば) `cargo test` グリーン — Rust変更なし
- [x] `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機での見た目/挙動確認(ユーザー自身に依頼): 配置、選択行のライブ
  描画、PC/スマホ切替、列幅のドラッグ。mockTauriのe2eは、下書きが実際の
  `preview_layout_draft`(peitho-core)の出力で描かれること、実機WKWebViewで
  再マウントされたShadow DOMキャンバスが描き直されることまでは保証しない。
- [ ] サムネイルが小さくて細部が見づらくないか(既定幅はエディタと等分に
  変更済み — 上記「実機確認後の追加」2)
- [ ] 実機での追加分の確認: 見出しの削除、等分の既定幅、選択行サムネイルの
  クリックでのコメント(スロット名の表示、実際のpeitho-core出力でのスロット特定)
- [ ] 実機での追加分(その2)の確認: 切替の左上配置、形状メニューが窓内に
  収まること、スマホ表示で縦長サムネイルが一覧の高さに収まること

## 実装メモ

- 選択行の描き直しは`Studio.tsx`の`createEffect`から行う(keyed `.map()`行の
  `ref`はマウント時の1回だけ)。対象は「今下書きを描く行」と「前に描いていた行」
  だけで、他の行には触れない。
- PC/スマホ切替は行のキーに含め(`layoutListGeneration`)、切替で全行を
  マウントし直す。`data-canvas="fixed"`のレイアウトはスマホ表示でもデッキの形。
- 切替UIは`components/ViewportToggle.tsx`に切り出して両画面で共有。

## 実機確認後の追加(2026-10-04)

ユーザーが実機で試した結果の要望。PR #163に追加:

1. **一覧の見出し「Layouts」を削除**。PC/スマホ切替は同じ行(エディタのタブ行と
   同じ高さの、文字の無いツールバー)に右寄せで残す。画面名はウィンドウの
   Slides / Layouts切替が既に示している。
2. **一覧の既定幅=エディタの幅**。初めてレイアウト画面が表示された時、エディタと
   一覧が共有する幅を測り、その半分を一覧の幅にする
   (`domain/layoutScreen.ts`の`initialLayoutListWidth`、
   `state/layoutScreenStore.ts`の`settleListWidth`)。ドラッグの範囲
   (180〜640px、`dom/columnResize.ts`の`COLUMN_WIDTH_BOUNDS`)に収めるので、
   非常に広い画面では一覧は640pxで止まりエディタの方が広くなる(最初のドラッグで
   幅が飛ばないように)。ドラッグ後は、画面を行き来してもドラッグした幅のまま。
   コメント列は自分の幅のまま。
3. **選択中の行のサムネイルを左クリック→AIコメントボックス**(スライド画面の
   プレビュークリックと同じ`CommentBox`)。未選択の行のクリックは従来通り選択だけ。
   ラベルはクリックしたスロットを名指しする: `Layout title-body › slot "title"`、
   スロット外なら`Layout title-body › whole layout`。コメントは従来通り
   `layouts/<name>.html`へのファイル単位のコメントで、スロットはラベル
   (`[Layout title-body › slot "title" (layouts/title-body.html, css/title-body.css)] …`)
   にだけ載る。ドラッグ・右クリックでは開かない。ボックスはウィンドウ内に収める。
   - スロットの特定: peitho-coreは埋まったスロットの中身を`slot-<name>`クラスの
     要素で包む(`render_slot`、v1.34.0で実出力を確認、Rustテスト
     `given_a_layouts_placeholder_rendered_then_each_filled_slots_content_is_wrapped_in_its_slot_class`
     で固定)。サムネイルのキャンバスは`pointer-events: none`なので、クリック位置を
     含む`slot-*`要素の箱のうち最小のものを選ぶ(`slotAtPoint`)。
   - ピン/ハイライトは**未実装**: スライドのプレビューのピンは選択スライドの
     プレビュー1枚に重ねる仕組みで、サムネイル各行への重ね描きは安くないため
     見送った。

## 実機確認後の追加(その2、2026-10-04)

4. **PC/スマホ切替を一覧の左上へ**。エディタ列でHTML/CSSタブがある位置に揃え、
   行の高さ(`h-9`)は同じ、下の罫線(`border-b`)は無し。形状メニュー(▾)は切替の
   左端から右へ開くので、一覧が細くウィンドウの右端に寄っている(コメント列を
   閉じた)場合は`dom/popupFit.ts`がウィンドウ内に押し戻す(`clampMenuPosition`)。
5. **サムネイルが一覧の表示高さをはみ出さない**。スマホ表示(縦長)で一覧が広いと
   選択行のサムネイルが下にはみ出していた。各サムネイルを、行の幅と一覧の
   スクロール領域の高さの両方に収まる最大の箱(縦横比維持、`contain`)にし、
   行内で水平中央に置く(`domain/geometry.ts`の`containSize`、
   `domain/layoutScreen.ts`の`layoutThumbnailSize`/`layoutThumbnailStyle`、
   行の余白は`LAYOUT_ROW_CHROME`)。領域の大きさはResizeObserver
   (`dom/elementSize.ts`)で追い、ウィンドウのリサイズ・仕切りのドラッグ・
   PC/スマホ切替に追従する。PC表示でも非常に低いウィンドウでは同じ規則で収まる
   (高さに余裕があれば従来通り行の幅いっぱい)。

## 先送り事項

- レイアウトコメントのピン/クリックしたスロットのハイライト(上記3)。
