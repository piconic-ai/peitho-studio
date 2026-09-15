---
status: done
description: Presentボタンのクリック直後に視覚的フィードバックを追加する
tags: [ui, feedback]
---

# OpenDeck / Present ボタンのクリックフィードバック

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: OpenDeck、Presentなどのボタンを押したときに、
「押した」ことが認知できるようにしてほしい。

## スコープ

- **目的**: Present等、実行完了までラグのあるボタンをクリックした瞬間に
  視覚的な変化が起きるようにする。
- **やらないこと**: アプリ全体の全ボタンへの一律適用(他ボタンで同種の
  要望が出たら都度別タスクにする)、プレゼンウィンドウ自体の起動速度の
  改善。
- **受け入れ条件**: Presentボタンをクリックした直後、実行完了(成功/失敗
  問わず)までの間、見た目に変化があり連打しても多重にウィンドウが開かない。

## 現状

- `WelcomeScreen.tsx`の"Open Deck…"/"New Deck…"は`isBusy`propで
  `disabled` + ラベル文字列が"Opening…"に変わる形のフィードバックが
  **既にある**(`loadDeck`/`create_deck`実行中)。
- `DeckHeader.tsx`の"Present"ボタンには同種のフィードバックが**ない**。
  `onPresent`はプレゼンウィンドウを開く非同期IPC(`present_deck`)を
  呼ぶが、呼び出し中/呼び出し直後の状態がボタンの見た目に一切出ない。
  重いデッキでプレゼンウィンドウの起動が遅い場合、クリックが効いたのか
  分からず連打されうる。

## 方針

- `DeckHeader.tsx`の Present ボタンに、`WelcomeScreen.tsx`の
  `isBusy`と同じパターン(クリック直後に`disabled` + ラベル変化、または
  簡易スピナー)を導入する。
- 状態の持ち方は既存の`state/uiStore.ts`に倣う(既存の`dragState`等と
  同様、UIの一時状態としてここに置く)。
- "押した"ことの認知だけが目的なので、成功/失敗の結果表示
  (`errorMessage`)とは別物として扱う — 実行完了(成功でも失敗でも)で
  フィードバック状態は解除する。

## 完了条件

自動で確認できる項目:
- [x] `state/uiStore.ts`にPresent実行中フラグを追加
- [x] `DeckHeader.tsx`にフィードバックUIを追加
- [x] `bun test` / `bun run typecheck` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] 実機で「連打しても多重にプレゼンウィンドウが開かない」ことを確認 —
      `tauri-plugin-playwright`(`docs/tauri-playwright-spike.md`)経由で
      実際のWKWebViewウィンドウに対して`e2e-tauri/tests/
      present-double-click.tauri.e2e.ts`を実行し、Presentボタンを連続
      クリックした後も`peitho present`プロセスが1つだけ(Chrome
      プレゼンウィンドウも1つだけ、`~/.peitho/chrome-profile-slides`の
      専用プロファイルで)起動していることを`ps aux`で確認。フロント側の
      `presentPending`ガードに加え、Rust側`present_deck`にも「新規spawn
      前に前回の子プロセスをkillする」防御があり、二重の保護になって
      いることも確認できた。

## 先送り事項

- WelcomeScreenの"Open Deck…"/Recentクリックも実機で「フリーズして
  見える」との指摘をユーザーから受けたが、本タスクの範囲外(Present
  ボタン固有の話ではない、別コンポーネントの既存機能)のため
  [[welcome-open-feels-frozen]](`todo/welcome-open-feels-frozen.md`)
  として切り出した。

## 実装メモ (PR #55)

- `state/uiStore.ts`に`presentPending`フラグ(プレーンなbooleanシグナル、
  既存の`presentMenuOpen`と同パターン)を追加。
- `DeckHeader.tsx`のPresentボタン/オプションのシェブロンをクリック直後
  disabled化し、ラベルを"Presenting…"に変更(`WelcomeScreen.tsx`の
  `isBusy`/"Opening…"と同パターン)。`Studio.tsx`の`handlePresent`は
  `presentPending`のガード + try/finallyで成功/失敗どちらでも解除する。
