---
status: done
description: 新規デッキに定番レイアウト11種(タイトルスライド〜空白)を全部入りで組み込み、Studioが作る/変えるスライドには常にlayoutを明示する
tags: [layout, scaffold, new-deck]
---

# 定番レイアウトの組み込み

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーの要望(2026-10-02)「デッキを新規作成した際、用意された定番の
レイアウトを選択できるようにしたい」。参考画像はGoogleスライドの11種
(タイトルスライド / セクションヘッダー / タイトルと本文 / 2列(タイトルあり) /
タイトルのみ / 1列のテキスト / 要点 / セクションタイトルと説明 / 説明 /
数字(大) / 空白)。壁打ちの結論:
- 新規作成ダイアログで取捨選択はさせず、**11種を常に全部入りで書き出す**。
  使い分けはスライドごとのレイアウト変更(既存の右クリック「Change Layout」と、
  `todo/archive/layout-screen.md`の専用画面)で行う。
- 割り当ては**明示方式**: Studioが作る/変えるスライドには必ずページコメントに
  `"layout":"<name>"`を書く(構造マッチングに頼らない — 理由は背景参照)。

レイアウト画面3本組の1本目。後続: `todo/archive/layout-screen.md`、
`todo/archive/layout-review-comments.md`。

## スコープ

- **目的**: New Deckで作ったデッキが、定番11種のレイアウトを最初から持ち、
  どのスライドも明示されたレイアウトでビルドできる状態にする。
- **やらないこと**:
  - 新規作成ダイアログでのレイアウト取捨選択UI(全部入り固定と決定済み)。
  - テーマ(色・フォント)の選択。`todo/archive/new-deck-settings.md`で
    スコープ外にした判断を維持する。
  - 既存デッキへ定番レイアウトを後から追加する機能(→`todo/archive/layout-screen.md`
    の「新規作成」で定番から選べるようにする想定。ここではやらない)。
  - peitho-core / `peitho new`側への定番レイアウトの移植(Studio内で
    `engine/builtin/`にvendorする)。
  - レイアウト専用画面・作成/複製/削除(→`todo/archive/layout-screen.md`)。
- **受け入れ条件**:
  - New Deckで作ったデッキの`layouts/`に定番11種(+画像用、方針参照)の
    `.html`があり、`css/`にそれらのCSSがある。
  - 11種それぞれを明示指定した1枚ずつのデッキが`peitho build`相当
    (Studioのレンダリング)でエラーなくビルドできる(Rustテストで確認)。
  - スターター`deck.md`の1枚目は`"layout":"title-slide"`(名前は方針で確定)を
    明示している。
  - Studioの「+」(新規スライド)で追加したスライドは、直前のスライドが
    layoutを明示していなくても、必ず`"layout"`を明示して書かれる。
  - 画像のドロップ/ペースト(`add_image_layout`の導線)が、新規デッキで従来通り
    動く。

## 背景・要調査

読んで分かったこと:

- レイアウトは`<section>`1つのHTMLで、`<slot name accepts arity>`を宣言する
  (peitho-core `layout.rs`)。デッキの`layouts/*.html`が全部読まれ、
  ファイル名(拡張子抜き)がレイアウト名になる(`engine/assets.rs::resolve`)。
  `css/*.css`は全ファイルが連結されて**全スライドに効く**(レイアウト単位の
  スコープはない)。
- スライドのレイアウト決定(peitho-core `mapping.rs::try_dispatch`):
  1. ページコメントの`"layout"`があればそれ(未知の名前はビルドエラー)
  2. レイアウトが1つしかなければそれ
  3. それ以外は構造マッチングで**ちょうど1つ**に当たる必要があり、0件も
     複数件もビルドエラー
- 定番11種は構造が重なる(「タイトルのみ」「セクションヘッダー」「要点」は
  どれも見出し1つ、「タイトルと本文」も本文0件なら同じ)ため、3.に頼ると
  見出しだけのスライドが「slide matches multiple layouts」になる。
  → 明示方式にする理由。
- 現在の新規デッキの雛形は`src-tauri/src/peitho.rs::scaffold_deck_files`:
  `deck.md`、`layouts/title-body-code.html`、`layouts/title-body-image.html`、
  `css/base.css`、`css/title-body-image.css`、`.gitignore`。中身は
  `src-tauri/src/engine/builtin/`(`builtin.rs`)。スターター本文は
  `STARTER_BODY`(`"key":"cover"`のみ、layout指定なし)。
- 新規スライドの設定は`domain/slides.ts`の`newSlideConfig`で、直前スライドの
  **明示された**layoutだけを引き継ぐ。明示がないと何も書かない。
- 画像のドロップ/ペースト導線は`title-body-image`(image slotが必須=arity 1)
  に依存している(`engine/image_layout.rs`、`domain/imageSlot.ts`)。
  `add_image_layout`は「既存スライドのdispatchが変わらないこと」を検査して
  からファイルを足す。
- `todo/archive/image-slot-layout-suggestion.md`の教訓: 追加CSSのルール
  (`.image`等)が他スライドに漏れうる。定番11種のCSSは必ずレイアウト固有の
  ルートクラスでスコープする。
- 要確認: peitho-coreの`root_classes`(`Layout`構造体)が`<section class>`
  をそのまま出力に載せるか。載るならCSSは`.peitho-slide.layout-<name>`で
  スコープできる。載らなければ別手段(slotを包む要素のクラス)を検討する。

## 方針

- **レイアウト名(ファイル名)**: 英語のケバブケース。表示名(日本語/英語)は
  `domain/`の表(名前→表示名)で持ち、UI言語(`domain/messages.ts`)に従う。
  案: `title-slide` / `section-header` / `title-body` / `two-column` /
  `title-only` / `one-column-text` / `main-point` /
  `section-title-description` / `caption` / `big-number` / `blank`。
  未知の名前(ユーザー作成)は名前をそのまま表示する。
