---
status: wip
description: tagprが切るタグでmacOS用dmgをビルドしてGitHub Releaseに添付するワークフローを追加し、署名・公証の方針を決める(リリース前)
tags: [release, ci, signing]
---

# リリース前: ビルド&配布ワークフローと署名・公証

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `tagpr.yml`はリリースPRをマージするとタグとGitHub Releaseを
作るが、**そのReleaseに配布物を添付するワークフローがない**。このままだと
Releaseは本文だけで、ユーザーはソースからビルドするしかない。

## スコープ

- **目的**: `v*`タグが押されたら、macOS用の`.dmg`(Apple Silicon、必要なら
  Intelも)をビルドし、tagprが作ったReleaseに添付する。Gatekeeperで
  弾かれないための署名・公証を、やる/やらないを決めたうえで組み込む。
- **やらないこと**:
  - Windows/Linuxビルド(Studioは今のところmacOSでしか実機検証していない。
    CLAUDE.mdのWKWebView前提)。
  - 自動アップデート(`todo/app-updater.md`、inbox)。
  - テストCI(`todo/release-ci-tests.md`)。ただしこのワークフローは
    テストCIが通った`main`から切られるタグでのみ動く前提。
- **受け入れ条件**:
  - `v0.1.0`のようなタグを押すと(またはtagprのReleaseが作られると)、
    ワークフローが`.dmg`をビルドしてそのReleaseのassetsに添付する。
  - 署名・公証を**する**と決めた場合: 別のMacでdmgをダウンロードして
    開き、Gatekeeperの警告なしに起動する。
  - 署名・公証を**しない**と決めた場合: READMEに、macOSのバージョン別に
    起動を許可する手順(「システム設定 > プライバシーとセキュリティ」か
    `xattr -d com.apple.quarantine`)が書かれている(`todo/readme-end-
    user.md`と分担: 手順の本文はREADME側、決定はこちら)。
  - Releaseページに載るファイル名にバージョンとアーキテクチャが入る
    (例 `Peitho-Studio_0.1.0_aarch64.dmg`)。

## 背景・要調査

実際に読んで分かったこと:

- `.tagpr`: `vPrefix = true`, `releaseBranch = "main"`, `versionFile =
  "src-tauri/Cargo.toml"`, `changelog = true`(`CHANGELOG.md`は初回実行で
  生成される)。`postVersionCommand`が`scripts/sync-tauri-version.sh`で
  `tauri.conf.json`のversionを同期する。
- `.github/workflows/`に署名用のsecrets(`APPLE_CERTIFICATE`,
  `APPLE_ID`, `APPLE_TEAM_ID`等)への参照はない。
- `tauri.conf.json`に`bundle.macOS`セクションがなく、`signingIdentity`
  /`entitlements`/`hardenedRuntime`は未設定。
