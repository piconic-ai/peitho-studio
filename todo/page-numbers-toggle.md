---
status: todo
description: デッキのページ番号(なし / 番号 / 番号+総数)をUIから切り替え、スライド単位の非表示もコンテキストメニューから切り替える
tags: [deck-settings, frontmatter, context-menu]
---

# ページ番号の表示/非表示切り替え

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザー要望「ページ番号を表示、非表示の切り替え」(2026-09-25)。
peitho-core側の機能はすでに存在する(デッキfrontmatterの`page_numbers`と、
スライド単位の`<!-- {"page_number":false} -->`)。Studioにはそれを触るUIが
なく、frontmatterを手で書くしかない — このtodoはそのUIを載せる。

## スコープ

- **目的**: デッキ全体のページ番号モードをUIから3択(なし / 番号のみ /
  番号+総数)で切り替えられるようにする。あわせて、スライド単位で
  「このスライドだけ番号を出さない」をコンテキストメニューから切り替え
  られるようにする(既存のDraft/Skipトグルと同じ型)。
- **やらないこと**:
  - 番号の見た目(位置・フォント・色)のカスタマイズ。表示はテーマCSS
    (`base.css`の`[data-peitho-page-number]::after`)任せ。
  - 独自`css/`を持つデッキで、そのCSSに番号のルールがない場合の救済
    (Studio側からCSSを注入するなど)。upstreamの仕様どおり「属性は付くが
    見えない」ままにする。UI上の説明文で触れる程度に留める。
  - `page_numbers`以外のfrontmatterキー(`lang`, `aspect_ratio`等)のUI。
    ただし下記の汎用ヘルパー(`setFrontmatterKey`)は後続が使える形にする。
  - `peitho present`側の表示。保存済みファイルをCLIが読むだけなので、
    Studioで保存すればそのまま反映される(確認はするが実装対象ではない)。
- **受け入れ条件**:
  - デッキヘッダー(または後述の方針で決めた場所)にページ番号の3択
    コントロールがあり、選ぶとfrontmatterの`page_numbers`が
    `current` / `current_of_total` に書き換わる、または「なし」でキーごと
    削除される。
  - 切り替え直後にサムネイル・プレビューの番号表示が変わる(組み込み
    テーマ/`peitho new`相当のデッキで)。
  - 「なし」に切り替えたとき、各スライドの`page_number:false`も同時に
    取り除かれ、デッキがparseエラーにならない。
  - スライドのコンテキストメニューに「ページ番号を隠す」トグルがあり、
    デッキのモードが「なし」のとき、およびDraftスライドでは無効化される。
  - 上記の操作はいずれもUndo/Redoできる(デッキ全体の切り替えは1ステップ)。
  - frontmatterに未知の値(`page_numbers: both`など)があるデッキを開いた
    とき、コントロールが例外を出さず「不明」状態を示す。

## 背景・要調査

実際に読んで分かったこと(peitho-core v1.34.0 = `~/.cargo/git/checkouts/
peitho-*/5c5734e/`、Studio = このリポジトリ):

- **peitho-core側の仕様**
  - `page_numbers`の許容値は`current`と`current_of_total`のみ
    (`crates/peitho-core/src/phase.rs:27-30`)。**`false`や`true`はparse
    エラー**(`parser.rs:4723-4764`)。「なし」= キーを削除する、である。
  - 描画は`render.rs:98-126`で`<section>`に`data-peitho-page-number`
    (と`data-peitho-page-total`)を付ける。Skipスライドは数える、Draftは
    総数から除外。
  - スライド単位: `<!-- {"page_number":false} -->`。`true`はエラー
    (「page_number can only be false」)、Draftとの併用はエラー、デッキに
    `page_numbers`がないのに指定するとエラー(`parser.rs:731-750`)。
    **空のページコメント`<!-- {} -->`もエラー**(`parser.rs:3516-3529`)。
  - 番号を実際に描くCSSはpeitho-coreの出力ではなく**テーマCSS**
    (`themes/base.css:47-63`)。Studioは`src-tauri/src/engine/builtin/
    base.css`に同一内容をvendorしており、`<deck>/css/`がなければそれを
    使う(`engine/assets.rs:75-88`)。`create_deck`が書き出す`css/base.css`
    も同じ内容。つまり組み込みテーマのデッキでは、frontmatterを書けば
    今日でも番号は出る(コードリーディングの結論。実機未確認)。
  - `Manifest`には`page_numbers`が載っていない(`manifest.rs:11-22`、
    Studio側の`domain/render.ts:25-32`も同様)。現在の状態はfrontmatter
    テキストを自前で読むしかない。
