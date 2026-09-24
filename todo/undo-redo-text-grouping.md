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

**着手条件**: `todo/codemirror-editor.md`の完了後。vim modeの設計相談
(2026-09-24)で、本文とノートをCodeMirror 6へ移行することが決まった。
このtodoは、CodeMirror自身の履歴(`@codemirror/commands`の`history`)と
構造操作の履歴(`domain/editorHistory.ts`)をどう統合するか、という
設計になる。着手時に`status: todo`へリファインメントする。

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
- CodeMirrorでは、テキストの取り消し単位のまとめ方(`history`の
  `newGroupDelay`など)がすでにある。それをそのまま使えるか。
- Vimの`u`/`Ctrl-R`(`todo/vim-mode.md`)と、統一した履歴の関係。
- 構造操作の履歴はスライドを位置(index)で指している。テキスト保存で
  スライド数が変わると履歴を捨てている(`---`の入力など)。統一する場合、
  この制約をどう扱うか。
