---
status: todo
description: テキスト編集・構造操作を含む統一Undo/Redoスタックを実装する
tags: [undo-redo, editor, architecture]
---

# 統一Undo/Redoスタック

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: レイアウト変更、Draft化、Skip など、エディタで
編集以外の操作をしたときも undo/redo できるようにしたい。ユーザーとの
壁打ちの結果、「構造操作だけ」ではなく **テキスト編集も含めた統一の
Undo/Redoスタックをアプリ側に持つ」方針を選択。既存タスクの中で最も
規模が大きい — 着手前に必ずFableと設計を詰める。

## スコープ

- **目的**: テキスト編集・構造操作(レイアウト変更/Draft化/Skip/並べ替え
  等)を問わず、直近の操作をUndo/Redoで取り消し/やり直しできるようにする。
- **この todo の範囲 = 第1段階のみ**: 構造操作(レイアウト変更/Draft化/
  Skip切替/並べ替え/新規スライド/カット・コピー・ペースト/削除)の
  Undo/Redo と、ネイティブEditメニューとの共存方式。Redoは段階を分けず
  Undoと同時に入れる(同じ履歴構造の表裏であり、「新規push時にredo履歴を
  破棄」の規則やCmd+Z/Cmd+Shift+Zのメニュー配線もペアで決める必要がある
  ため)。
- **やらないこと**: テキスト編集(textarea)のUndo/Redoグルーピング
  (第2段階。`studio-settings-panel.md`のvim mode調査でCodeMirror移行の
  是非が決まってから設計する — 移行するならCodeMirror自身の履歴との統合
  が前提になり、生textarea前提の設計は作り直しになるため。第1段階の間、
  textarea内のテキスト編集はネイティブのundo/redoに任せたままにする)、
  複数ウィンドウ間でのUndo履歴共有、デッキファイルの
  世代管理・スナップショット保存機能(あくまで「直前の操作を戻す」until
  the app closes の範囲。永続的な変更履歴はスコープ外)。
- **受け入れ条件(第1段階)**: 構造操作をCmd+Z/Cmd+Shift+Zで1操作ずつ
  戻せる/やり直せる。textareaにフォーカスがあるときはネイティブの
  テキストundo/redoが従来どおり効き、アプリ側の構造操作undoと二重発火
  しない(Cmd+Zの行き先の振り分け方式は実装時に決め、PR本文に明記する)。
- 規模が大きいため、実装は一括ではなく段階的なPRに分けることを推奨する
  (例: 構造操作のみのUndoを先に通し、テキスト編集のグルーピングは別PR)
  — 実装着手時にFableと相談して決める。

## 現状

- テキスト編集のUndo/Redoは`SlideEditor.tsx`の生`<textarea>`の
  ネイティブ挙動に丸投げ(`src-tauri/src/lib.rs`の
  `PredefinedMenuItem::undo`/`redo`がOSのEditメニューを配線しているのみ)。
- 構造操作(レイアウト変更/Draft化/Skip切替/並べ替え/新規スライド/
  カット・コピー・ペースト/削除)は`domain/slideCommands.ts`の
  `SlideCommand`(`insert`/`delete`/`move`/`replace`)ADTを経由するが、
  適用したら終わりで、逆操作の記録・スタック管理は一切ない。

## 方針

- `domain/`に新規`EditorHistory`(仮)ADTを追加し、アプリが認識する
  「1つの取り消し単位」ごとにスナップショットまたは逆操作をスタックに
  積む。
- `SlideCommand`の4種は機械的に可逆にできる:
  - `insert`の逆操作は同じ`at`への`delete`
  - `delete`の逆操作は削除された`text`を同じ`index`への`insert`
  - `move`の逆操作は`to`→`from`への`move`
  - `replace`の逆操作は直前の`text`への`replace`
  既存の`SlideCommand`をそのまま再利用し、「適用したコマンド」と
  「逆操作のコマンド」のペアをスタックに積む設計が既存アーキテクチャ
  (`docs/architecture.md`のADTで状態を表現する方針)に最も馴染む。
- テキスト編集(textarea)をどう1つの取り消し単位にまとめるかが最大の
  論点: キーストロークごとに積むと粒度が細かすぎて実用にならず、
  かといって「保存(autosave)ごと」に積むだけでは打鍵の取り消しには
  使えない。ブラウザ/エディタの一般的な挙動(スペース区切り・一定時間の
  無入力・IME確定単位でグルーピング)を参考に、grouping戦略を設計する
  必要がある。
- ネイティブ`textarea`のCmd+Zとの共存/競合が最大のリスク: アプリ側で
  独自のUndoスタックを持つ場合、`PredefinedMenuItem::undo`/`redo`
  (ネイティブメニュー経由のCmd+Z/Cmd+Shift+Z)をそのまま残すと二重に
  undoが効いてしまう。ネイティブのEdit menu項目を外してアプリ側の
  ハンドラに置き換える(`src-tauri/src/lib.rs`の`build_menu`変更)か、
  textarea編集中はネイティブに任せ構造操作だけ別キーバインドにするか、
  という設計判断がある — CLAUDE.mdの「`window.confirm`/ネイティブ
  ダイアログがWKWebViewで信頼できない」という既知の傾向を踏まえると、
  ネイティブUndoへの過度な依存はここでも避けたほうが安全かもしれない。

## レイヤー配置

- `domain/editorHistory.ts`(仮、純粋関数のみ): スタックへのpush/pop、
  現在位置管理。
- `state/`に対応するstore(signal保持)を追加。
- `components/Studio.tsx`が各操作の実行箇所(`updateSlideConfig`/
  `reorderSlides`/`applyCommand`呼び出し周辺)でヒストリーへの記録を
  差し込む。

## テスト

- `domain/editorHistory.ts`のspec(push→undo→redoの往復、複数push後の
  undo連打)+ adversarial(空スタックでのundo、redo後に新規pushした
  場合にredoスタックが破棄されること)。
- 4種の`SlideCommand`それぞれの逆操作関数のspec/adversarialテスト。

## 完了条件

自動で確認できる項目:
- [ ] `domain/editorHistory.ts` + 逆操作関数 + テスト
- [ ] `Studio.tsx`への配線
- [ ] `bun test` / `bun run typecheck` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] ネイティブUndo(Edit menu)との共存方式を決定
- [ ] `src-tauri/src/lib.rs`のメニュー変更(必要な場合)、`cargo test`グリーン
- [ ] 実機確認(テキスト編集・構造操作を混在させた一連の操作のundo/redoが
      直感的な単位で効くこと)

## 先送り事項

- 第2段階: テキスト編集のUndo/Redoグルーピング(スペース区切り・無入力
  時間・IME確定単位など)と、構造操作との統一スタック化。vim mode調査
  (CodeMirror移行の是非)の結論待ち。第1段階完了時に別todoとして切り出す。
