---
status: wip
description: 新規デッキ作成ダイアログで縦横比と言語を選べるようにする
tags: [deck-settings, frontmatter, new-deck]
---

# 新規デッキ作成時に縦横比と言語を選べるようにする

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザー要望(2026-09-28)。デッキ設定の配置を検討した壁打ちで、
「新規作成時**のみ**設定できるのは避けたい。新規作成時に案内しつつ、
後から変更できると良い。だいたいあとから状況は変わるものだから」との
結論。後から変更する手段は編集メニューのデッキ設定
(`todo/deck-settings-menu.md`で実装済み。当初は「Deckメニュー」を
新設する案だったが、既存の編集メニュー内に現在値つきのサブメニューとして
置かれた)。

## スコープ

- **目的**: 最初に決めることが多い`aspect_ratio`と`lang`を、新規作成
  ダイアログで選べるようにする。
- **やらないこと**:
  - 「あとで編集メニューから変更できます」のような案内文(ユーザー判断:
    メニューを見ればすぐ分かるので不要)。
  - テーマの選択(雛形は組み込みテーマ固定のまま)。
  - `page_numbers`/`breaks`など、ほかのキーの選択。
  - 編集メニューのデッキ設定側の変更(`todo/deck-settings-menu.md`)。
- **受け入れ条件**:
  - `NewDeckModal`に縦横比(16:9 / 4:3)と言語(編集メニューのデッキ設定と
    同じ候補)の選択があり、既定値が選ばれた状態で開く。
  - 作成した`deck.md`のfrontmatterに、選んだ値が書かれる。既定値の
    ままならキーを書かない(編集メニューの「既定値ならキー削除」と同じ)。
  - 4:3を選んで作ったデッキが開いたとき、サムネイルとプレビューが4:3で
    表示される。

## 背景・要調査

実際に読んで分かったこと(origin/main `2fcc38f`):

- 新規作成の流れ: Fileメニューの「New Deck…」(`lib.rs`の`new_deck`)→
  `menu:new-deck` → `handleNewDeck`(`Studio.tsx`)で親ディレクトリを
  選ぶ → `components/NewDeckModal.tsx` → `runCreate`(`Studio.tsx`)→
  `create_deck`(`src-tauri/src/peitho.rs`)。
- 候補・既定値は`domain/deckSettings.ts`の`DECK_SETTING_CHOICES`と
  `src-tauri/src/deck_menu.rs`の`SettingKey::choices`(先頭が既定値)。

調査結果:

1. **4:3の雛形デッキはpeitho-coreの検証を通る**(実装で確認済み)。
   `create_deck`で16:9/4:3 × en/jaの4通りを作り、`engine::pipeline::
   render_source`に通すテスト(`peitho.rs`の
   `given_every_combination_when_a_created_deck_is_rendered_then_peitho_core_accepts_it_at_that_ratio`)
   で、どれもエラーなく描画され、manifestの`aspectRatio`と
   `canvasWidth`/`canvasHeight`がその比になることを確かめた(4:3は
   960x720)。見た目が崩れないかは実機確認が要る(完了条件参照)。
2. 言語の既定値: `en`(peitho-coreの既定)で実装した。最終判断は人間
   (完了条件参照)。

## 方針

**frontmatterの組み立て**: `create_deck`に選択値を渡し、Rust側で
雛形のfrontmatterに行を足す(第一候補どおり)— 作成は1回の書き込みで
済み、作成直後の余計なUndoステップや保存が生まれない。組み立ては
`peitho.rs`の`starter_deck(NewDeckSettings) -> String`。値の検証は
`deck_menu.rs`の`SettingKey::choice_of`/`default_choice`を使い、候補を
重複定義しない。`create_deck`の新しい引数は省略可能(省略は既定値)、
候補外の値はエラーでディレクトリを作らない。

**言語の既定値**: peitho-coreの既定値`en`を既定とする案と、StudioのUI
言語に合わせる案がある。後者の方が日本語UIの利用者には自然だが、
`ja`を書き込むことになる。前者で実装した。最終判断は人間に委ねる
(完了条件参照)。

## レイヤー配置

- `src-tauri/src/deck_menu.rs`: `SettingKey::default_choice`/`choice_of`。
- `src-tauri/src/peitho.rs`: `create_deck`の引数追加、`NewDeckSettings`/
  `starter_deck`(純粋関数)。
- `domain/newDeckSettings.ts`: ダイアログの選択値(候補は
  `DECK_SETTING_CHOICES`をそのまま使う)と表示名。
- `domain/deckLifecycle.ts`: `naming-new-deck`/`creating`が選択値を持つ。
  作成失敗で戻ったときは選択値を保ち、キャンセル後に開き直すと既定値。
- `state/deckStore.ts`: `newDeckSettings`。
- `ipc/deckIpc.ts`: `createDeck`の引数追加。
- `components/NewDeckModal.tsx`: 選択UI(`SettingsPanel`の言語選択と
  同じボタン群)。
- `components/Studio.tsx`: `runCreate`への受け渡し。
- `domain/messages.ts`: 英日の文言(編集メニューと同じ名前)。

## テスト

- Rust: frontmatter組み立て関数のspec(各組み合わせ)とadversarial
  (既定値のみでキーが書かれない、未知の値・空文字・表記ゆれはエラーで
  何も作らない)。`create_deck`の既存テストが通ること。
- e2e: `e2e/new-deck-settings.e2e.ts`。新規作成ダイアログで4:3/日本語を
  選ぶと`createDeck`に値が渡り、開いたデッキのプレビューとサムネイルが
  4:3になること(mockTauri)、既定値、作成失敗時の保持、キャンセル後の
  既定値、日本語UIの文言。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `cargo test` グリーン
- [x] `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で4:3のデッキを作り、表示が崩れないこと
- [ ] 言語の既定値(`en`固定か、UI言語に合わせるか)
- [ ] ダイアログの見た目

## 先送り事項
