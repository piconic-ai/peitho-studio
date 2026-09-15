---
status: done
description: アプリ起動後の初回 open_deck に約5秒かかる原因を特定し短縮する
tags: [performance, open-deck]
---

# 起動後初回の open_deck が遅い

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: PR #55 で `open_deck` を `#[tauri::command(async)]` にし、Welcome の
Open Deck… / Recent を押すと即座に「Loading deck…」(スピナー付き)へ
切り替わるようになった。ただしエディタが表示されるまでの待ち時間自体は
変わっていない。ユーザー判断で、待ち時間の短縮は別タスクとして扱う
(`todo/archive/welcome-open-feels-frozen.md` の追記も参照)。

## スコープ

- **目的**: `tauri dev` で起動直後に重いデッキを開いたとき、エディタが
  出るまでの約5秒を短くする。
- **やらないこと**: 起動時にハイライタを裏で温める投機的な初期化(下記
  「方針」の案A)。release でも初回が約0.5秒→約0.1秒になる程度の改善で、
  起動のたびに裏でCPUを使う。案Bの効果を実機で見てから別途判断する。
- **受け入れ条件**: debug ビルドで、起動後初回の重いデッキの
  `render_source` が release と同程度(1秒未満)になる。

## 背景・要調査

計測は `render_source` を区間ごとに測る一時テスト(コミットしていない)で
行った。デッキは barefootjs の `site/core/slides/overview`(14枚、コードは
sh/js/tsx/html)。

| | debug | release |
|---|---|---|
| `default_highlighter()` 初回 | 約2.0秒 | 約0.28秒 |
| `render_source` 初回 | 約3.1秒 | 約0.26秒 |
| `render_source` 2回目以降 | 約0.09秒 | 約0.01秒 |

- `open_deck` の IPC 往復(約4.9秒)と `render_source` 周りの合計がほぼ
  一致するため、ファイル監視・メニュー再構築などは支配的ではない。
- `default_highlighter()` の初回は syntect の既定シンタックスセット構築
  (peitho-core の `base_syntax_set`)。
- `render_source` の初回が遅いのは、syntect が言語ごとの正規表現を初めて
  使うときにコンパイルするため。debug で1ブロックだけ描いた場合、tsx 1.36秒、
  js 0.40秒、sh 0.30秒。2回目以降はほぼゼロ。
- debug が release の約10倍遅いのは、依存クレート(syntect、fancy-regex
  など)が最適化なしでビルドされていたため。

## 方針

- **案A: 起動時に投機的に温める** — 主要17言語の短いコードを別スレッドで
  一度 `render_source` しておく試作を測った。重いデッキの初回は debug で
  3.2秒→1.07秒、release で0.26秒→0.08秒。温めるのに debug で約6.8秒、
  release で約0.7秒かかる。実際のデッキは短いサンプルが通らない正規表現まで
  使うので、2回目以降と同じにはならない。
- **案B: dev プロファイルで依存クレートを最適化する** — 採用。
  `src-tauri/Cargo.toml` に `[profile.dev.package."*"] opt-level = 3`。
  debug でも初期化0.28秒+初回0.30秒と release 並みになった。代償は依存
  クレートの初回ビルドが一度だけ長くなること(約3分)と、パス依存の
  peitho-core も最適化対象になり、peitho-core を編集したときの再ビルドが
  遅くなること。

## レイヤー配置

`src-tauri/Cargo.toml` のプロファイル設定のみ。コードの変更なし。

## テスト

設定変更のみで、新規・変更する関数はない。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `cargo build` / `cargo test --lib` グリーン
- [x] debug で重いデッキの初回 `render_source` が1秒未満(一時テストで約0.58秒)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] 実機(`tauri dev`)で起動直後に重いデッキを Recent から開き、待ち時間が
      短くなったと感じられるか(ユーザー確認: 許容できる状態)
- [x] 案Aを別タスクとして進めるか(ユーザー判断: 手軽に試せるなら別途試す)

## 先送り事項

- 案A(起動時の投機的な初期化)。
