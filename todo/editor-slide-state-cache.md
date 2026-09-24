---
status: todo
description: スライドを切り替えてもCodeMirrorの状態(テキストの履歴)を捨てず、スライドごとに保持する
tags: [undo-redo, editor, codemirror]
---

# スライドごとのエディタ状態の保持

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `todo/undo-redo-text-grouping.md`(統一Undo/Redoの第2段階)の
前提となる部分を切り出したもの。Fable(`claude-fable-5-1`)による設計
レビュー(2026-09-25)のPR分割案の1つ目にあたる。

今は、スライドを切り替えると`dom/codeEditor.ts`の`resetCodeEditorText`が
CodeMirrorの状態を作り直し、テキストの履歴を捨てている。第2段階で
「別のスライドで打った文字をCmd+Zで戻す」ために、スライドごとに状態を
残しておく必要がある。

## スコープ

- **目的**: 本文とノートのCodeMirrorの状態(`EditorState`)を、スライド
  ごとに保持する。スライドを離れるときに保存し、戻ってきたら復元する。
- **やらないこと**:
  - Cmd+Zの時系列の統合(`todo/undo-redo-text-grouping.md`)。このtodoでは
    Cmd+Zの振り分け(フォーカスで決める)を変えない。
  - 削除したスライドを元に戻したとき、その履歴まで復元すること(新しい
    履歴で始まる)。
- **受け入れ条件**:
  - スライドAで打つ → Bに移る → Aに戻る → Aの本文にフォーカスして
    Cmd+Z(またはvimの`u`)で、Aで打った文字が戻る。
  - スライドの並べ替え・挿入・削除のあとも、それぞれのスライドの状態が
    正しいスライドに付いたままになる。
  - 既存の「履歴を捨てる」場面(本文の保存でスライド数が変わったとき、
    外部変更で読み直したとき、デッキを開き直したとき)では、保持している
    状態もすべて捨てる。
  - vim modeやUI言語(プレースホルダ)を切り替えてから戻ってきても、
    復元した状態にその設定が反映されている。

## 背景・要調査(Fableのレビューで決まったこと)

- **置き場所は`dom/`**(`dom/editorSlideStates.ts`、新規)。`EditorState`は
  CodeMirrorのオブジェクトで、リアクティブに読むものがないので、signalや
  `state/`には置かない。`Studio`ごとにファクトリで作る(モジュール
  スコープの単一インスタンスにしない)。
- **キーはスライドの位置(index)**。見出しから作られる`key`は編集で
  変わるので使わない。位置がずれる操作(挿入・削除・並べ替え)では、
  キャッシュの位置をずらす。ずらし方は純粋関数`indexAfterCommand(i, cmd):
  number | null`(削除されたら`null`)として`domain/slideCommands.ts`に
  置く(`domain/slides.ts`の`indexAfterMove`の隣の考え方)。
- **キャッシュの中身**: `{ state: EditorState; vimOn: boolean; placeholder:
  string }`を、スライドごとに本文とノートの2つ。
- **復元時の整合**: `setCodeEditorVimMode`/`setCodeEditorPlaceholder`は、
  今のビューの状態だけを組み替えて、ビューごとのフラグ(`vimModeOf`/
  `placeholderOf`)に記録している。保存したときと設定が違えば、復元後に
  組み替え直す。
- **安全策**: 復元する状態の本文が、そのスライドの今の本文と一致する
  ときだけ使う。違えば、今の`resetCodeEditorText`と同じく新しく作る。
- `view.setState`は`updateListener`を呼ばない。
- IMEの変換中(`view.composing`)は、今と同じく差し替えない。
- `syncEditorFields`(`components/Studio.tsx`)は、移動元と移動先の位置と、
  実行したコマンドを受け取る形にする。移動元の状態は
  `indexAfterCommand(移動元, cmd)`の位置に保存し(`null`なら捨てる)、
  移動先はキャッシュから取り出すか新しく作る。`commitChange`は移動前の
  状態を持っていて、`selectSlide`は両方の位置を知っている。
- 既存の`history.clear()`の各所(`refreshSource`、スライド数が変わる保存、
  外部変更で編集を続けるとき、など)で、キャッシュも捨てる。

## レイヤー配置

- `domain/slideCommands.ts`: `indexAfterCommand`(純粋)。
- `dom/editorSlideStates.ts`(新規): キャッシュ(`store`/`take`/`shift`/
  `clear`)。
- `dom/codeEditor.ts`: 状態の保存(`snapshotCodeEditor`)と復元
  (`restoreCodeEditor`、設定の組み替え直しを含む)。
- `components/Studio.tsx`: `syncEditorFields`の変更と、キャッシュの破棄。

## テスト

- `indexAfterCommand`: 挿入(前・同じ位置・後ろ)、削除(自分なら`null`)、
  並べ替え、置き換え。spec と adversarial(範囲外の位置など)。
- キャッシュの`shift`: 各コマンドのあとで、状態が正しい位置に付くこと。
- e2e(`e2e/code-editor.e2e.ts`): 受け入れ条件の1つ目(A→B→Aで戻せる)、
  並べ替えのあと、スライド数が変わる保存のあとに捨てられること、vim
  modeを切り替えてから戻ったとき。
  - 既存の「スライドAで1文字消し、Bに切り替えてからCmd+Zしても、消した
    文字はBに入らない」テストは、このtodoのあとも成り立つ(Bの履歴は
    Bのもの)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] 実装とテスト
- [ ] `bun test` / `bun run typecheck` / `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機確認: スライドを行き来してからのCmd+Zとvimの`u`、日本語入力

## 先送り事項

(実装時に見つかった、本筋と無関係な改善点があればここに書き出す)
