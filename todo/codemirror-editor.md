---
status: wip
description: 本文とノートのtextareaをCodeMirror 6に置き換える(vim modeの土台)
tags: [editor, codemirror, ime]
---

# 本文・ノートのエディタをCodeMirror 6に置き換える

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: vim modeの設計相談(2026-09-24)。ユーザーは「Vimと同じ使い勝手で
ないと受けつけない」が、「Obsidian程度のvim modeなら十分」とのこと。
比較の結果、**CodeMirror 6 + `@replit/codemirror-vim`**(Obsidianの
vim modeと同じ系統)を採用した。Neovim組み込みやMonacoは採らない。
このtodoは、その前提となるエディタの置き換えだけを扱う。vim modeは
`todo/vim-mode.md`で、このtodoの完了後に載せる。

## スコープ

- **目的**: `components/SlideEditor.tsx`の本文とノートの`<textarea>`を、
  CodeMirror 6(`EditorView`)に置き換える。ユーザーから見た編集の挙動は
  今と同じに保つ。
- **やらないこと**:
  - vim mode(`todo/vim-mode.md`)
  - テキスト編集と構造操作の統一undo(`todo/undo-redo-text-grouping.md`)
  - Markdownのシンタックスハイライトの作り込み
    (`@codemirror/lang-markdown`を入れる程度はよいが、配色の調整はしない)
- **受け入れ条件**:
  - 本文とノートが、どちらもCodeMirrorで編集できる。スライドを切り替える
    と内容が切り替わり、打った内容は今と同じ経路で自動保存される。
  - 日本語入力(変換中の文字)が、打鍵落ちやカーソル飛びなしに確定できる
    (実機のWKWebViewで確認)。
  - Edit > Undo/Redo(Cmd+Z / Cmd+Shift+Z)で、フォーカス中のエディタの
    テキストがCodeMirror自身の履歴で戻る/やり直される。フォーカスが外に
    あるときは、今まで通り構造操作のUndo/Redoになる。
  - 既存のe2eがすべてグリーン(textarea前提のセレクタは置き換える)。

## 背景・要調査

実際に読んで分かったこと:

- `SlideEditor.tsx`は非制御の`<textarea>`を2つ持ち、`ref`と`onInput`を
  `Studio.tsx`へ渡すだけの薄いコンポーネント。
- `Studio.tsx`の`syncEditorFields`は、スライド切り替え・保存応答・外部
  変更の取り込みのときだけ、`editor.bodyDraft()`/`noteDraft()`を
  textareaの`.value`へ書き込む。IMEの変換中(`compositionstart`〜
  `compositionend`、`bodyComposing`/`noteComposing`)は書き込まない。
  WebKitで変換中に`.value`を書き換えると、打鍵落ちが起きるため。
  CodeMirrorではこれをトランザクション(`view.dispatch`)に置き換える。
  変換中の外部書き換えをどう避けるかは、CodeMirrorの`view.composing`を
  見て同じ規則を保つ。
- Edit > Undo/Redoは`dom/fieldFocus.ts`の`replayFocusedFieldHistory`が
  `document.execCommand`でwebviewのテキスト履歴を呼んでいる。
  CodeMirrorは独自の履歴(`@codemirror/commands`の`history`)を持つので、
  フォーカス中のエディタには`undo(view)`/`redo(view)`を呼ぶ形に変える。
  CodeMirrorのフォーカスは`contenteditable`の要素にあり、今の
  「`<input>`/`<textarea>`かどうか」の判定では拾えない。
- スライド一覧の行を押したときに本文のフォーカスを外す処理
  (`dom/fieldFocus.ts`の`blurEditorFieldOnRowPress`)も、同じ理由で
  CodeMirrorの要素を対象に含める必要がある。
- 既存e2eで`textarea`を直接指しているのは7ファイル
  (`structural-undo-redo`、`slide-status-badges`など)。
  `page.locator('textarea').first().fill(...)`のような操作は
  contenteditableには効かないので、e2e用のヘルパーに置き換える。

要調査:

- WKWebViewでのCodeMirror 6の日本語入力。CodeMirror 6は`contenteditable`
  ベースでIMEの扱いに強いとされるが、このアプリの実機で確かめる。
- `@barefootjs`のコンポーネントからCodeMirrorを載せるときの、生成と
  破棄のタイミング。`ref`で`EditorView`を作り、破棄は`onCleanup`で行う。
  CLAUDE.mdの「条件分岐内の`ref`」「keyed `.map()`内の`ref`」の落とし穴に
  当たらない置き方にする(`SlideEditor`は`hasSelection`の条件分岐の中に
  ある)。

## 方針

- エディタ1つぶんのCodeMirrorの生成・内容の差し替え・破棄を、`dom/`の
  関数にまとめる(例: `dom/codeEditor.ts`)。本文とノートで共通にする。
- `Studio.tsx`は今の`bodyTextareaEl`/`noteTextareaEl`の代わりに
  `EditorView`を持ち、`syncEditorFields`は「変換中でなく、内容が違う
  ときだけ全文を差し替えるトランザクションを送る」にする。
  この差し替えは履歴に積まない(`addToHistory`を無効にする)。スライドを
  切り替えたあとのCmd+Zで、前のスライドの内容に戻ってしまうのを防ぐ。
- 入力の通知は、CodeMirrorの`updateListener`で`docChanged`のときに、
  今の`onBodyInput`/`onNoteInput`と同じ関数を呼ぶ。

## レイヤー配置

- `dom/codeEditor.ts`(新規): `EditorView`の生成、全文の差し替え、
  フォーカス判定、undo/redoの呼び出し。
- `dom/fieldFocus.ts`: フォーカス判定をCodeMirrorに対応させる。
- `components/SlideEditor.tsx`: textareaを、CodeMirrorを載せる`<div>`に
  置き換える。
- `components/Studio.tsx`: `syncEditorFields`とIME関連のフラグを
  CodeMirror向けに置き換える。
- 純粋な部分(「差し替えが必要か」の判定など)を切り出せる場合は、
  `domain/`に置いて単体テストする。

## テスト

- 切り出した純粋関数ごとに、specとadversarial(空文字、同じ内容、
  変換中など)。
- e2e: 既存のtextarea前提のテストを、CodeMirror用のヘルパー(内容の
  取得・入力)に置き換える。追加するシナリオは次の3つ。
  - 本文に打つと自動保存される
  - スライドを切り替えると内容が切り替わり、Cmd+Zで前のスライドの
    内容に戻らない
  - Edit > Undoで本文のテキストが戻る

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` / `bun run test:e2e` グリーン
- [x] 本文とノートがCodeMirrorに置き換わっている

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機での日本語入力(変換・確定・変換中のスライド切り替え)
- [ ] 実機でのEdit > Undo/Redo(本文・ノート・フォーカスが外)

## 先送り事項

(実装時に見つかった、本筋と無関係な改善点があればここに書き出す)

- 変換中のスライド切り替え: `setCodeEditorText`/`resetCodeEditorText`は
  変換中なら何もしない(textarea時代と同じ規則)。スライド行の`mousedown`
  で本文をblurするので、通常は切り替えの前に変換が確定するはずだが、
  WKWebViewでblur時に`view.composing`が確実に落ちるかは実機でしか
  分からない。落ちない場合、エディタに前のスライドの本文が残り、次の
  入力でそれが新しいスライドの下書きになる。実機確認で再現したら、
  変換終了時に保留中の同期をやり直す仕組みを足す。
