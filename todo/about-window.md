---
status: todo
description: macOS標準のAboutパネルを自前のAboutウィンドウに置き換え、アイコン・説明文・Version/Build/Commit・Website/GitHub/Licenseへのリンクを載せる(Ghostty風)
tags: [release, ui]
---

# 自前のAboutウィンドウ

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: 今のAbout(アプリメニューの「Peitho Studioについて」)は、
`tauri dev`で開くとアイコンがフォルダになり、名前とバージョンしか
出ない。Ghosttyのように、アイコン・サイトと同じ説明文・Version/Build/
Commit・GitHubなどへのリンクを載せたい。あわせて、無保証・免責を
書いたLICENSEへの導線にする(`todo/deck-script-trust.md`と同じく、事故
のときに自己責任と言える線引きの一部。kfly8、2026-09-28)。
kfly8の判断: 標準パネルの拡張ではなく自前のウィンドウにする。Docs
ボタンのリンク先はStudioのサイト。

## スコープ

- **目的**: Aboutメニューで、アプリ専用の小さなウィンドウを開く。
  アイコン、アプリ名、説明文、Version/Build/Commit、Website/GitHubの
  ボタン、CopyrightとLicenseへのリンクを表示する。
- **やらないこと**:
  - `tauri dev`でDockのアイコンがフォルダになる件(About以外)。
  - 更新の確認(「最新版があります」など)。
  - `SECURITY.md`の追加(別のPRで扱う)。
- **受け入れ条件**:
  - macOSのアプリメニューの「Peitho Studioについて」(macOS以外では
    Helpメニューの末尾)で、Aboutウィンドウが開く。すでに開いていれば
    前面に出すだけで、二つ目は開かない。
  - ウィンドウに次が表示される:
    - アイコン(`brand/app-icon.svg`)
    - 「Peitho Studio」
    - 説明文: サイト(`site/index.html`)と同じ「Write slides with
      Peitho. Plain Markdown and HTML, so AI can help you.」(日本語UIでは
      訳文)
    - Version(`package_info().version`)、Build、Commit(短いSHA。
      押すとGitHubのそのコミットのページが開く)
    - 「Website」(`https://peitho-studio.piconic.ai/`)と「GitHub」
      (`https://github.com/piconic-ai/peitho-studio`)のボタン
    - Copyright(`tauri.conf.json`の`bundle.copyright`)と、LICENSEへの
      リンク(`https://github.com/piconic-ai/peitho-studio/blob/main/LICENSE`)
  - リンクはすべて既定のブラウザで開く。

## 背景・要調査

実際に読んで分かったこと(2026-09-28):

- 今のAboutは`src-tauri/src/lib.rs`の`build_menu_with_recents`で
  `PredefinedMenuItem::about`に`AboutMetadata`(name/version/
  copyright/authors)を渡している。macOSではアプリメニュー、それ以外
  ではHelpメニューの末尾。
- muda 0.19.3の標準パネル(`platform_impl/macos/mod.rs`の
  `fire_menu_item_click`)はアイコンを指定できるが、credits欄は
  プレーンテキストの`NSAttributedString`で、リンクを押せない。
  だから自前のウィンドウにする。
- ページは複数持てる: `server.ts`は`dist/pages/<name>.html`を返し、
  `vite.config.ts`の`input`に`pages/index`がある。`pages/about.html`を
  足し、`vite.config.ts`の`input`にも足す。ウィンドウは
  `WebviewUrl::App("about.html")`で開く(dev時の`/index.html`の扱いは
  `server.ts`の56行目付近のコメント参照。`about.html`も同じ経路で
  返せるか確認する)。
- 外部リンクの開き方: Helpメニューは`src-tauri/src/help_links.rs`で
  URLをRust側に固定し、`lib.rs`で`opener().open_url`している。JSから
  任意のURLを開けるようにはしない(`todo/deck-script-tauri-access.md`で
  capabilitiesを絞った方針と同じ)。
- Build/Commitは今どこにも埋め込まれていない。`src-tauri/build.rs`は
  `cargo:rustc-env`で`PEITHO_STUDIO_TARGET`を渡しているので、同じ形で
  足せる。リリースは`.github/workflows/release-build.yml`の
  `bunx tauri build`。
