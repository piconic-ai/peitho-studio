---
status: wip
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

### 要調査の結論(2026-09-28、crit 0.21.0で確認)

固定したのは0.21.0(着手時の最新)。試行で使った0.20.1と同じ往復が
0.21.0でもそのまま通ることを、結合テスト(`src-tauri/src/crit.rs`の
`crit::tests::round_trip`)で確かめている。

1. **エージェントが使うcritを揃える方法 — (c)に決定(ユーザー、2026-09-29)。**
   実装は`todo/review-comment-ui.md`で行う(Studioが同梱のcritでセッションを
   起動する)。
   - HTTP APIを答えるのは、そのセッションを最初に起動した`crit`のデーモン。
     同梱の0.21.0で`crit --no-open deck.md`を先に起動しておき、PATH上の
     Homebrew版0.20.1で同じ`crit --no-open deck.md`を実行すると、0.20.1は
     `Connected to crit daemon`で既存のデーモンに繋がり、完了の通知は両方に
     届いた。つまり**デーモンを誰が起動したか**でAPIのバージョンが決まる。
   - (a)は単独では揃わない。完了時にcritが出す指示文(`crit comment
     --reply-to …`、`crit --session <id>`)も、`crit install claude-code`が
     入れるskill(`.claude/skills/crit*/SKILL.md`)も、素の`crit`(PATH上)を
     呼ぶ。1巡目だけ絶対パスで起動しても、そのデーモンが生きている限りは
     同梱版のAPIのままだが、デーモンを誰かが止めて次にPATH上のcritが起動
     すれば、そちらのバージョンになる。
   - (b)はHomebrew版と名前がぶつかる(`/opt/homebrew/bin/crit`)。
   - (c)は、エージェントがどのcritを使っても、Studioが話す相手が同梱版に
     なる。このPRでは実装していない(Studioが自分でデーモンを起動する口は
     作っていない)。受け入れ条件どおり、エージェントが起動したセッションを
     見つけて話すところまで。(c)に進むなら、Studioが同梱のcritで
     `crit --no-open deck.md`を起動する(そのプロセスは完了の通知で終わるが、
     コメントが1件以上あればデーモンは次の巡のために残る)。
2. **Tauriへの同梱 — `bundle.externalBin`(`binaries/crit`)。**
   - tauri-buildがビルドのたびに`binaries/crit-<target-triple>`を実行ファイル
     の隣へコピーし、`.app`では`Contents/MacOS/crit`になる。Studioは
     `current_exe()`の隣から探す(`CritCli::bundled`)ので、devビルドと
     配布用で同じ。`resources`で入れると署名の扱いが実行ファイルと別に
     なるため選ばなかった。
   - バイナリはコミットしない。`src-tauri/crit-release.json`がバージョンと
     各バイナリのSHA-256を固定し、`bun run crit:fetch`
     (`scripts/fetch-crit.ts`)がGitHub Releasesから取ってきてハッシュを
     確かめる。`build.rs`はバイナリがないと`crit:fetch`を促すメッセージで
     止まる。更新手順はREADMEの「Updating the bundled crit」。
   - リリース手順への組み込み: `release-build.yml`の`tauri build`は
     `beforeBuildCommand`(`bun run build:app`)で`crit:fetch`を実行する。
     `test.yml`のrustジョブにも`crit:fetch`を追加した。
   - 署名・公証: critの配布バイナリは`adhoc,linker-signed`で、Developer ID
     の署名はない。tauriのbundlerは`externalBin`もアプリと同じIDで署名する
     はずだが、**公証まで通るかは配布用ビルドでしか確かめられない**(人間の
     判断が必要な項目)。署名なしの`tauri build --bundles app --no-sign`で、
     `Contents/MacOS/crit`と`Contents/Resources/licenses/crit/LICENSE`が
     入ることは確認した。
