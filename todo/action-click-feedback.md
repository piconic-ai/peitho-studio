---
status: wip
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
- [ ] 実機で「連打しても多重にプレゼンウィンドウが開かない」ことを確認
      (フィードバックのついでに、そもそも多重起動が起きうるかも要確認)

## 先送り事項

(実装時に見つかった、本筋と無関係な改善点があればここに書き出す)

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
- 人間の判断が必要な項目(実機での多重起動確認)は未着手のまま。
