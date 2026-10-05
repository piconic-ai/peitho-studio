---
status: wip
description: 「更新を確認…」をmacOSのアプリメニューへ移し、設定パネルではなく専用の小ウィンドウで確認結果を出す
tags: [updater, menu, ui]
---

# 「更新を確認…」をアプリメニューと専用ウィンドウへ

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: 更新の確認は設定ではないので、設定パネルではなくネイティブメニュー
(macOSのアプリメニュー「Peitho Studioについて」の下)から実行したい
(kfly8、2026-10-05)。壁打ちの結論:
- メニュー項目は、macOSではアプリメニューへ移し、ヘルプメニューから外す。
  macOS以外では今のままヘルプメニューに置く。
- メニューから確認した結果は、設定パネルではなく、Aboutウィンドウと同じ形の
  専用の小ウィンドウに出す。
`todo/app-updater.md`(`wip`)の方針表にある「メニュー / 設定の「更新を確認」」
のうち、メニュー側の導線を作り直す。更新処理そのものは`app-updater.md`の範囲。

## スコープ

- **目的**: macOSのアプリメニューの「更新を確認…」で専用ウィンドウを開き、
  確認中 → 結果(最新版 / 新版あり / 失敗 / 未設定ビルド)と、
  そこからの更新操作を出す。
- **やらないこと**:
  - 設定パネルの`UpdateControls`(自動確認・自動更新のトグルと「更新を確認」
    ボタン)を外すこと。設定パネルの導線はそのまま残す。
  - 更新の確認・ダウンロード・適用・署名検証の処理(`src-tauri/src/updates.rs`
    の中身)を変えること。新しいウィンドウは既存のコマンドとイベントを使う。
  - 自動確認で新版が見つかったときのアプリ内案内(`showUpdateNotice`)の変更。
  - Aboutウィンドウに更新の表示を足すこと。
- **受け入れ条件**:
  - macOSのアプリメニューが「Peitho Studioについて」→「更新を確認…」→
    区切り →「設定…」の順になる。ヘルプメニューに「更新を確認…」はない。
  - macOS以外ではヘルプメニューに「更新を確認…」が残る。
  - 「更新を確認…」で専用ウィンドウが開き、開いた時点で確認を始める。
    すでに開いていれば前面に出して確認をやり直し、二つ目は開かない。
    設定パネルは開かない。デッキを開いたウィンドウがなくても動く。
  - ウィンドウに、確認中・最新版・新版あり(バージョン、変更点、「更新する」、
    リリースノート)・失敗(再試行)・未設定ビルド(Releasesへのリンク)・
    ダウンロード中・準備完了が出る。日本語・英語に対応する。
  - ラベルは`i18n::menu_labels`から引く(今の直書きをなくす)。

## 背景・要調査

読んで分かったこと:
- 「更新を確認…」はすでにある。ただし全OSでヘルプメニューの末尾
  (`src-tauri/src/lib.rs`の`check_update`)。ラベルは
  `if language == Language::Ja { "更新を確認…" } else { … }`と直書きで、
  idも文字列リテラル`"check_updates"`。
- 選ぶと`updates::show_check_window`が前面のStudioウィンドウに
  `menu:check-updates`を送る。ウィンドウがなければ`main`を作り、
  `pending_check_windows`に積んで`take_update_check`で受け取らせる。
  受け取った`Studio.tsx`は`openSettings()`してから`runUpdateAction('check')`
  する。新しいウィンドウにすれば、この経路(`pending_check_windows`、
  `take_update_check`、`menu:check-updates`、`onMenuCheck`/`takeMenuCheck`)
  は不要になる。設定パネルの「更新を確認」ボタンは別経路なので残る。
- 更新状態はアプリ全体で一つ(`AppUpdates`)。`updates:changed`を全ウィンドウに
  emitし、`get_update_status`/`check_for_updates`/`prepare_update`/
  `dismiss_update`/`open_update_releases`で操作できる
  (`ipc/updateIpc.ts`)。表示文言と状態の判定は`domain/updates.ts`
  (`updateMessages`/`updateStatusText`/`canPrepareUpdate`など)に揃っている。
  `components/UpdateControls.tsx`の表示部分が参考になる。
- Aboutウィンドウ(`src-tauri/src/about.rs`、`pages/about.html`、
  `components/AboutScreen.tsx`、`vite.config.ts`の`pages/about`)が手本。
  ラベル固定の単一ウィンドウで、すでにあれば前面に出すだけ。