- **Studio側の既存部品**
  - frontmatterを書く関数は`updateFrontmatterTime`(`domain/slides.ts:
    395-414`)だけ。行ベースで`time:`行を置換/挿入するのみで、キー削除は
    できない。frontmatterがない場合は新規ブロックを作る。閉じ`---`が
    ないときは何もしない。
  - ページコメントの書き換えは`updatePageComment`(`slides.ts:144-160`)。
    浅いマージで、値`undefined`はJSON.stringifyで落ちるためキー削除に
    使える。**ただし結果が`{}`になっても`<!-- {} -->`を書いてしまう**
    (上記のとおりpeitho-coreはこれを拒否する)。既存のDraft/Skipトグルは
    `true`/`false`を明示的に書くのでこの経路を踏んでいなかった。
  - コンテキストメニューの項目定義は`domain/contextMenu.ts:66-89`の
    `menuItems`、アクション型は`:27`の`MenuAction`。描画は`components/
    SlideContextMenu.tsx`。Draftスライドで`toggle-skip`/`toggle-section`
    を無効化する前例がある。
  - スライド設定の変更は`Studio.tsx:1279-1285`の`updateSlideConfig`が
    `{kind:'config', index, patch}`のUndoステップとして記録する。
  - Undo履歴のステップ種別は`slides`/`config`/`text`の3つ
    (`domain/editorHistory.ts:20-36`)。**デッキ全体(frontmatter)を
    変えるステップ種別はまだない。**
  - `SettingsPanel.tsx`はアプリ全体の設定(UI言語・vim mode)で、デッキの
    設定ではない(`todo/archive/studio-settings-panel.md:35`で明示的に
    対象外とされた)。デッキ単位のコントロールは`components/DeckHeader.tsx`
    (言語バリアント切替とPresentメニューがある)が置き場所として自然。

要調査(実装時に確かめる):

1. frontmatterから`page_numbers`を削除した結果、ほかのキーが残らず
   ブロックが空(`---\n---`)になる場合、peitho-coreがそれを受け付けるか。
   受け付けないならブロックごと削除する(`splitSlides`の`prefix`扱いに
   影響するので、その場合のテストも書く)。
2. 「なし」への切り替えで各スライドの`page_number:false`を取り除く処理を
   1つのUndoステップにする方法(下記「方針」)。

## 方針

**UIの置き場所**: `DeckHeader.tsx`にデッキ単位のコントロールとして置く
(第一候補)。3択なのでセグメントコントロールかセレクト。Viewメニューに
項目を足す案もあるが、3択+チェック状態の表現がメニューでは分かりにくく、
ウィンドウごとのデッキ状態と結びつけるのも面倒なので見送る。最終的な
見た目は実機で確認して決める(人間の判断)。

**現在値の読み取り**: `domain/frontmatter.ts`(新規)に純粋関数
`readFrontmatterKey(source, key): string | null`を置き、フロント側で
frontmatterテキストから読む。値は`'none' | 'current' | 'current_of_total'
| { kind: 'unknown', raw }`のADTに正規化する(未知の値でUIが壊れない
ように)。

**書き込み**: 同じファイルに`setFrontmatterKey(source, key, value | null)`
を置く。`null`でキー削除。`updateFrontmatterTime`はこの関数を使う形に
書き直す(別コミット、挙動は変えない — 既存テストで担保)。

**「なし」への切り替え**: キー削除と同時に、全スライドの`page_number`を
`updatePageComment(raw, { page_number: undefined })`で取り除く。その前提
として`updatePageComment`を「結果が空オブジェクトならコメント自体を
削除する」ように直す(バグ修正として独立コミット+テスト)。

**Undo**: `editorHistory.ts`に新しいステップ種別を足す。候補は2つ:

- (a) `{ kind: 'deck-config', before: source, after: source }`のように
  ソース全体のスナップショットを持つ。実装は最小だが、`text`ステップと
  の整合(エディタ側のCodeMirror履歴との同期)に注意が必要。
- (b) `{ kind: 'page-numbers', mode: before/after, hiddenSlides: number[] }`
  のように意味的なパッチを持ち、inverseをその場で組み立てる。既存の
  `config`ステップ(`editorHistory.ts:175`のinverse)と同じ流儀。

