---
status: todo
description: 新規デッキ作成ダイアログで縦横比と言語を選べるようにする
tags: [deck-settings, frontmatter, new-deck]
---

# 新規デッキ作成時に縦横比と言語を選べるようにする

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザー要望(2026-09-28)。デッキ設定の配置を検討した壁打ちで、
「新規作成時**のみ**設定できるのは避けたい。新規作成時に案内しつつ、
後から変更できると良い。だいたいあとから状況は変わるものだから」との
結論。後から変更する手段は`todo/deck-settings-menu.md`のDeckメニュー。
このtodoはそのDeckメニューが入ってから着手する。

## スコープ

- **目的**: 最初に決めることが多い`aspect_ratio`と`lang`を、新規作成
  ダイアログで選べるようにする。
- **やらないこと**:
  - 「あとでDeckメニューから変更できます」のような案内文(ユーザー判断:
    メニューを見ればすぐ分かるので不要)。
  - テーマの選択(雛形は組み込みテーマ固定のまま)。
  - `page_numbers`/`breaks`など、ほかのキーの選択。
  - Deckメニュー側の実装(`todo/deck-settings-menu.md`)。
- **受け入れ条件**:
  - `NewDeckModal`に縦横比(16:9 / 4:3)と言語(Deckメニューと同じ候補)の
    選択があり、既定値が選ばれた状態で開く。
  - 作成した`deck.md`のfrontmatterに、選んだ値が書かれる。既定値の
    ままならキーを書かない(Deckメニューの「既定値ならキー削除」と同じ)。
  - 4:3を選んで作ったデッキが開いたとき、サムネイルとプレビューが4:3で
    表示される。

## 背景・要調査

実際に読んで分かったこと(origin/main `da47008`):

- 新規作成の流れ: Fileメニューの「New Deck…」(`lib.rs:66`)→
  `handleNewDeck`(`Studio.tsx:674-679`)で親ディレクトリを選ぶ →
  `components/NewDeckModal.tsx`(名前の入力だけ)→ `runCreate`
  (`Studio.tsx:136-145`)→ `create_deck`(`src-tauri/src/peitho.rs:
  351-368`)。
- 雛形の`deck.md`は`STARTER_DECK`(`peitho.rs`)で、frontmatterは
  `time: 1m`だけ。
- 雛形の`layouts/title-body-code.html`が4:3でも崩れないかは未確認
  (推測では組み込みCSSがキャンバス寸法に追従するので問題ない)。

要調査(実装時に確かめる):

1. 4:3で作った雛形デッキが、peitho-coreの検証を通り、見た目も崩れない
   こと。
2. 言語の既定値をどうするか(方針参照)。

## 方針

**frontmatterの組み立て**: `create_deck`に選択値を渡し、Rust側で
`STARTER_DECK`のfrontmatterに行を足す案と、フロント側で
`setFrontmatterKey`を使って作成直後に書き足す案がある。前者を第一候補に
する — 作成は1回の書き込みで済み、作成直後の余計なUndoステップや保存が
生まれない。Rust側の組み立ては`(aspect_ratio, lang) -> String`の純粋
関数にする。

**言語の既定値**: peitho-coreの既定値`en`を既定とする案と、StudioのUI
言語に合わせる案がある。後者の方が日本語UIの利用者には自然だが、
`ja`を書き込むことになる。実装者は前者で実装し、最終判断は人間に委ねる
(完了条件参照)。

## レイヤー配置

- `src-tauri/src/peitho.rs`: `create_deck`の引数追加。frontmatterを
  組み立てる純粋関数(または`engine/`の近くに置く)。
- `ipc/deckIpc.ts`: `createDeck`の引数追加。
- `components/NewDeckModal.tsx`: 選択UI。
- `components/Studio.tsx`: `runCreate`への受け渡し。
- `domain/messages.ts`: 英日の文言。

## テスト

- Rust: frontmatter組み立て関数のspec(各組み合わせ)とadversarial
  (既定値のみでキーが書かれない、未知の値を渡されたときの扱い)。
  `create_deck`の既存テストが通ること。
- e2e: 新規作成ダイアログで4:3を選ぶと、`createDeck`に値が渡ること
  (mockTauri)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン
- [ ] `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で4:3のデッキを作り、表示が崩れないこと
- [ ] 言語の既定値(`en`固定か、UI言語に合わせるか)
- [ ] ダイアログの見た目

## 先送り事項