- **注意**: `updates.rs`はStudioウィンドウでないものを`label != "about"`で
  除外している(`show_check_window`、`intercept_exit`の`exit_acks`、
  その後の「待機中に開いたウィンドウ」の判定)。新しいウィンドウを
  ここで除外しないと、終了時の更新適用で保存の応答を待ち続けて
  タイムアウトする。

要調査:
- `"about"`を特別扱いしている箇所が`updates.rs`以外にもないか
  (`peitho.rs`のデッキメニュー反映、`lib.rs`のウィンドウイベント、
  最近使ったデッキなど)。Studio以外のウィンドウの判定を一つの関数に
  まとめてから、新しいラベルを足す。
- 終了時の更新適用(`saving`/`installing`)の最中に新しいウィンドウを
  開いてよいか。`ensure_can_open_deck`と同じく抑止するか、表示だけなら
  許すかを決める(表示のみなので許す案が有力)。

調べた結果:
- `"about"`の特別扱いは`updates.rs`の3か所だけだった。`peitho.rs`のデッキ
  メニュー反映や`lib.rs`のウィンドウイベントは、Studio以外のウィンドウでも
  空振りするだけ(Aboutと同じ)。`updates::is_studio_window`にまとめ、
  `exit_acks`/`has_unasked_studio_window`を純粋関数に切り出した。
- 終了時の更新適用中(`saving`/`installing`)は、`lib.rs`の`on_menu_event`が
  冒頭の`updates::blocks_editing`で全メニューを無視するので、新しいウィンドウは
  そもそも開かない。開いていた場合も`exit_acks`から外れるので待たれない。

## 方針

- Rust: `about.rs`にならって`update_window.rs`(または`updates.rs`内の
  小さな関数群)を作る。`MENU_ID`、ウィンドウラベル、サイズ、`open_window`。
  確認の開始はフロントがウィンドウを開いた直後に`check_for_updates`を呼ぶ。
  すでに開いているときは前面に出し、そのウィンドウ宛てにイベントを送って
  確認をやり直させる(ウィンドウ専用イベントは`subscribeToThisWindow`で聞く)。
- メニュー: macOSのアプリメニューで`about_item`の直後に置く。macOS以外は
  ヘルプメニューの末尾のまま(About の後)。ラベルを`i18n::MenuLabels`に足す。
- フロント: `pages/update.html` + `components/UpdateScreen.tsx`。
  `UpdateControls.tsx`の結果表示部分を共有できるなら共有する
  (トグルは設定パネル側だけ)。
- 不要になる経路(`pending_check_windows`、`take_update_check`、
  `menu:check-updates`、`Studio.tsx`の`onMenuCheck`/`takeMenuCheck`)は削除する。

## レイヤー配置

- `src-tauri/src/update_window.rs`(新規、またはabout.rsと同じ形): ウィンドウの
  生成・前面化。`lib.rs`はメニュー項目の配置とid分岐だけ。
- `src-tauri/src/i18n.rs`: `check_updates`ラベル。
- Studio以外のウィンドウの判定: 純粋関数(`fn is_studio_window(label: &str)
  -> bool`)にして`updates.rs`の3か所から使う。
- `domain/updates.ts`: 新しいウィンドウ専用の表示判定が要れば純粋関数で足す。
- `components/UpdateScreen.tsx`、`pages/update.html`: 状態を持つ画面。

## テスト

- Rust: `is_studio_window`のspec(`main`、デッキウィンドウのラベル)と
  adversarial(`about`、新ウィンドウのラベル、空文字)。
  `i18n`の既存テストに`check_updates`の日英ラベルを足す。
- `intercept_exit`の`exit_acks`に新しいウィンドウが入らないことを、
  ラベル一覧からacksを作る部分を純粋関数に切り出して確認する。
- フロント: `domain/updates.ts`に関数を足した場合はspecとadversarial。
- e2e(モック): 可能なら`pages/update.html`を開き、`check_for_updates`の
  モック結果ごとの表示(最新版 / 新版あり / 失敗)を確認する。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `cargo test` グリーン
- [x] `grep -rn '"about"' src-tauri/src/updates.rs`が0件
  (Studio以外の判定が関数にまとまっている)
- [x] `lib.rs`に「更新を確認…」の直書きラベルがない

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機での確認(ユーザー自身に依頼する): アプリメニューの並び、
  ヘルプメニューから消えていること、ウィンドウの見た目、デッキ未オープン時・
  既に開いているときの挙動、日英の表示
- [ ] 自動更新オンで準備完了の状態から終了し、新しいウィンドウを開いていても
  更新適用が止まらないこと(配布用の鍵設定後、`todo/app-updater.md`の
  実機検証と合わせて)

## 先送り事項

(実装中に見つかった本筋と無関係な改善点をここに書く)
