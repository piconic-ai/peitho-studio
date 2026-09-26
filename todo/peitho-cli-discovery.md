---
status: todo
description: `peitho` CLIが見つからない/バージョンが合わないときに、Presentを押す前に分かる案内を出す(リリース前)
tags: [release, present, error-handling]
---

# リリース前: `peitho` CLIの検出と未導入時の案内

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: Studioは描画を組み込みのpeitho-coreで行うが、**Presentだけは
インストール済みの`peitho` CLIを起動する**。CLIがない環境でPresentを
押すと「failed to launch `peitho present`: …」というOSのエラー文が
出るだけで、何を入れればよいか分からない。配布後に最初に踏まれる穴。

## スコープ

- **目的**: (1) CLIの探索場所を広げて見つけ損ないを減らす、(2) 見つから
  ないときはPresentボタンの手前で「`peitho` CLIが必要です」とインストール
  方法つきで案内する、(3) 組み込みpeitho-coreとCLIのバージョン差を検出
  して警告する。
- **やらないこと**:
  - CLIをStudioに同梱する(peithoのCLIバイナリをバンドルに含める案。
    ライセンスとサイズと更新の同期の問題があるので、別途検討)。
  - PresentをCLIなしで実現する(Studio自身がプレゼン用ウィンドウを持つ)。
  - Homebrew formula/caskの整備(upstreamの領分)。
- **受け入れ条件**:
  - `~/.cargo/bin/peitho`にだけCLIがある環境で、Presentが動く。
  - CLIがどこにもない環境で、デッキを開いた時点(またはPresentメニューを
    開いた時点)で「`peitho` CLIが見つかりません」とインストール方法へ
    の導線(README/upstreamのURL)が表示され、Presentボタンが無効になる。
  - CLIの`--version`が組み込みpeitho-core(`Cargo.toml`のtag、現在
    v1.34.0)とメジャー/マイナーで食い違うとき、StatusBarに警告が出る
    (Presentは止めない)。
  - 上記の判定はウィンドウ表示を止めない(`#[tauri::command(async)]`)。

## 背景・要調査

実際に読んで分かったこと:

- `src-tauri/src/peitho.rs:233-250` `peitho_binary()`: PATHの`peitho`を
  `--version`で試し、次に`/opt/homebrew/bin/peitho`、`/usr/local/bin/
  peitho`。見つからなければ`"peitho"`をそのまま返すので、失敗は起動時
  (`peitho.rs:749`)まで分からない。**`~/.cargo/bin`(`cargo install`の
  既定先)を見ていない。**
- Finderから起動したGUIアプリのPATHはシェルのそれより短い(同関数の
  docコメントにもある)。`/opt/homebrew/bin`を直接見るのはその対策。
- `Cargo.toml:39-42`のコメント: 組み込みpeitho-coreとCLIは「lockstep」で
  上げる前提だが、それを検査するコードはない。
- Present失敗はイベント`present-failed`(`peitho.rs:49, 96`)でフロントに
  届き、StatusBarにエラーとして出る(`components/StatusBar.tsx:10-29`)。
  Presentボタンの無効化条件は`DeckHeader.tsx`の`!props.deckPath ||
  props.presentPending`(CLAUDE.mdのBarefootJS注意点にある箇所)。
- `peitho --version`の出力形式は要確認(`peitho 1.34.0`のような1行と
  推測)。

要調査:

1. `peitho --version`の正確な出力(ローカルのCLIで確認)。
2. 検出結果をいつ取るか。起動時に1回(`setup`)で十分か、Presentメニュー
   を開くたびに再確認するか。CLIを後から入れた場合にアプリ再起動なしで
   気づけるのが望ましいので、後者+結果キャッシュが第一候補。

## 方針

- Rust: `peitho_binary()`を「候補パスの列挙(純粋)」と「存在確認
  (I/O)」に分ける。候補列挙は`engine/`ではなく`peitho.rs`内の
  純粋関数`cli_candidates(home: Option<&Path>) -> Vec<PathBuf>`として
  切り出し、`~/.cargo/bin/peitho`を足す。
- 新コマンド`#[tauri::command(async)] probe_peitho_cli() ->
  PeithoCliStatus`(ADT: `Found { path, version }` / `NotFound` /
  `FoundButUnparsableVersion { path, raw }`)。バージョン比較は純粋関数
  `compare_engine_versions(embedded: &str, cli: &str) -> Compat`
  (`Same` / `MinorMismatch` / `MajorMismatch` / `Unknown`)。組み込み側の
  バージョンは`build.rs`で`Cargo.lock`から埋め込むか、`peitho_core`が
  バージョン定数を公開していればそれを使う(要確認)。
- フロント: `domain/presentAvailability.ts`(新規、純粋)に
  `presentButtonState(status, deckOpen, pending) -> { enabled, reason }`
  を置き、`DeckHeader.tsx`の無効化条件と説明文をここから引く。
  文言は`domain/messages.ts`のi18nに乗せる。
- 見つからない場合の導線は、StatusBar上のメッセージにURL(READMEの
  該当節)を添える。URLを開くには`todo/archive/release-app-metadata.md`で入れる
  openerプラグインを使う(依存順: そちらが先)。

## レイヤー配置

- `src-tauri/src/peitho.rs`: `cli_candidates`(純粋)、`probe_peitho_cli`
  コマンド、`compare_engine_versions`(純粋)。状態は持たない。
- `src-tauri/src/lib.rs`: コマンド登録1行。
- `domain/presentAvailability.ts`(新規): ボタン状態の導出。
- `ipc/deckIpc.ts`: `probePeithoCli`呼び出し。
- `components/DeckHeader.tsx`, `components/Studio.tsx`: 配線。
  `DeckHeader`の無効化条件は**JSX内にインラインで書く**か`createMemo`
  経由にする(CLAUDE.mdの「constローカルは凍結される」項)。

## テスト

- Rust
  - `cli_candidates`: spec(homeあり→4候補、順序がPATH→homebrew→
    /usr/local→~/.cargo/bin)、adversarial(homeが`None`、homeが相対
    パス、空文字)。
  - `compare_engine_versions`: spec(`1.34.0` vs `1.34.0`→Same、`1.33.2`
    →MinorMismatch、`2.0.0`→MajorMismatch)、adversarial(空文字、
    `peitho 1.34.0`のような接頭辞付き、`v1.34.0`、`1.34`、`1.34.0-rc.1`、
    非数字)。
- `domain/presentAvailability.test.ts`: status×deckOpen×pendingの全
  組み合わせで`enabled`と`reason`が期待どおり。
- e2e(mockTauri): `probe_peitho_cli`が`NotFound`を返すとPresentが無効で
  理由が表示される、`Found`で有効になる。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` / `cargo test` グリーン
- [ ] `bun run test:e2e` グリーン(追加分含む)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で、CLIを一時的にPATHから外して案内が出ること、
  `~/.cargo/bin`だけにある状態でPresentが動くこと
- [ ] 案内文の文言(日英)

## 先送り事項

- CLIの同梱、またはPresentのStudio内実装。
- CLIのバージョンが古いときに「アップデート方法」まで案内するか。
