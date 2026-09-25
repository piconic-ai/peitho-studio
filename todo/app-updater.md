---
status: inbox
description: 新しいバージョンが出たことをアプリ内で知らせる/自動更新する仕組み(リリース後でよい)
tags: [release, updater]
---

# アプリのアップデート通知/自動更新

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: 現状、`tauri-plugin-updater`も更新チェックもなく、Helpメニューに
Releasesへのリンクすらない(リンクは`todo/release-app-metadata.md`で足す)。
初回リリースの**前**には不要だが、2回目のリリース時に「ユーザーが
新版に気づけない」問題になる。

分かっていること:

- `tauri-plugin-updater`はビルド時に`bundle.createUpdaterArtifacts`と
  署名鍵(Tauri独自のminisign鍵。Appleの署名とは別)が必要で、更新JSON
  (`latest.json`)をGitHub Releaseに置く運用が一般的。
  `tauri-action`はこのJSONの生成に対応している。
- 最小案: 起動時にGitHub ReleasesのAPIを叩いて最新タグと比較し、新版が
  あればStatusBarに「新しいバージョンがあります(開く)」を出すだけ。
  署名鍵も更新プラグインも要らないが、ネットワークアクセスが発生する
  (オフライン時に黙って失敗すること、頻度の上限を決めること)。

決めること:

1. 自動更新(プラグイン)まで行くか、通知だけにするか。
2. 起動時にネットワークへ出ることを設定でオフにできるようにするか。

`todo/release-build-workflow.md`の署名方針が決まってからリファインする。
