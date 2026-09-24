---
status: inbox
description: テキスト編集のUndo/Redoを構造操作と同じ履歴にまとめる(統一Undo/Redoの第2段階)
tags: [undo-redo, editor]
---

# 統一Undo/Redo 第2段階 — テキスト編集のグルーピング

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `todo/archive/unified-undo-redo.md`(第1段階、PR #76/#77)の
先送り事項から切り出したもの。元の要望は「テキスト編集も含めた統一の
Undo/Redoスタックをアプリ側に持つ」。第1段階では構造操作だけを
アプリの履歴に載せ、テキストはwebview自身のテキスト履歴に任せた。

**着手条件**: `todo/studio-settings-panel.md`のvim mode調査で、本文
エディタをCodeMirrorへ移行するかどうかの結論が出てから。移行するなら
CodeMirror自身の履歴(`@codemirror/commands`の`history`)と構造操作の
履歴をどう統合するか、という設計になる。生`<textarea>`前提で先に作ると
作り直しになる。

## 現状(第1段階の完了時点で分かっていること)

- 構造操作の履歴: `domain/editorHistory.ts`(`HistoryStep`は`slides`と
  `config`の2種)と`state/historyStore.ts`。ウィンドウごとに1つ、
  永続化なし。
- Edit > Undo/Redo(Cmd+Z / Cmd+Shift+Zもこのメニューのアクセラレータ
  経由): `src-tauri/src/edit_menu.rs`が、フォーカス中のウィンドウにだけ
  `menu:undo`/`menu:redo`を送る。フロントの`Studio.tsx`
  (`onMenuHistory`)が、テキスト入力欄にフォーカスがあれば
  `dom/fieldFocus.ts`の`replayFocusedFieldHistory`
  (`document.execCommand`)でテキストのundo、それ以外は構造操作の
  `replayHistory`に振り分ける。WKWebViewの実機で動作確認済み
  (2026-09-24)。
- そのため今は、テキストの履歴と構造操作の履歴が別々にある。
  「本文を打つ → レイアウト変更 → 本文にフォーカスしてCmd+Z」は
  テキストだけが戻り、フォーカスを外してのCmd+Zはレイアウト変更だけが
  戻る。時系列をまたいだ一本のundoにはなっていない。

## 要調査(未整理)

- テキスト編集の取り消し単位のまとめ方(スペース区切り、一定時間の
  無入力、IME確定単位など)。
- 本文はIME対策のため非制御の`<textarea>`で、`Studio.tsx`の
  `syncEditorFields`がプログラムから値を書き換える。値の書き換えで
  webviewのテキスト履歴がどうなるか。
- 構造操作の履歴はスライドを位置(index)で指している。テキスト保存で
  スライド数が変わると履歴を捨てている(`---`の入力など)。統一する場合、
  この制約をどう扱うか。