- **slot設計**(参考画像の配置に合わせる。arityは「空でもビルドできる」側に
  倒す — 新規スライドが空のまま置かれても壊れないため):
  - title-slide: title(inline,1), body(blocks,0..1) (サブタイトル。実装時に`subtitle`から変更 — 完了条件参照)
  - section-header: title(inline,1)
  - title-body: title(inline,1), body(blocks,0..*)
  - two-column: title(inline,1), left(blocks,0..*), right(blocks,0..*)
  - title-only: title(inline,1)
  - one-column-text: title(inline,1), body(blocks,0..*) (左寄せの細い列)
  - main-point: title(inline,1) (大きな見出し枠)
  - section-title-description: title(inline,1), subtitle(blocks,0..1),
    body(blocks,0..*) (右半分の色付き領域)
  - caption: body(blocks,0..*) (下部の説明文)
  - big-number: title(inline,1), body(blocks,0..*) (巨大な数字+説明)
  - blank: body(blocks,0..*)
  - 2列の振り分けは`::: {slot=left}`/`::: {slot=right}`フェンス。実装時に
    peitho-coreで`arity=1`の`title`が無いスライド(`blank`/`caption`)が
    ビルドできるか実際に試して確かめる。
- **既存2種との関係**: `title-body-code`は`title-body`に置き換える(code
  slotが必要なら`title-body`の`body`が`blocks`でコードブロックも受けるか
  確認)。`title-body-image`は画像導線のため残す(=計12種)。`add_image_layout`
  の「`layouts/`が無ければ`title-body-code`も書く」処理は、定番を持たない
  既存デッキ向けとしてそのまま残す。
  → 実装着手時にこの扱いを人間に確認する(完了条件の人間判断項目)。
- **明示の徹底**: `newSlideConfig`を「直前スライドの*実際に使われている*
  レイアウト」を引き継ぐよう変える。直前がlayout未明示の場合は、レンダ
  結果(マニフェスト)の実際のレイアウト名を使う。取れなければ`title-body`
  (定番がある場合)、それも無ければ何も書かない(従来動作)。
- **CSS**: `css/layouts.css`に11種分をまとめるか、レイアウトごとに
  `css/<name>.css`を置く。後者を推奨(`todo/archive/layout-screen.md`の複製/削除で
  HTMLとCSSを対で扱えるため)。どちらもルートクラスでスコープする。

## レイヤー配置

- Rust `engine/builtin/`: 定番レイアウトのHTML/CSSファイルを追加し、
  `builtin.rs`に`STANDARD_LAYOUTS: &[(name, html, css)]`のような表で公開。
- Rust `peitho.rs`: `scaffold_deck_files`が表から書き出す。`STARTER_BODY`に
  `"layout":"title-slide"`を足す。
- フロント `domain/`: 定番レイアウトの表示名表(新規`domain/layoutNames.ts`
  など — 作成前に既存ファイルを確認)。`domain/slides.ts`の`newSlideConfig`
  変更。
- `components/`/`Studio.tsx`: 新規スライド作成時に、直前スライドの実レイアウト
  名(`renderStore`のマニフェスト)を`newSlideConfig`へ渡す配線のみ。

## テスト

- Rust spec: 定番の各レイアウトが`parse_layout`を通る / `Layouts::new`で
  名前重複なし / 各レイアウトを明示した最小スライドがレンダできる /
  `scaffold_deck_files`が定番全部とCSSを含む / スターターdeck.mdが
  `title-slide`を明示している。
- Rust adversarial: 空のスライド本文(見出しなし)で`blank`/`caption`が
  ビルドできる / 定番全部入りのデッキで、layout未明示の見出しだけスライドが
  「multiple layouts」エラーになることを固定する(明示方式の前提を
  テストとして残す) / 定番入りデッキへの`add_image_layout`が
  既存dispatchを壊さない。
- TS spec/adversarial(`newSlideConfig`): 直前が明示あり/明示なし+実レイアウト
  あり/どちらも無し/先頭スライド(直前なし)/実レイアウト名が空文字。
- e2e(mockTauri): 「+」で追加したスライドのdeck.mdにlayoutが書かれる。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `cargo test` グリーン
- [x] `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] `title-body-code`を`title-body`に置き換え、`title-body-image`を残す
  扱いでよいか(方針「既存2種との関係」)
- [x] 実機で新規デッキを作り、11種それぞれの見た目が参考画像の配置に
  近いか(ユーザー自身に依頼)
- [x] 方針からの追加判断でよいか(実装時に決めたもの):
  - 「+」は直前のレイアウトのうち「見出しだけのスライドがビルドできる」
    もの(`RenderPayload.headingLayouts`)だけを引き継ぐ。`caption`/`blank`
    (title slotが無い)や`title-body-image`(画像必須)、および
    `title-slide`(1枚目専用)の後は`title-body`にする。
  - `title-slide`のサブタイトルはslot名`subtitle`ではなく`body`
    (arity 0..1)にした。フェンス不要で書けて、スターターに画像を
    ドロップしたときも`title-body-image`が合うレイアウトとして提示される
    (`subtitle`だとどのレイアウトにも合わず回復手段が無かった)。
  - layoutを明示したスライド(新規デッキでは全スライド)に画像をドロップ
    すると、従来の自動切替ではなくエラーバーの「レイアウトを選ぶ」から
    `title-body-image`を選ぶ導線になる(layout未明示スライドは従来通り
    自動で`title-body-image`)。
  - 「Change Layout」のプレビューを各レイアウトのslotから作るように
    した(固定文面だと定番の大半が空白プレビューになるため)。

## 先送り事項