(b)を第一候補にする。既存の`config`ステップの設計と揃い、`rebuildSource`
(`Studio.tsx:822-828`)がfrontmatterを`prefix`として扱っている構造に
乗せやすい。実装中に(b)が`text`ステップと衝突すると分かったら(a)に
倒してよいが、その判断は「先送り事項」に理由を書き残す。

**スライド単位のトグル**: `MenuAction`に`'toggle-page-number'`を追加。
`menuItems`で`enabled: hasSlide && !isDraft && ctx.pageNumbersEnabled`、
`checked: config?.page_number === false`。ハンドラは`updateSlideConfig(
index, { page_number: hidden ? undefined : false })`。`MenuContext`に
デッキのモードを渡す必要があるので`ctx`の型を1フィールド広げる。

## レイヤー配置

- `domain/frontmatter.ts`(新規): `readFrontmatterKey`, `setFrontmatterKey`,
  `parsePageNumbersMode`(ADTへの正規化)。純粋。
- `domain/slides.ts`: `updateFrontmatterTime`を上記ヘルパーに委譲。
  `updatePageComment`の空オブジェクト時のコメント削除。
- `domain/editorHistory.ts`: 新ステップ種別とそのinverse。
- `domain/contextMenu.ts`: `MenuAction`/`menuItems`/`MenuContext`の拡張。
- `components/DeckHeader.tsx`: 3択コントロール(状態はpropsで受け、
  変更はコールバック。`Memo`の getter ではなく呼び出した値を渡す —
  CLAUDE.mdの`BF044`の項)。
- `components/Studio.tsx`: `syncedSource`/`perform`との接続、
  コンテキストメニューのハンドラ追加。
- `components/SlideContextMenu.tsx`: 項目の描画。
- Rustの変更は不要(peitho-coreがすでに対応済み)。

## テスト

- `domain/frontmatter.test.ts`(新規)
  - spec: `readFrontmatterKey`で`page_numbers: current`を読む/キーがない
    と`null`/`setFrontmatterKey`で追加・置換・削除。
  - adversarial: frontmatterなし(`---`で始まらない)、閉じ`---`がない、
    キーが`page_numbers :  current`のように空白を含む、値がクォート付き、
    同名キーが2回ある(先頭を採用し2つ目は残す or 削除、どちらにするか
    決めて固定)、空文字ソース、CRLF改行、削除で空になったブロック。
  - `parsePageNumbersMode`: 未知の値・空文字・大文字混じりが`unknown`に
    なること。
- `domain/slides.test.ts`
  - `updatePageComment`で全キーを`undefined`にしたときコメントが消える
    こと、`{}`が書かれないこと、コメント前後の改行が二重にならないこと。
  - `updateFrontmatterTime`の既存テストがそのまま通ること(委譲後)。
- `domain/editorHistory.test.ts`: 新ステップのinverseが往復で元に戻る
  こと(spec)、hiddenSlidesが空/範囲外index/重複のときに壊れないこと
  (adversarial)。
- `domain/contextMenu.test.ts`: `toggle-page-number`の enabled/checked
  が、デッキモード×Draft×`page_number`の組み合わせで期待どおりになること。
- e2e(`e2e/*.e2e.ts`、mockTauri経由): 3択を切り替えてfrontmatterが
  書き換わること、「なし」で`page_number:false`が消えること。番号の
  見た目自体はpeitho-coreの出力依存なのでmock e2eでは検証できない。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `bun run test:e2e` グリーン(追加分含む)
- [ ] `bunx bf debug graph`等で`DeckHeader`の新propsが反応的であること
  (静的解析の`no tracked deps`だけで断定しない — CLAUDE.md参照)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機(`run-peitho-studio` skill)で、組み込みテーマのデッキに番号が
  出る/消えること、サムネイルとプレビューの両方で反映されること
- [ ] コントロールの見た目と置き場所の最終確認
- [ ] 「なし」に切り替えたときに各スライドの`page_number:false`を黙って
  取り除く挙動でよいか(代案: 取り除かずにトグルを無効化して理由を表示)

## 先送り事項

- 独自`css/`を持つデッキ向けに、番号のCSSルールがないことを検出して
  案内する(いまは「属性は付くが見えない」)。
- `lang`/`aspect_ratio`などほかのfrontmatterキーのUI(`setFrontmatterKey`
  ができれば小さく足せる)。