- `e2e/present-click-feedback.e2e.ts`にGiven-When-Thenのe2eテストを追加
  (成功パス・失敗パス双方でフィードバック状態の出現/解除を検証)。
- 実装中、`DeckHeader.tsx`の重複したdisabled式を1つのlocal constに
  まとめる簡略化を試みたところ、BarefootJSのリアクティビティが壊れる
  ことが判明(`bf debug graph`は追跡ありと誤検出、実際はe2eテストで
  検出)。元の重複式に戻し、`CLAUDE.md`にBarefootJSの新しい落とし穴
  として記録した。

### 追記: 実機フィードバック後の根本修正

初回実装をユーザーが実機検証したところ、「Presentボタンが一瞬何かを
表示するがバグっぽい」と指摘。調査の結果、`present_deck`は
`peitho present`サブプロセスの`spawn()`が通った時点で即returnして
おり、`presentPending`は実質「spawnが受理されるまでの数ミリ秒」しか
trueにならないことが判明(重いデッキで遅いのは`spawn()`の**後**、
サブプロセス自身のレンダリング〜サーバ起動の中で起きており、そこは
一切見ていなかった)。`mizzy/peitho`側の`peitho present`が実際に
レンダリング完了後・ブラウザ起動前に`"serving presentation at {url}"`
をstdoutへ出力していることを確認し、これを本物の完了シグナルとして
使う方式に変更した:

- Rust側(`src-tauri/src/peitho.rs`): `present_deck`の子プロセスの
  stdoutを`Stdio::piped()`にし、バックグラウンドスレッドで行単位に
  読み取って`"serving presentation at "`を検知したら`present-ready`
  イベントをemit(`watch_present_readiness`/`is_present_ready_line`、
  後者はRust側のunit testあり)。パイプが詰まって子プロセスをブロック
  しないよう、検知後もプロセス終了まで読み続ける。
- フロント側: `ipc/deckIpc.ts`/`ipc/fakeDeckIpc.ts`に`onPresentReady`
  を追加。`domain/eventRace.ts`の`waitForEventOrTimeout`(イベント発火
  とタイムアウトの早い方で解決する汎用関数、spec+adversarialテスト
  あり)を新設し、`Studio.tsx`の`handlePresent`は`present_deck`成功後
  にこれを15秒タイムアウト付きで待ってから`presentPending`を解除する
  よう変更。タイムアウトは`peitho`バイナリのバージョンスキュー等で
  シグナルが来ない場合のフォールバック(エラー表示はせず黙って
  busy解除)。
- `e2e/helpers/mockTauri.ts`に`plugin:event|listen`/
  `transformCallback`/`unregisterListener`の実物に近い実装を追加
  (これまでは常時no-op — イベントを実際に受け取る必要がこれまで
  なかったため)。`MockDeck`に`presentReadyDelayMs`を追加し、
  `present-ready`をシミュレート。`present-click-feedback.e2e.ts`を
  この新しいアーキテクチャに合わせて更新。
- 「本当にmin-duration(最小表示時間)だけで直るのか」というユーザーの
  懸念は正当だった — spawnからサブプロセスの実完了までの時間は
  デッキの重さに依存し、固定タイマーでは重いデッキの場合に早すぎる
  busy解除を招くため、実際の完了シグナルを使う方式にした。
- ユーザーからの提案(ログを垂れ流すstatus line)は、Rust側でstdout/
  stderrをTauriイベントとして継続的に流しStatusBar相当に表示する、
  より大きな変更になるため今回は見送り(必要になれば別todoとして
  起票する)。
- 全テストグリーン: `bun test` 289 pass / `bun run typecheck` clean /
  `bun run test:e2e` 9/9 pass / `cargo test --lib` 34 pass。
- 人間の判断が必要な項目(実機での多重起動確認)は未着手のまま。
