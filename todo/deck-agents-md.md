---
status: todo
description: デッキにCoding Agent向けの指示ファイル(AGENTS.md)を置き、Peithoの書き方・確かめ方・Studioとのレビューの往復をエージェントが最初から分かるようにする
tags: [agent, crit, scaffold]
---

# デッキに置くエージェント向け指示(AGENTS.md)

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーとの設計相談(2026-09-28)。Coding Agentへの依頼を1回で
うまくいかせるには、エージェントがPeithoの書き方(レイアウトとスロット、
`layouts/`/`css/`の役割)と、直した後の確かめ方を最初から知っている必要が
ある。デッキにエージェント向けの指示ファイルを置けば、Studioから依頼する
ときもしないときも効く。

3本組のうちの1本。往復の仕組みは`todo/crit-review-bridge.md`、UIは
`todo/review-comment-ui.md`。**中身の一部(critの呼び方)は
`todo/crit-review-bridge.md`の要調査1の結論に依存する**(→ (c)に決定済み)ので、その結論が
出てから着手する。

## スコープ

- **目的**: 新しく作るデッキと、既存のデッキに、エージェント向けの指示
  ファイルを置けるようにする。
- **やらないこと**:
  - 指示の中身をデッキごとに自動で書き分けること(レイアウト一覧を埋め込む
    など)。固定の文面に、デッキのパス程度を差し込むだけにする。
  - 既存の`AGENTS.md`/`CLAUDE.md`の上書き・追記。既にあれば何もしない
    (または案内だけ出す)。
  - エージェント側のプラグインの導入(`crit install claude-code`など)。
- **受け入れ条件**:
  - New Deckで作ったデッキに、指示ファイルが入っている。
  - 既存のデッキで、指示ファイルがないときに、Studioから1クリックで追加
    できる(置き場所は`todo/review-comment-ui.md`の送信まわりか、メニュー)。
    既にあるファイルは上書きしない。
  - 指示には少なくとも次が書いてある:
    - Peithoの書き方は`peitho docs`(トピック: `writing-decks`、`layouts`、
      `frontmatter`)を読むこと
    - `deck.md`、`layouts/`、`css/`、画像(`img/`)の役割
    - 直した後に`peitho build`で確かめること(エラーは行番号付きで出る)
    - 背景画像などのファイルはレイアウトの要素から参照すること(CSSの`url()`は
      出力にコピーされない — `peitho docs layouts`の「Files a layout
      references」)
    - Studioからのレビューの受け取り方: デッキのフォルダで
      `crit --no-open deck.md`を実行して待つこと。Studioが同梱のcritで
      セッションを先に起動しているので、エージェントのcritはそれに繋がる
      (`todo/crit-review-bridge.md`の要調査1で(c)に決定)
      (Studioはデッキのフォルダの`crit status`でセッションを探すため、
      gitでないフォルダでは別の場所から起動したセッションが見つからない —
      `todo/crit-review-bridge.md`の要調査3の結論)

## 背景・要調査

実際に読んで・試して分かったこと:

- New Deckの雛形は`src-tauri/src/peitho.rs`の`scaffold_deck_files`が返す
  ファイル一覧(`deck.md`、`layouts/title-body-code.html`、
  `layouts/title-body-image.html`、`css/base.css`、
  `css/title-body-image.css`、`.gitignore`)。中身の定数は
  `src-tauri/src/engine/builtin.rs`。既存デッキへのファイル追加は、
  `engine/image_layout.rs`(画像レイアウトの追加)に、上書きしない・途中で
  失敗したら書いた分を消す、という前例がある。
- `peitho`(v1.34.0)の`new`の雛形(`crates/peitho/templates/new/`)には、
  エージェント向けのファイルは入っていない。
- `peitho docs`は「オフラインで読める、エージェントの参照に向いた案内」と
  自称していて、トピックは`getting-started`、`writing-decks`、`layouts`、
  `frontmatter`、`cli`。
- 試行(2026-09-28)で、エージェント役が背景画像を足すとき、CSSの`url()`では
  画像がコピーされないという仕様を`peitho docs layouts`で確かめる必要が
  あった。指示に書いておけば避けられる典型例。

要調査(着手時に確かめる):

1. ファイル名。`AGENTS.md`を主にし、Claude Code向けに`@AGENTS.md`を
   読み込むだけの`CLAUDE.md`も置くか。Claude Codeが`AGENTS.md`を直接読む
   かを、着手時点のドキュメントで確認する。
2. `.gitignore`との関係。指示ファイルはデッキと一緒にコミットされる前提で
   よいか(デッキを他人と共有したとき、相手のエージェントにも効く)。
3. upstream(`peitho new`)にも同じ指示ファイルを入れる提案をするか。
   Studioだけの話(critの往復)と、Peitho全般の話(書き方・確かめ方)を
   ファイル内で分けておくと提案しやすい。

## 方針

- 文面は`engine/builtin.rs`に定数として置き、New Deckの雛形に加える。
- 既存デッキへの追加は、画像レイアウトの追加と同じ作り(上書きしない、
  途中で失敗したら書いた分を消す)にする。
- 文面は英語で書く(エージェント向け、かつupstream提案の可能性があるため)。

## レイヤー配置

- Rust
  - `engine/builtin.rs`: 指示ファイルの文面。
  - `engine/`: 既存デッキに書くファイル一覧を決める純粋関数と、書き込み
    (`engine/image_layout.rs`と同じ形)。
  - `peitho.rs`: `scaffold_deck_files`への追加、既存デッキ向けのコマンド
    (例: `add_agent_instructions`)。`lib.rs`で登録。
- フロント
  - `ipc/deckIpc.ts`: コマンドの口。
  - 追加ボタンの置き場所は`todo/review-comment-ui.md`に合わせる。
  - `domain/messages.ts`: 文言。

## テスト

- Rust(`#[cfg(test)]`)
  - 雛形: spec(New Deckのファイル一覧に指示ファイルが入る、既存の
    `scaffold_deck_files`のテストの更新)、adversarial(中身が空でない)。
  - 既存デッキへの追加: spec(ないデッキに書ける)、adversarial(既に
    `AGENTS.md`がある、`CLAUDE.md`だけある、書き込みが途中で失敗 → 何も
    残らない)。
- 文面のテスト: 受け入れ条件に挙げた項目(`peitho docs`、`peitho build`、
  CSSの`url()`の注意、critの実行方法)が含まれていること。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン
- [ ] 要調査1〜3の結論をこのファイルに書いた

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 指示の文面の最終確認
- [ ] 実機で、指示ファイルのあるデッキでエージェントに依頼し、`peitho docs`
  を読んで`peitho build`で確かめる動きになるか確認する
- [ ] upstreamへの提案をするか(要調査3)

## 先送り事項

- (なし)