3. **セッションの見つけ方 — `crit status --json`をデッキのフォルダで実行し、
   各セッションの`GET /api/session`で照合する。**
   - `crit status --json`が列挙するのは、gitでないフォルダではそのフォルダで
     起動したセッションだけ、gitリポジトリの中ではリポジトリ内のすべて。
     0.21.0の`sessions[]`には`running`がない(動いているものだけが出る)。
   - `sessions[].args`は入力した文字列そのまま(`./deck.md`、絶対パス、
     リポジトリのルートからの`talks/a/deck.md`)で、起動したフォルダが
     分からないため照合に使えない。代わりに各デーモンの`/api/session`が返す
     `cwd`と`files[].path`を結合し、デッキのパスと比べる(両方を
     `canonicalize`して、`/tmp`と`/private/tmp`の違いを吸収)。gitの中では
     `cwd`がリポジトリのルートになり、`files[].path`はそこからの相対パス。
     コメントのAPIの`?path=`にはこの`files[].path`を渡す。
   - 同じデッキに2つ以上のセッションがあるときは、どちらにエージェントが
     いるか分からないので`ambiguous`として返し、送らない。
   - `~/.crit/sessions/*.json`を直接読む方法は、内部のファイル形式に依存する
     ため採らなかった。
   - 制約: gitでないフォルダで、デッキのフォルダ以外から`crit`を起動した
     セッションは見つからない。`todo/deck-agents-md.md`の指示に「デッキの
     フォルダで`crit --no-open deck.md`を実行する」と書く。
4. **ライセンス表記 — 同梱物に入れた。About画面は先送り。**
   `src-tauri/licenses/crit/LICENSE`(v0.21.0のタグのもの)を
   `bundle.resources`で`.app/Contents/Resources/licenses/crit/LICENSE`に
   入れる。MITの条件(著作権表示と許諾表示を複製に含める)はこれで満たす。
   About画面への表記は、UIを作る`todo/review-comment-ui.md`の側で検討する。

実装して分かったこと(`todo/review-comment-ui.md`向け):

- **完了の通知は、その瞬間に待っている`crit`にしか届かない。** エージェント
  が返信している間(`crit --session <id>`を実行する前)に完了を通知すると、
  その巡はエージェントに渡らず、後から`crit --session`で待ち始めても届か
  ない。待っているかどうかを知るAPIは見当たらなかった(`/api/health`の
  `browser_clients`はブラウザの数)。送信ボタンは、`crit-review`の
  `commentsChanged`(エージェントが次の巡に入った)を受けてから押せるように
  するなどの工夫が要る。
- **コメントなしで完了すると承認扱いになり、デーモンが終了する**
  (`crit-review`の`ended`が届く)。
- 0.21.0では`quote`と`anchor`は別物: `quote`は送った文字列のまま、
  `anchor`はその行のファイル上の実際のテキスト。
- 0.21.0では巡が進んでもコメントのIDが保たれた(`carried_forward: true`)が、
  0.20.1では振り直されたので、引き続きIDに頼らない。
- e2e: まだフロントに呼び出し元(UI)がないため、`mockTauri`でのe2eは
  `todo/review-comment-ui.md`で書く。フロントの口は`ipc/fakeCritIpc.ts`と
  その単体テストで押さえた。

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
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `cargo test` グリーン(結合テストを含む)
- [x] 要調査1〜4の結論をこのファイルに書いた

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] 要調査1(エージェントが使うcritを揃える方法)の最終決定 — (c)
- [ ] 配布用ビルドで、同梱したcritが署名・公証を通ること(リリース手順の
  実行はユーザーが行う)
- [x] 実機で、Claude Codeなど実際のエージェントとの往復を確認する
  (このPRではまだUIがないため、`crit_*`コマンドを呼ぶ画面の操作はない。
  往復そのものは結合テストが同梱のcritで確かめている。Tauriのコマンド
  経由・実際のエージェントでの確認は`todo/review-comment-ui.md`のUIが
  できてから — PR #133 の実機確認でClaude Codeとの往復を確かめた)

## 先送り事項

- critの作者への相談: 「外部からUIを作るためのAPI」の公開、Shadow DOMの
  中の要素へのピン(live画面)。Studioでの使い方が固まってから。