- アイコンの素材は`brand/app-icon.svg`(サイトも使っている)。アプリの
  静的ファイルに置く方法は`pages/index.html`の
  `/static/favicon.svg`に合わせる。

## 方針

- **ウィンドウ**: label `about`、`pages/about.html`、幅360×高さ480
  程度、サイズ変更・最大化なし、中央に出す。すでにあれば
  `set_focus`だけ。メニューのクリックはRust側で処理する
  (`open_deck`の`pick_folder`と同じくフロントを経由しない)。
- **メニュー**: `PredefinedMenuItem::about`を`MenuItem::with_id(
  "about", labels.about(app_name))`に置き換える。
- **Build/Commit**: `build.rs`で
  - `PEITHO_STUDIO_COMMIT`: `git rev-parse HEAD`の結果。gitがない・
    失敗したときは空。
  - `PEITHO_STUDIO_BUILD`: `GITHUB_RUN_NUMBER`があればそれ、なければ
    `dev`。
  - `cargo:rerun-if-changed`で`.git/HEAD`などを見て、コミットが
    変わったら再ビルドされるようにする(実装時に詰める)。
- **情報の受け渡し**: コマンド`get_about_info()`が
  `{ name, version, build, commit, copyright }`を返す。
- **リンク**: コマンド`open_about_link(link)`。`link`は
  `"website" | "github" | "license" | "commit"`の列挙で、URLはRust側で
  組み立てる(`help_links.rs`と同じ形)。`commit`はビルドに埋め込んだ
  SHAから作るので、JSからSHAは受け取らない。
- **見た目**: Ghosttyのスクリーンショットに近い縦並び(アイコン → 名前
  → 説明文 → ラベルと値の表 → ボタン → Copyright/License)。
  Version/Build/Commitの値は等幅。ライト/ダークはアプリ本体の
  トークン(`/static/tokens.css`)に従う。
- **言語**: `domain/messages.ts`に文言を足し、設定の`ui_language`に
  従う。

## レイヤー配置

- `src-tauri/src/about.rs`(新規): `AboutLink`の列挙とURLの組み立て
  (純粋)、`get_about_info`/`open_about_link`コマンド、ウィンドウを
  開く関数。
- `src-tauri/src/lib.rs`: メニュー項目の差し替えと、クリック時に
  `about.rs`の関数を呼ぶ配線、`generate_handler!`への追加だけ。
- `src-tauri/build.rs`: `PEITHO_STUDIO_COMMIT`/`PEITHO_STUDIO_BUILD`。
- `pages/about.html`、`vite.config.ts`: 新しい入口。
- `components/AboutScreen.tsx`: 画面(IPCを呼ぶのでここ)。
- `ipc/`: `aboutIpc`(`get_about_info`/`open_about_link`)。
- `domain/about.ts`(必要なら): 表示用の整形(短いSHAなど)の純粋関数。
- `domain/messages.ts`: 文言。

## テスト

- Rust(`about.rs`の`mod tests`):
  - URLの組み立て: spec(各リンクのURL、`commit`はSHA入りのURL)、
    adversarial(SHAが空のとき`commit`はエラーかリンクなし)。
  - Buildの決め方を純粋関数にするなら: spec(`GITHUB_RUN_NUMBER`あり/
    なし)、adversarial(空文字)。
- `bun test`: 短いSHAの整形など、`domain/`に置いた関数のspec/
  adversarial(空文字、7文字未満)。
- e2e(`mockTauri`で`get_about_info`を返す): `about.html`を開くと各値が
  出る。各ボタンで`open_about_link`が正しい`link`で呼ばれる。commitが
  空ならCommitの行が出ない(またはリンクにならない)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン
- [ ] `bun run test:e2e` グリーン(上の新しいe2eを含む)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で確認する: メニューからAboutが開く、二回選んでも一枚だけ、
  各リンクがブラウザで開く、ライト/ダーク両方の見た目。
- [ ] リリースビルド(CI)でBuild/Commitに実際の値が入ること。

## 先送り事項

- `tauri dev`でDockのアイコンがフォルダになる件。
