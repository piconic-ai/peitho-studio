---
status: wip
description: PRとmainでフロント/Rustのテストと型検査を走らせるGitHub Actionsを追加する(リリース前)
tags: [release, ci]
---

# リリース前: テストCIの追加

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `.github/workflows/`には`pullfrog.yml`(AIレビュー)と`tagpr.yml`
(リリースPR作成)しかなく、**テストを走らせるCIが1つもない**。
リリースタグを切る前に、`main`が壊れていないことを機械的に保証したい。

## スコープ

- **目的**: PRと`main`へのpushで、`bun run typecheck`・`bun test`・
  `cargo test`が自動で走り、失敗がPRのチェックとして見える状態にする。
- **やらないこと**:
  - `bunx tauri build`とdmgの添付(`todo/release-build-workflow.md`)。
  - 実機Tauri e2e(`e2e-tauri/`)のCI化。`docs/tauri-playwright-spike.md:
    115-146`で「CI配線は未着手、ネイティブのフォルダ選択ダイアログを
    越えられない」と記録されている。別タスク。
  - ブラウザmock e2e(`e2e/`)の**必須化**。まずは任意ジョブとして
    足し、安定していれば後で必須にする。
- **受け入れ条件**:
  - PRを開くと`typecheck`/`bun test`/`cargo test`の3チェックが走り、
    すべてグリーンになる。
  - `main`でも同じワークフローが走る。
  - `e2e/`のPlaywrightスイートが別ジョブとして走る(失敗してもPRを
    ブロックしない設定でよい)。
  - ワークフローの所要時間が把握されている(Rustのキャッシュあり)。

## 背景・要調査

実際に読んで分かったこと:

- `package.json`のscripts: `test`=`bun test`、`typecheck`=`tsc --noEmit`、
  `test:e2e`=`playwright test`。
- `bun test`の対象は`domain/*.test.ts`, `dom/*.test.ts`, `scripts/
  arch-check.test.ts`(レイヤー構造の検査)など。
- `src-tauri/`の`cargo test`はpeitho-coreをgit依存で取る
  (`Cargo.toml:43`, `tag = "v1.34.0"`)。Tauri本体はmacOS以外でも
  ビルドできるが、Linuxランナーだと`webkit2gtk`等のaptパッケージが要る。
  **macOSランナー(`macos-latest`)を使えば追加依存なし**で、実配布物と
  同じ環境になる。ただしmacOSランナーは無料枠の消費が速い(Linuxの10倍)。
- `playwright.config.ts`は`channel: 'chrome'`でローカルのChromeを使う。
  GitHubのmacOS/ubuntuランナーにはChromeが入っているが、`bunx playwright
  install`で揃えるのが確実。ポートは`E2E_PORT`で変えられる。
- `tagpr.yml`はリリースPRを作るだけで、テストの成否を見ていない。

要調査:

1. `cargo test`をubuntuで通すための最小aptパッケージ一覧(Tauri公式の
   `Prerequisites`ページに記載)。macOSランナーのコストと比較して決める。
2. `bun`のセットアップ(`oven-sh/setup-bun`)と`bun.lock`のキャッシュ。

## 方針

`.github/workflows/test.yml`を1本追加し、ジョブを3つに分ける:

- `frontend`(ubuntu): `bun install --frozen-lockfile` → `bun run
  typecheck` → `bun test`。
- `rust`(**macos-latest**を第一候補): `Swatinem/rust-cache`を使って
  `cargo test --manifest-path src-tauri/Cargo.toml`。コストが問題なら
  ubuntu+aptに切り替える(要調査1)。
- `e2e`(ubuntu、`continue-on-error: true`): `bunx playwright install
  --with-deps chromium` → `bun run test:e2e`。`channel: 'chrome'`が
  CI上で見つからない場合は環境変数でchromiumにフォールバックできるよう
  `playwright.config.ts`を1行直す。

ブランチ保護(必須チェック化)はGitHubの設定なので、ワークフローが
安定したあとユーザーが行う(人間の判断)。

## レイヤー配置

- `.github/workflows/test.yml`(新規)。
- `playwright.config.ts`: CI向けのチャンネル切替のみ(任意)。

## テスト

- ワークフロー自体がテスト。意図的に失敗するコミット(例: `expect(1).
  toBe(2)`)を一時的にPRに積み、赤になることを確認してから消す。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] PR上で3ジョブがグリーン
- [ ] `gh run list --workflow test.yml`で`main`の実行が成功している

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] `rust`ジョブのランナー(macOS vs ubuntu)の最終決定(コスト) — macos-latest(公開リポジトリなので標準ランナーは無料)
- [ ] ブランチ保護で必須チェックにするか

## 先送り事項

- `e2e-tauri/`の実機e2eのCI化(spikeの未解決事項を先に片付ける)。
- `bf`(BarefootJS CLI)のlint/`bf debug graph`をCIに載せるか。
