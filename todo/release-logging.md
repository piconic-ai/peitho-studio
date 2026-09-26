---
status: wip
description: リリースビルドでもログファイルを書き、パニックも記録して、バグ報告に添付できるようにする(リリース前)
tags: [release, logging]
---

# リリース前: リリースビルドのログ出力

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `tauri-plugin-log`は**デバッグビルドでしか登録されていない**
(`src-tauri/src/lib.rs:252`, `if cfg!(debug_assertions)`)。配布版で
問題が起きたとき、ユーザーが添付できるログが何もない。

## スコープ

- **目的**: リリースビルドでもアプリのログディレクトリにログファイルを
  書き、Rust側のパニックもそこに残す。ユーザーがバグ報告に添付できる
  ようにHelpメニューの「ログファイルをFinderで表示」で辿れるようにする。
- **やらないこと**:
  - テレメトリ/クラッシュレポートの外部送信(現状ゼロ。入れない)。
  - フロント側の`console.*`をファイルに転送すること(WKWebViewの
    `console`はTauri側に届かない。必要なら`log`プラグインのJS APIを
    別途検討)。
  - ログの内容の充実(どこに`log::info!`を足すか)。まずは仕組みだけ。
- **受け入れ条件**:
  - `bunx tauri build`で作った`.app`を起動すると、`~/Library/Logs/
    studio.peitho.app/`(Tauriの`app_log_dir`)にログファイルができる。
  - 意図的なパニック(テスト用の隠しコマンドではなく、`cargo test`での
    フック検証)がログに`panic`として残る。
  - ログはサイズ上限でローテーションされ、無限に肥大しない。
  - Helpメニューに「Show Log File in Finder」があり、Finderでログファイルが
    選択された状態で表示される(ログディレクトリ名`studio.peitho.app`は
    `.app`で終わるためmacOSがアプリバンドル扱いし、フォルダを`open`すると
    起動に失敗する。ファイルをrevealする)。
  - デッキの本文や画像パスのような**ユーザーの内容はログに書かない**
    (パスのファイル名程度まで)。

## 背景・要調査

実際に読んで分かったこと:

- `lib.rs:248-256`: `tauri_plugin_log::Builder::default().level(Info)`
  をデバッグ時のみ登録。targetは既定(stdout+ログディレクトリ+webview)。
- `unwrap`/`expect`はテスト外で`expect`6箇所・`unwrap`0(`lib.rs:291`,
  `engine/serve.rs:64-90`, `engine/pipeline.rs:241`)。Mutexは`if let Ok`
  で扱っており毒化で落ちない。パニック時のフックは**ない**。
- エラーはStatusBar経由でユーザーに見えるが、ファイルには残らない。
- `tauri-plugin-log`は`Target::new(TargetKind::LogDir { file_name })`と
  `max_file_size`/`rotation_strategy`を持つ。
- Finderでログファイルを表示するには`todo/release-app-metadata.md`で入れる
  openerプラグイン(`reveal_item_in_dir`/`open_path`)を使う。依存順:
  そちらが先。

要調査:

1. `log_panics`クレートを足すか、`std::panic::set_hook`で`log::error!`
   するだけにするか。依存を増やさない後者が第一候補。
2. リリース時のログレベル(`Info`か`Warn`か)。

## 方針

- `lib.rs`のプラグイン登録を条件なしにし、ビルド種別で**targetと
  レベルだけ**変える: デバッグ=stdout+LogDir+Info、リリース=LogDir+Info
  (要調査2)。`max_file_size`を数MB、`rotation_strategy`を
  `KeepOne`または`KeepAll`+上限に。
- `setup`の先頭で`std::panic::set_hook`を設定し、パニックのメッセージ
  と位置を`log::error!`で書いてから既定のフックにも渡す。
- Helpメニューに「Show Log File in Finder」を追加(`i18n.rs`に日英ラベル)。
- 記録する内容の指針を`lib.rs`のdocコメントに1段落書く(ユーザー内容を
  書かない)。

## レイヤー配置

- `src-tauri/src/lib.rs`: プラグイン登録・パニックフック・メニュー項目
  (いずれも配線)。フック本体の整形(メッセージ→1行文字列)は純粋関数
  `format_panic(info: &PanicHookInfo) -> String`として同ファイルの
  小さな関数に切り出し、テスト対象にする。
- `src-tauri/src/i18n.rs`: ラベル。

## テスト

- `format_panic`: spec(メッセージ+位置あり)、adversarial(位置なし、
  payloadが`&str`でも`String`でもない、改行を含むメッセージが1行に
  畳まれる)。
- 実機: リリースビルドを起動してログファイルの生成を確認、Helpメニュー
  からFinderでログファイルが選択表示されること。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `cargo test` グリーン
- [x] `bunx tauri build`後に`.app`を起動し、`ls ~/Library/Logs/
  studio.peitho.app/`にファイルがある

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] ログレベルとローテーション上限の値 — Info(開発ビルドは自クレートのみDebug)、5MBで`KeepSome(1)`(直前の1ファイルを残し最大約10MB)
- [ ] READMEの「バグ報告のしかた」にログの場所を書く
  (`todo/readme-end-user.md`と連携)

## 先送り事項

- フロント側のエラー(BarefootJSの例外、IPC失敗)をログに流す経路。
- 「ログをクリップボードにコピー」のようなワンクリック導線。