- Tauri公式の`tauri-apps/tauri-action`は、タグをトリガーに`tauri build`
  を走らせ、既存Releaseへのアップロード(`releaseId`指定)に対応している。
  Apple署名はenvに`APPLE_CERTIFICATE`(base64のp12)、
  `APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、公証は
  `APPLE_ID`/`APPLE_PASSWORD`(App用パスワード)/`APPLE_TEAM_ID`を渡す
  だけで`tauri build`側が処理する。
- ビルドには`bun`と、`beforeBuildCommand`の`bun run build`(vite+unocss)
  が必要(`tauri.conf.json:10`)。
- 署名・公証には**Apple Developer Program(有料、年額)**への加入が必要。
  未加入なら「しない」しか選べない。
- 未署名アプリの起動許可手順は、macOS 15(Sequoia)以降でControl+クリック
  →「開く」の抜け道が使えなくなり、「システム設定 > プライバシーと
  セキュリティ」で許可する必要があると理解している(推測を含む。README
  に書く前に実機で確認する)。

要調査:

1. ユーザーがApple Developer Programに加入済みか/加入する意思があるか
   (人間の判断 — これで方針が2つに分かれる)。
2. tagprが作るReleaseと`tauri-action`のアップロード先の突き合わせ方
   (`release`イベントの`published`をトリガーにして`releaseId`を渡すのが
   素直)。
3. Universal binary(`--target universal-apple-darwin`)にするか、
   aarch64だけにするか。Universalはビルド時間が倍近くになる。

## 方針

> 実装時の修正: `release: published`トリガーは使えない。tagprは
> `GITHUB_TOKEN`でReleaseを作り、`GITHUB_TOKEN`由来のイベントは別の
> ワークフローを起動しない。代わりに`tagpr.yml`が`tag`出力を見て
> `release-build.yml`を`workflow_call`で呼ぶ(手動再実行用に
> `workflow_dispatch`も持つ)。`tauri-action`は使わず、`tauri build`と
> `gh release upload`を直接書いている。

`.github/workflows/release-build.yml`(新規)を`release: published`
トリガーで動かす:

1. `macos-latest`で`setup-bun` → `bun install --frozen-lockfile` →
   `dtolnay/rust-toolchain` → `Swatinem/rust-cache`。
2. `tauri-apps/tauri-action@v0`で`releaseId: ${{ github.event.release.id
   }}`、`args: --target aarch64-apple-darwin`(要調査3でUniversalに
   変えてよい)。
3. 署名・公証は要調査1の結果で分岐:
   - する: 上記secretsをリポジトリに登録し、`bundle.macOS`に
     `hardenedRuntime: true`と最小の`entitlements.plist`を置く。
     `signingIdentity`はenvで渡すので設定ファイルには書かない。
   - しない: ワークフローはそのまま(未署名dmg)。READMEに起動許可の
     手順を書く(`todo/readme-end-user.md`側の受け入れ条件に反映済み)。
     初回リリース後に署名に切り替えても、identifierが変わらない限り
     設定ファイルの移行は不要。

初回は「しない」で出してもよいが、**どちらにするかを決めてから**
タグを押す — Release本文とREADMEの記述が変わるため。

> 経過(実装後):
> - `v0.1.0-rc.1`の未署名dmgは「壊れている」と表示され開けなかった。
>   実行ファイルのリンカ署名だけでバンドルが封印されていなかったため。
>   `bundle.macOS.signingIdentity: "-"`(アドホック署名)で解消(#101)し、
>   `v0.1.0-rc.2`は「検証できませんでした」→システム設定で許可、の
>   通常の未公証アプリの挙動になった。
> - 利用者にその許可を求めたくないため、署名・公証を「する」に変更。
>   残作業: Developer ID Application証明書(.p12)と公証用の認証情報
>   (App Store Connect APIキー推奨)をsecretsに登録し、
>   `release-build.yml`のbuildステップにenvとして渡す。
>   `signingIdentity: "-"`は外す(envの`APPLE_SIGNING_IDENTITY`が使われる)。

## レイヤー配置

- `.github/workflows/release-build.yml`(新規)。
- `src-tauri/tauri.conf.json`の`bundle.macOS`(署名する場合のみ)、
  `src-tauri/Entitlements.plist`(同上)。
- アプリのコードは変えない。

## テスト

- 純粋関数は増えない。ワークフローは、`v0.1.0-rc.1`のようなプレリリース
  タグで一度通し、dmgが添付されることと、別Macでの起動を確認する
  (署名する場合は`spctl -a -vv "Peitho Studio.app"`で`accepted`が
  出ること)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] プレリリースタグでワークフローが成功し、`gh release view <tag>`
  でdmgがassetsに載っている(`v0.1.0-rc.1`、`v0.1.0-rc.2`)
- [ ] (署名する場合)`codesign --verify --deep --strict`と`spctl -a`が
  通る

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] 署名・公証をするかどうか(Apple Developer Programの加入) — **する**。
  当初は「しない」で進めたが、未署名だとシステム設定での許可を利用者に
  求めることになるため方針変更し、Developer Programに個人で加入申請済み
  (承認待ち)。法人化したら個人→法人に切り替える(Team IDは維持される
  とされる。切り替え後にDeveloper ID証明書を法人名で再発行する想定)
- [x] Universal vs aarch64のみ — aarch64のみ
- [ ] 別Macでdmgをダウンロードして起動する確認(署名・公証後に、
  Gatekeeperの警告なしで開けること。未署名の`v0.1.0-rc.2`は「検証
  できませんでした」になりシステム設定での許可が必要だった)

## 先送り事項

- `createUpdaterArtifacts`と`tauri-plugin-updater`(`todo/app-updater.md`)。
- Homebrew cask での配布(署名の有無で受理条件が変わる)。
