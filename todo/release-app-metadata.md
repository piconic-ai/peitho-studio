---
status: wip
description: 配布物に出る名前・著作権・カテゴリなどのバンドル情報を整え、テンプレート由来の残骸を消す(リリース前)
tags: [release, tauri-config, menu]
---

# リリース前: アプリのメタデータ整備

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: 配布物にそのまま出てしまう設定の不備。まだタグも
GitHub Releaseも存在しない(初回リリース前)。

## スコープ

- **目的**: `.app`の名前・Aboutダイアログ・Finderの情報など、ユーザーが
  最初に目にするメタデータを製品名「Peitho Studio」で統一し、
  `create-tauri-app`テンプレート由来の残骸を消す。
- **やらないこと**:
  - 署名・公証・ビルドワークフロー(`todo/release-build-workflow.md`)
  - README(`todo/readme-end-user.md`)
  - CSPの決定(`todo/deck-script-tauri-access.md`)
  - `.md`のファイル関連付け(`RunEvent::Opened`の処理が別途必要なので
    リリース後の別タスク)
  - アプリのアイコンそのもの(`brand/`で完了済み)
- **受け入れ条件**:
  - `bunx tauri build`で出る`.app`の名前、メニューバー左端のアプリ名、
    Aboutダイアログのタイトルがすべて「Peitho Studio」。
  - Aboutダイアログに著作権表記とバージョンが出る。
  - `src-tauri/Cargo.toml`の`name`/`repository`がテンプレート値でない。
  - `tauri.conf.json`に`android`セクションが残っていない。
  - `bundle.targets`がmacOS向け(`app`と`dmg`)に絞られている。
  - macOSのHelpメニューが空でない(リポジトリ/Issues/Releasesへのリンク)。
  - `.github/workflows/pullfrog.yml`先頭の「This repo is private」という
    コメントが現状(公開リポジトリ)に合わせて直っている。

## 背景・要調査

実際に読んで分かったこと:

- `src-tauri/tauri.conf.json:3` `productName: "peitho-studio"`。`lib.rs:52`
  が`pkg_info.name`をメニューのアプリ名に使うため、メニューバーもAboutも
  この小文字ハイフン名になる。ウィンドウタイトルだけ「Peitho Studio」
  (`tauri.conf.json:15`)で不揃い。
- `src-tauri/Cargo.toml:2,7`: `name = "app"`, `repository = ""`。
- `tauri.conf.json:23-25` `security.csp: null`(このtodoでは触らない)。
- `tauri.conf.json:29` `bundle.targets: "all"`。`macOS`セクションなし
  (`minimumSystemVersion`等もなし)。`category`/`copyright`/`publisher`/
  `shortDescription`もなし。`lib.rs:57-58`はAboutの著作権・authorsを
  configから読んでいるので、未設定だと空欄になる。
- `tauri.conf.json:37-39`に`android.debugApplicationIdSuffix`の残骸。
- バージョンは`tauri.conf.json:4`と`Cargo.toml:3`で`0.1.0`に揃っており、
  `.tagpr`の`postVersionCommand`(`scripts/sync-tauri-version.sh`)が同期
  する仕組みはある(`jq`依存)。
- Helpメニュー(`lib.rs:117-125`)はmacOSではAbout項目が
  `#[cfg(not(target_os = "macos"))]`で外れるため**空**。カスタム項目は
  `MenuItem::with_id`+`on_menu_event`で足せる(`settings::menu_item`が
  前例)。URLを開くには`tauri-plugin-opener`(または`tauri-plugin-shell`
  の`open`)が要る — どちらも未導入。opener の方が権限が狭い。
- メニュー文言は`src-tauri/src/i18n.rs`で日英を持つので、新項目も両方に
  足す。
- `bundle.macOS.minimumSystemVersion`の既定はTauri v2で`10.13`。
  WKWebViewの`adoptedStyleSheets`など、このアプリが依存する機能の
  最低OSは未確認(要調査)。

要調査:

1. `adoptedStyleSheets`/Shadow DOM/CSS `inset`回避などが動く最低macOS
   バージョン。分からなければ、開発機で確認できている最古の版を
   `minimumSystemVersion`に書き、READMEにも同じ値を書く。
2. `productName`を空白入りにしたときの`bunx tauri dev`/`build`の挙動
   (バンドル名は`Peitho Studio.app`になる。`identifier`は変えない —
   `~/Library/Application Support/studio.peitho.app/`の設定・最近開いた
   デッキの保存先がそこに紐づいているため)。

## 方針

1コミット1項目で進める(CLAUDE.mdのコミット粒度):

1. `productName` → `"Peitho Studio"`、`Cargo.toml`の`name` →
   `"peitho-studio"`、`repository`をGitHubのURLに。
2. `bundle`に`category: "Productivity"`, `copyright`, `publisher`,
   `shortDescription`, `longDescription`, `macOS.minimumSystemVersion`を
   追加。`targets`を`["app", "dmg"]`に。`android`セクション削除。
3. Helpメニューに「Peitho Studio on GitHub」「Report an Issue」
   「Releases」の3項目。`tauri-plugin-opener`を追加し、capabilityは
   `opener:allow-open-url`をこれら固定URLだけに絞る。
4. `pullfrog.yml`のコメント修正。

## レイヤー配置

- `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`: 設定のみ。
- `src-tauri/src/lib.rs`: Helpメニュー項目の構築とイベント分岐(配線
  だけ。URLの一覧は`i18n.rs`か新規`src-tauri/src/links.rs`の定数に)。
- `src-tauri/src/i18n.rs`: ラベル追加。
- `src-tauri/capabilities/default.json`: openerの権限。

## テスト

- 純粋関数は増えない想定。Helpメニューのラベル/URL対応表を関数に
  切り出すなら、その関数に「全ラベルにURLがある」「URLが`https://`で
  始まる」程度のspecテストを`i18n.rs`のテストに倣って足す。
- `cargo test`が通ること。`scripts/sync-tauri-version.sh`を一度手で
  走らせ、`productName`変更後もJSONが壊れないことを確認する。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `cargo test` グリーン、`bun run typecheck` グリーン
- [x] `bunx tauri build`が成功し、`src-tauri/target/release/bundle/macos/
  Peitho Studio.app`が生成される
- [x] `grep -c android src-tauri/tauri.conf.json`が0

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で、メニューバーのアプリ名とAboutダイアログの表記・著作権を確認
- [ ] `copyright`/`publisher`の文言(LICENSEは「Copyright (c) 2026 kfly8」)
- [x] `minimumSystemVersion`の値(13.0 Ventura に決定)

## 先送り事項

- `.md`のファイル関連付け(`bundle.fileAssociations`)と、Finderから
  ダブルクリックで開くための`RunEvent::Opened`処理。
- ウィンドウ位置・サイズの保存(`tauri-plugin-window-state`)。毎回
  1440x900で開く(`tauri.conf.json:16-17`)。
