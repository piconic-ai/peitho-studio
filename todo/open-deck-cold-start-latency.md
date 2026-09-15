---
status: inbox
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

## 背景・要調査

分かっていること(実測):
- barefootjs の `site/core/slides/overview` デッキで、アプリ起動後の初回
  `open_deck` の IPC 往復が約5秒。2回目以降は0.1〜0.7秒。
- 実機でクリックからエディタ表示までは約5.4秒(tauri-playwright の
  `startRecording` で録画)。

分かっていないこと:
- 5秒のうちどの処理が支配的か。`open_deck`(`src-tauri/src/peitho.rs`)は
  順に `resolve_deck_path` → `deck.md` 読み込み →
  `engine::pipeline::render_source` → `AssetServer::start`/update →
  `to_payload` → `watch_deck_file` → セッション登録 →
  `remember_recent_deck`(recents 書き込み + ネイティブメニュー再構築)を
  行うが、区間ごとの計測はしていない。
- 初回だけ遅い理由(peitho-core 側の初期化、フォント・テーマ等の読み込み、
  ファイルシステムキャッシュ、debug ビルドであること、など)は未検証の推測。
- 軽いデッキでも初回は遅いのか、デッキの重さに比例するのか。
- release ビルドでも同程度に遅いのか。
