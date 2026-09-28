---
status: todo
description: バージョンを固定したcritをStudioに同梱し、Rust側からcritのレビューセッションにコメント登録・完了通知・返信の受け取りをする
tags: [agent, crit, rust-command, release]
---

# critとの連携: 同梱と往復の口

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーとの設計相談(2026-09-28)。「エラーの修正、スライドの微調整、
グラフなど動的な要素の追加、スライドの叩き作りを、Coding Agentに頼みたい」。
LLMの埋め込み(Apple Foundation Models等)や自分のキーで動くエージェントの
埋め込みは、キー入力の負担と能力不足で見送り、**ユーザーが既に使っている
Coding Agentに依頼する**方向に決めた。そのうえで[crit](https://crit.md/)
(MIT、Go製の単一バイナリ)を実際に試し、「対象箇所にコメント → エージェント
が直して返信 → 不満ならレスを返す」という往復が最高の体験だと確認した。
一方critのlive画面はスライド移動(Navigate)とコメント(Pin)のモード切替が
面倒で、Shadow DOMの中の要素にピンを打てない。そこで**UIはStudio、往復の
仕組みはcrit**(案A)とし、**critはバージョンを固定して同梱する。熟れたら
critの作者に、外部からUIを作るためのAPIを相談する**と決めた。

3本組のうちの1本(仕組みの側)。UIは`todo/review-comment-ui.md`、デッキに
置くエージェント向け指示は`todo/deck-agents-md.md`。**このtodoを先に
進める**(UIはここで作るコマンドを呼ぶ)。

## スコープ

- **目的**: Studioの中から、エージェントが待っているcritのレビューセッション
  に行コメントを登録し、完了を通知し、エージェントの返信を受け取れるように
  する。その前提として、固定バージョンのcritをアプリに同梱する。
- **やらないこと**:
  - コメントUI(`todo/review-comment-ui.md`)。
  - critの画面(live/preview)をStudioに埋め込むこと(案B、見送り)。
  - critと同等の仕組みの自作(案C)。APIが不安定と分かったときの退路として
    だけ残す。
  - エージェントのCLIをStudioから起動すること、キーの管理。
  - critの作者への相談(熟れてから、別途)。
  - Windows/Linux向けのバイナリ(アプリがmacOS配布のみ)。
- **受け入れ条件**:
  - 配布用ビルドの`.app`に、固定バージョンのcrit(darwin arm64/amd64)が
    入っている。バージョンは1か所(定数か設定)で決まり、更新手順が書いて
    ある。
  - 開いているデッキについて、エージェントが`crit ... deck.md`で待っている
    セッションをStudioが見つけられる(ないときは「ない」と分かる)。
  - Studioのコマンドで、そのセッションに`deck.md`の行コメント(行範囲・本文・
    引用・作者)を登録し、完了を通知すると、エージェント側の`crit`が終わって
    そのコメントが渡る。
  - エージェントが`crit comment --reply-to`で返信して次の巡に入ると、Studio
    にイベントが届き、コメントとその返信の一覧を読み直せる。
  - 上記の往復が、同梱したcritのバージョンで自動テストされている。

## 背景・要調査

実際に試して分かったこと(crit 0.20.1、2026-09-28、試行は作業用フォルダで
`peitho`の`examples/keynote`のコピーを使用):

- **エージェント側の流れ**: エージェントが`crit --no-open deck.md`を実行する
  と、デーモンが立ち上がり、人が完了するまでコマンドが終わらない。完了すると
  未解決コメントのJSONと「各コメントに`crit comment --reply-to <id>
  --author <名前> "<説明>"`で返信し、終わったら`crit --session <id>`を
  実行せよ」という指示が出力される。エージェントはそれに従うだけで往復できた
  (手順書がほぼ不要)。
- **Studio側から使えたHTTP API**(デーモンのポートは`crit status --json`の
  `sessions[].port`、デッキのフォルダで実行):
  - `POST /api/file/comments?path=deck.md`に
    `{"start_line","end_line","body","quote","author"}` → 即座に登録される。
    `quote`は`anchor`として保存され、行がずれても位置を追う手がかりになる。
  - `POST /api/finish` → エージェント側の`crit`が終わり、コメントが渡る。
  - `GET /api/events`(SSE) → エージェントが次の巡に入ると
    `event: file-changed`が届く。
  - `GET /api/file/comments?path=deck.md` → 各コメントと`replies`。
- **落とし穴**:
  - `crit comment`(CLI、デーモンを通さずレビューファイルに書く)は、デーモン
    が約1秒ごとに読み直すまで反映されない。直後に完了を通知するとコメントが
    漏れ、「コメントなしで承認」になった。**StudioはHTTP APIで登録する。**
  - 巡が進むとコメントのIDが振り直される(`c_e4b825` → `c_ed2731`)。
    Studio側でコメントを追うときはIDではなく、行と`quote`で対応づける。
  - 状態を変えるリクエストは、`Sec-Fetch-Site`が付いたブラウザからは
    same-originしか通らない(CSRF対策)。ヘッダーを付けないRust側から呼ぶ。
  - HTTP APIはcrit自身の画面用の内部APIで、公開仕様ではない。
- **リリースの頻度**: ほぼ週1(v0.20.0 9/4、v0.20.1 9/8、v0.20.2 9/18、
  v0.20.3 9/24、v0.21.0 9/28)。バイナリは`crit-darwin-arm64`/
  `crit-darwin-amd64`と`checksums.txt`がGitHub Releasesにある。
- 試したのは0.20.1だけ。固定するバージョンで上記を確かめ直す。

要調査(着手時に確かめる):

1. **エージェントが使うcritと、Studioが同梱するcritを揃える方法。** 往復の
   デーモンを立ち上げるのはエージェント側の`crit`なので、エージェントが
   PATH上の別バージョン(Homebrew等)を使うと、Studioが話すAPIのバージョンは
   固定されない。候補:
   - (a) デッキの`AGENTS.md`(`todo/deck-agents-md.md`)に同梱バイナリの
     絶対パスで実行するよう書く。
   - (b) VS Codeの「シェルコマンドをインストール」のように、同梱バイナリへの
     リンクをPATHに置く(既存のHomebrew版と名前がぶつかる)。
   - (c) Studioがデーモンを先に立ち上げ、エージェントは`crit --session <id>`
     で繋ぐ。
   どれが成り立つかを試して決める。critの`crit install claude-code`等の
   プラグインが呼ぶコマンド名も確認する。
2. **Tauriへの同梱方法。** `bundle.externalBin`(sidecar、ターゲットトリプル
   付きのファイル名が必要)で入れるか、`resources`で入れるか。コード署名・
   公証(notarization)との兼ね合い(同梱バイナリも署名が要るか)。
   `todo/archive/release-build-workflow.md`のリリース手順に組み込む。
3. **セッションの見つけ方。** `crit status --json`をデッキのフォルダで実行して
   `sessions[].args`が`deck.md`を含むものを選ぶか、`~/.crit`の中を読むか。
   ポートはセッションごとにランダム。デッキのフォルダがgitリポジトリでない
   場合の挙動も確かめる。
4. **ライセンス表記。** MITの著作権表示を同梱物・About画面のどこに載せるか。

## 方針

- 案A(UIはStudio、往復はcrit)で決定済み。critはバージョン固定で同梱。
- Rust側に、デッキのフォルダを受け取ってcritと話す層を作る。HTTPは
  `127.0.0.1`宛てに限る。
- SSEの購読はウィンドウごと(デッキごと)に持ち、`window.label()`をキーに
  した状態として`peitho.rs`に置く(複数ウィンドウの落とし穴、CLAUDE.md)。
- 使うAPIの形(リクエスト/レスポンスのJSON)はRustの型で固定し、固定バー
  ジョンのcritに対する結合テストで守る。critを更新するときはこのテストが
  通ることを条件にする。
- 要調査1の結論次第で`todo/deck-agents-md.md`の中身が変わる。先に決めて
  そちらに反映する。

## レイヤー配置

- Rust
  - `engine/`: critのレスポンスJSON → Studioの型への変換、`crit status
    --json`の出力からデッキのセッションを選ぶ関数(どちらも純粋関数)。
  - 新しいモジュール(例: `src-tauri/src/crit.rs`): 同梱バイナリの場所の解決、
    HTTPクライアント、SSEの購読。状態(購読中のSSE)は`peitho.rs`側の
    ウィンドウごとのマップに置く。
  - `peitho.rs`: Tauriコマンド(例: `crit_session_status`、
    `crit_add_comments`、`crit_finish`、`crit_list_comments`)と、返信が
    来たことを知らせるイベントの発行。`lib.rs`で登録。
- フロント
  - `ipc/critIpc.ts`: 上記コマンドとイベントの型付きの口。
  - コメントの型は`domain/`に置き、`todo/review-comment-ui.md`と共有する。

## テスト

- Rust(`#[cfg(test)]`)
  - セッションの選択: spec(`deck.md`を待つセッションが1つ)、adversarial
    (セッションなし、別ファイルのセッションだけ、同じデッキに2つ、JSONが
    壊れている、`running: false`)。
  - レスポンスの変換: spec(返信つきのコメント)、adversarial(返信なし、
    未知のフィールド、`quote`なし、行が0)。
- 結合テスト: 同梱と同じバージョンのcritを実際に起動し、試行と同じ往復
  (エージェント役のプロセスが`crit --no-open deck.md`で待つ → 登録 →
  完了 → 返信 → イベント)を確かめる。critの実行ファイルがないCI環境では
  スキップの扱いを決める。
- e2e(`e2e/`、`mockTauri`): コマンドのモックで、フロントからの呼び出しと
  イベントの受け取りを確かめる(UIの側は`todo/review-comment-ui.md`)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン(結合テストを含む)
- [ ] 要調査1〜4の結論をこのファイルに書いた

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 要調査1(エージェントが使うcritを揃える方法)の最終決定
- [ ] 配布用ビルドで、同梱したcritが署名・公証を通ること(リリース手順の
  実行はユーザーが行う)
- [ ] 実機で、Claude Codeなど実際のエージェントとの往復を確認する

## 先送り事項

- critの作者への相談: 「外部からUIを作るためのAPI」の公開、Shadow DOMの
  中の要素へのピン(live画面)。Studioでの使い方が固まってから。
