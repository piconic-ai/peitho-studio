---
status: todo
description: 画像を受けるスロットのないレイアウトで画像を使ったとき、収まるレイアウトへの変更か、組み込みの画像レイアウトの追加を案内する
tags: [layout, images, ui, rust-command]
---

# 画像スロットのないレイアウトへの画像: 直す手段を案内する

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザー指摘(2026-09-28)。画像のドロップ/ペースト
(`todo/image-drop-paste.md`、PR #128)で既存デッキに画像を入れると、
`slide 3 ('new-slide-2'), line 25: no slot accepts image in layout 'title-body-code'`
というビルドエラーが出るだけで、どう直せばよいか分からない。壁打ちで
次のように決めた:

1. 今のレイアウトに収まるなら何もしない(今どおり)。
2. 収まらないが、デッキ内に画像込みで収まるレイアウトがあるなら、
   「Change Layout」ピッカーを開いて選ばせる。
3. デッキ内に収まるレイアウトが一つもないなら、組み込みの
   `title-body-image`レイアウトをデッキに追加する選択肢を出す。
4. 案内は画像の挿入時に限らず、`no slot accepts image`のビルドエラー
   全般(手で`![](…)`を書いた場合も)で出す。挿入前に確認はせず、
   挿入後に直す手段を出す(Undoの流れを崩さない)。

**PR #128(`image-drop-paste`)の上に乗る** — `builtin::IMAGE_LAYOUT_HTML`/
`IMAGE_LAYOUT_CSS`はそのPRで入る。#128がmainに入ってから着手するか、
そのブランチから切る。

## スコープ

- **目的**: `no slot accepts image`のエラーから、1〜2クリックでスライドが
  描画される状態に戻せるようにする。
- **やらないこと**:
  - Coding Agent向けのprompt生成/コピー(デッキの見た目に合わせた画像
    レイアウトを作らせる案)。Peitho StudioとCoding Agentをつなぐ体験・
    UIを整理してから別タスクで扱う、とユーザーが決めた。
  - 画像以外の構造不一致エラー(`unassigned content remains for missing
    'body' slot`など)への案内。仕組みは流用できるが今回は画像のみ。
  - 挿入前の事前チェック/確認ダイアログ。
  - 既存の組み込みレイアウト(`title-body-image`)の見た目の変更。
- **受け入れ条件**:
  - 画像スロットのないレイアウトのスライドに画像を入れると、エラーバーに
    エラー文に加えて「直す」操作(下記のどちらか)が出る。
  - デッキ内に画像込みで収まるレイアウトがあるとき、その操作で
    「Change Layout」ピッカーが該当スライドについて開き、収まる
    レイアウトだけが選べる状態になっている(既存の`check_slide_layouts`
    の判定どおり)。選ぶとエラーが消え、画像が描画される。
  - 収まるレイアウトがないとき、その操作で`layouts/title-body-image.html`
    と`css/title-body-image.css`がデッキに書かれ、そのスライドが
    `title-body-image`で描画される。他のスライドの描画結果は変わらない。
  - 追加が他のスライドを壊す(下記「単一レイアウト→構造一致への切り替わり」)
    場合、ファイルを書かずにエラーで理由を示す。既存ファイルは決して
    上書きしない。

## 背景・要調査

実際に読んで分かったこと:

- **エラーの出どころ**: peitho-core v1.34.0(`src-tauri/Cargo.toml`の
  tag)の`mapping.rs::image_slot_name`が
  `no slot accepts image in layout '<name>'`を`ErrorKind::Layout`で返す。
  Studio側では`components/Studio.tsx`の`renderPreview`が
  `deckIpc.renderDraft`の失敗を`setErrorMessage(String(err))`で文字列
  のまま出しているだけで、構造化されたエラーは届いていない。
- **レイアウトの割り当て**(`mapping.rs::try_dispatch`):
  - スライドに明示の`layout`があればそれだけを見る(Studioの新規スライドは
    前のスライドの明示`layout`を引き継ぐ — `domain/slides.ts`の
    `newSlideConfig`付近のコメント)。
  - `layouts/`にレイアウトが1つだけなら、それにmapするだけ
    (`check_slide`は走らない)。
  - 2つ以上なら全レイアウトにmap+`check_slide`し、ちょうど1つに
    一致しなければエラー。
- **既存の適合判定**: `check_slide_layouts(content, slide_index)`
  (`src-tauri/src/peitho.rs`、実体は`engine/layout_fit.rs`)が、編集中の
  本文を受け取り各レイアウトへの適合を`LayoutVerdict[]`で返す。スライドの
  明示`layout`を外し、単一レイアウトのデッキには捨てのtwinを足して
  構造一致の経路に乗せて判定している。フロントでは`domain/layoutFit.ts`と
  `SlideContextMenu.tsx`の「Change Layout」サブメニューが使う
  (`todo/archive/layout-picker-mismatch-error.md`)。
- **ピッカーの開き方**: 今は右クリック(`Studio.tsx`の`openContextMenu`)
  からだけ。`ui.openSlideContextMenu(index, x, y)`→`checkLayoutFit`→
  `loadLayoutPreviews`、サブメニュー展開は`onToggleLayoutPicker`。
  コード側から「このスライドについて、ピッカー展開済みで開く」入口は
  ない。
- **アセットの解決**(`src-tauri/src/engine/assets.rs::resolve`): 描画の
  たびに`layouts/*.html`と`css/*.css`を全部読む(追加したファイルは次の
  描画で反映される)。ただし:
  - `layouts/`が**ない**デッキは組み込みの`title-body-code`だけで動いて
    いる。ここに`layouts/title-body-image.html`だけを書くと
    `title-body-code`が消える。→ `layouts/`がないときは
    `title-body-code.html`(`builtin::LAYOUT_HTML`)も一緒に書く。
  - `css/`が**ない**デッキは組み込みの`base.css`で動いている。
    `css/title-body-image.css`だけを書くと`base.css`が消える。→
    `css/`がないときは`css/base.css`(`create_deck`と同じ
    `BASE_CSS_HEADER`付き)も一緒に書く。
- **単一レイアウト→構造一致への切り替わり**: `layouts/`にレイアウトが
  1つだけのデッキに`title-body-image`を足すと、明示`layout`のない
  スライドの割り当てが「単一レイアウト(`check_slide`なし)」から
  「構造一致(`check_slide`あり)」に変わる。これまで通っていたスライドが
  `check_slide`で落ちる、または複数のレイアウトに一致する可能性がある。
  `title-body-image`は画像スロットが必須(`arity="1"`)なので画像のない
  スライドには一致しないはずだが、**実際に追加前後でデッキ全体を描画して
  比べないと断言できない**。→ 書く前に、追加後のレイアウト一式でデッキ
  全体をメモリ上で描画して確かめる。
- **明示`layout`のスライド**: 問題のスライドが`layout: title-body-code`を
  明示しているなら、ファイルを足すだけでは直らない。追加後にその
  スライドの`layout`を`title-body-image`に変える(`updateSlideConfig`、
  Undo可能)。

要調査(着手時に確かめる):

1. エラー文字列からスライドを特定する方法。`slide 3 ('new-slide-2')`の
   番号が1始まりか、draft/skipのスライドを数えるか。キー
   (`'new-slide-2'`)で引ければ番号より確実。エラー文字列の形は
   peitho-coreの`BuildError`の`Display`(`error.rs`)で確認する。
   文字列を解析せず、Rust側で`ErrorKind`とスライド位置を構造化して
   返す方がよければそうする(`render_draft`の`Err(String)`の型を変える
   影響範囲を見て決める)。
2. 手動で`![](…)`を書いている途中(例えば`![](`まで打った時点)でも
   このエラーが出るか。出るなら、入力中に案内がちらつかないかを見る
   (エラーバーの表示条件は今と同じなので悪化はしないはず)。

## 方針

- **判定**: エラーが`no slot accepts image`のとき(要調査1の方法で)、
  該当スライドについて`check_slide_layouts`を呼び、`fits`のレイアウトが
  1つ以上あれば「ピッカーを開く」、0なら「画像レイアウトを追加」を出す。
  判定結果はADTで表す(例: `ImageSlotFix = { kind: 'pick-layout', index }
  | { kind: 'add-image-layout', index } | { kind: 'none' }`)。
- **ピッカーを開く**: 該当スライドを選択し、そのスライドの
  サムネイル行の位置にコンテキストメニューを開いて「Change Layout」を
  展開済みにする。右クリックと同じ`openSlideContextMenu`/
  `checkLayoutFit`/`loadLayoutPreviews`の経路を関数に切り出して共有し、
  選択後の処理(`chooseLayoutFromPicker`)はそのまま使う。
- **画像レイアウトを追加**: 新しいTauriコマンド
  (例: `add_image_layout(content)`)で、
  1. 書くファイルの一覧を純粋関数で決める(`layouts/`/`css/`の有無に
     応じて`title-body-code.html`/`base.css`を足す)。既存ファイルと
     名前がぶつかるならエラー(上書きしない)。
  2. その一式を足したレイアウトでデッキ全体(`content`)をメモリ上で
     描画し、失敗したらファイルを書かずに理由を返す。
  3. `create_new`で書く。
  フロントは成功後、該当スライドが`title-body-code`などを明示していれば
  `updateSlideConfig(index, { layout: 'title-body-image' })`を実行し、
  再描画する。ファイルの追加はUndoの対象にしない(`image-drop-paste`で
  画像ファイルを残すのと同じ扱い)。

## レイヤー配置

- Rust
  - `engine/`: 追加するファイル一覧を決める純粋関数、追加後のレイアウト
    一式でデッキを描画して確かめる関数(`engine/layout_fit.rs`か新しい
    `engine/image_layout.rs`)。`builtin`の定数をそのまま使う。
  - `peitho.rs`: `add_image_layout`コマンド(セッションからデッキの
    ディレクトリを取り、engineの関数を呼ぶだけ)。`lib.rs`で登録。
- フロント
  - `domain/`: エラー文字列(または構造化エラー)から「画像スロットの
    エラーか・どのスライドか」を取り出す純粋関数、`LayoutVerdict[]`から
    `ImageSlotFix`を決める純粋関数、案内の文言(`domain/messages.ts`)。
  - `ipc/deckIpc.ts`: `addImageLayout`。
  - `components/StatusBar.tsx`: エラーバーに操作ボタンを出す。
  - `components/Studio.tsx`: 判定の呼び出し、ピッカーを開く/レイアウト
    追加の配線。

## テスト

- Rust(`#[cfg(test)]`)
  - ファイル一覧: spec(`layouts/`と`css/`がある → 2ファイル)、
    adversarial(`layouts/`がない → `title-body-code.html`も、`css/`が
    ない → `base.css`も、`title-body-image.html`が既にある → エラー)。
  - 描画の確かめ: spec(組み込み`title-body-code`だけのデッキに画像
    スライド → 追加後に全スライドが描画できる)、adversarial(単一
    レイアウトのデッキで、追加すると別のスライドが複数一致/`check_slide`
    で落ちる場合 → エラーで、ディスクに何も書かれない)。
- フロント(`bun test`)
  - エラーの判別: spec(実際のエラー文 → スライドと`true`)、adversarial
    (別種のLayoutエラー、空文字、レイアウト名に`'`を含む、スライド番号が
    範囲外)。
  - `ImageSlotFix`: spec(fitsが1つ → pick-layout、0 → add-image-layout)、
    adversarial(判定が`unavailable`、今のレイアウトがfits → none)。
- e2e(`e2e/`、`mockTauri`): 画像スロットのないデッキに画像を
  ペースト → エラーバーのボタン → (a)収まるレイアウトがあるモックでは
  ピッカーが開き選べる、(b)ないモックでは`add_image_layout`が呼ばれ、
  明示`layout`のスライドは`title-body-image`に変わる。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン
- [ ] 上記e2eがグリーン(`E2E_PORT=<空きポート> bun run test:e2e`)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機での確認(ユーザー自身に依頼する):
  - `layouts/`に画像スロットのない既存デッキ(peithoの
    `examples/minimal`など)に画像をドロップ → 案内から画像レイアウトを
    追加 → 画像が描画され、他のスライドの見た目が変わらない
  - 画像スロットのあるレイアウトを含むデッキで、案内からピッカーが
    開き、選ぶとエラーが消える
  - `layouts/`/`css/`のないデッキで追加しても、既存スライドの見た目が
    変わらない
- [ ] 案内の文言とボタンの置き場所

## 先送り事項

- Coding Agent向けpromptの生成(「やらないこと」参照)。Peitho Studioと
  Coding Agentをつなぐ体験・UIの整理とあわせて別todoにする。
