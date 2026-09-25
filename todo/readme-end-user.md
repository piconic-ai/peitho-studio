---
status: todo
description: READMEを利用者向けに書き直す — インストール、`peitho` CLIの要件、未署名時の起動手順、ショートカット(リリース前)
tags: [release, docs]
---

# リリース前: 利用者向けREADME

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `README.md`はDevelopment/Build/Brand/Licenseの4節だけで、
利用者がdmgを落として使い始めるための情報がない。しかも`README.md:9`
の「peithoリポジトリのローカルチェックアウトが必要(path依存)」は
**すでに古い**(`Cargo.toml:43`はgit tag依存)。

## スコープ

- **目的**: GitHubのリポジトリページを見た人が、(1) 何ができるアプリか、
  (2) どう入れるか、(3) 何が別途必要か(`peitho` CLI)、(4) 起動で
  つまずいたらどうするか、(5) 基本操作、を読めるようにする。
- **やらないこと**:
  - サイト(`site/`)の整備。READMEに閉じる。
  - スクリーンショットの撮り直しを伴うデザイン作業。1枚あればよい。
  - Peitho自体(Markdown記法・レイアウト)の解説。upstreamにリンクする。
  - 日本語版README(UI i18nは済んでいるが、READMEは英語1本で始める。
    要望があれば後で)。
- **受け入れ条件**:
  - `README.md:9`の古い記述が消え、開発手順が現状(git tag依存)と一致
    している。
  - 「Install」節: Releasesページからdmgを落として`Applications`に
    入れる手順。署名の有無(`todo/release-build-workflow.md`の決定)に
    応じて、未署名なら起動許可の手順(macOSのバージョン別)が書かれて
    いる。
  - 「Requirements」節: 対応macOSの最低バージョン(`todo/release-app-
    metadata.md`の`minimumSystemVersion`と同じ値)、Presentに`peitho`
    CLIが必要なことと、互換バージョン(`Cargo.toml`のtag)。
  - 「Usage」節: 3カラムの説明、新規デッキ/開く(保存は自動で、Cmd+S
    はない)、Present、主要なショートカット(メニュー: Cmd+N/O、
    Cmd+Z/Shift+Z、Cmd+,。スライド一覧: Cmd+Shift+↑/↓で移動、Cmd+Enter
    で新規、Cmd+X/C/Vはスライド単位。デバッグ: Cmd+Shift+D)。
  - 「Reporting bugs」節: ログの場所(`todo/release-logging.md`)と
    Issuesへのリンク。
  - スクリーンショット1枚(`docs/`か`brand/`配下、リポジトリに含める)。

## 背景・要調査

実際に読んで分かったこと:

- 現在のREADMEの冒頭説明(3カラム、ファイル監視で他ツールとの同時編集
  が可能)は良いので残す。
- Presentだけが`peitho` CLIを必要とし、描画は組み込み(README冒頭にも
  その旨がある)。CLIの探索先は`todo/peitho-cli-discovery.md`で広げる
  予定なので、READMEはその結果(`~/.cargo/bin`も見る)に合わせる。
- ショートカットの一覧はコード上に散っている: メニューは
  `src-tauri/src/lib.rs`(`build_menu_with_recents`)、エディタ側は
  `dom/codeEditor.ts`のkeymapとvim mode、デバッグスナップショットは
  Cmd+Shift+D(CLAUDE.md)。書く前に`lib.rs`のアクセラレータを
  grepして正とする。
- 設定の保存先は`~/Library/Application Support/studio.peitho.app/`
  (`settings.json`, `recent_decks.json`)。アンインストール時の案内に
  使える。
- LICENSE節に商標留保があるので残す。

要調査:

1. 署名の有無(`release-build-workflow.md`の人間判断待ち)。決まるまで
   両方の文面を用意しておき、決定後に片方を消す。
2. 未署名アプリの起動許可手順の実機確認(macOS 15以降とそれ以前で
   違う)。

## 方針

節構成: Intro(既存)→ Screenshot → Install → Requirements → Usage
(Shortcuts含む)→ Reporting bugs → Development(既存を修正)→ Build →
Brand → License。1コミット1節を目安に。

依存順: `release-app-metadata.md`(最低OS)、`release-build-workflow.md`
(署名)、`release-logging.md`(ログの場所)、`peitho-cli-discovery.md`
(探索先)の結論を取り込むので、**このtodoはそれらの後**に仕上げる。
先に着手する場合は該当箇所を`<!-- TODO: … -->`で残し、完了条件で
その残りがゼロであることを確認する。

## レイヤー配置

- `README.md`のみ。スクリーンショットは`docs/images/`(新規)。

## テスト

- 純粋関数なし。`grep -n 'TODO' README.md`が空であること、リンク切れが
  ないこと(`bunx markdown-link-check README.md`程度)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `grep -c 'path dependency' README.md`が0
- [ ] `grep -c 'TODO' README.md`が0
- [ ] READMEに書いたショートカットが`lib.rs`のアクセラレータと一致
  (目視だが、grepで突き合わせられる)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 文面の最終確認(特にInstallの起動許可手順)
- [ ] スクリーンショットの選定

## 先送り事項

- 日本語READMEまたは`site/`への利用者向けページ。
- CHANGELOG.md(tagprが初回で生成する)へのリンク。
