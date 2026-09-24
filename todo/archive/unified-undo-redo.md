---
status: wip
description: Editメニューの取り消す/やり直すから構造操作のUndo/Redoも実行できるようにする
tags: [undo-redo, editor, menu]
---

# 統一Undo/Redo — Editメニューへの統合

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: レイアウト変更・Draft化・Skipなど、編集以外の操作もundo/redoしたい
というユーザー要望。第1段階(構造操作のUndo/Redo、キーボード経由)は
PR #76でマージ済み。その後の壁打ち(2026-09-24)で、残っていた判断事項
「ネイティブEditメニューとの共存方式」について、ユーザーが **Editメニューの
「取り消す/やり直す」からも構造操作を戻せるようにする** と決定した。
メニューに並んでいれば、ユーザーがこの操作とCmd+Zというショートカットを
見つけられる(学習機会になる)ため。

## スコープ

- **目的**: メニューバーの「Edit > Undo/Redo」を、フォーカスに応じて
  テキストのundo/redoと構造操作のUndo/Redoのどちらにも振り分ける項目に
  置き換える。キーボードのCmd+Z/Cmd+Shift+Zと、マウスでのメニュー選択で
  同じ結果になるようにする。
- **やらないこと**:
  - テキスト編集のUndo/Redoグルーピングと、構造操作との統一スタック化
    (第2段階。先送り事項を参照)
  - 複数ウィンドウ間でのUndo履歴共有
  - デッキファイルの世代管理・スナップショット保存
  - Cut/Copy/Paste/Select Allのメニュー項目の置き換え
    (`PredefinedMenuItem`のまま残す)
- **受け入れ条件**:
  - 構造操作(例: スライドのドラッグ並べ替え)の直後に、フォーカスが
    textarea/inputの外にある状態でメニューの「Edit > Undo」をマウスで
    選ぶと、その操作が1つ戻る。「Redo」で再び適用される。
  - textareaにフォーカスがある状態で同じメニュー項目を選ぶと、
    テキストのundo/redoだけが起き、スライド構成は変わらない。
  - Cmd+Z/Cmd+Shift+Zを1回押したときに、undo/redoが1回だけ起きる。
    キーボードとメニューの二重発火が起きない。
  - 複数ウィンドウを開いているとき、メニュー操作はフォーカスのある
    ウィンドウにだけ効く。

## 背景・要調査

第1段階(PR #76)の実装で、次の状態になっている。

- 履歴: `domain/editorHistory.ts`(純粋関数。`HistoryStep`は`slides`と
  `config`の2種)と、`state/historyStore.ts`(signal)。
  `Studio.tsx:165`で`createHistoryStore()`を呼んでおり、ウィンドウごとに
  1つ持つ。永続化はしていない。
- 振り分け: `Studio.tsx`の`onKeyDown`は、textarea/inputにフォーカスが
  あればreturnする。そのキーはネイティブの`PredefinedMenuItem::undo`/
  `redo`(`src-tauri/src/lib.rs:73-74`)に届く。それ以外では常に
  `preventDefault`し、`replayHistory('undo'|'redo')`を呼ぶ。
- スライド一覧の行を押すと、本文/ノートのtextareaのフォーカスが外れる
  (`dom/fieldFocus.ts`)。
- 既知の制限: メニューをマウスで選んだ場合は、ネイティブのテキストundo
  しか起きない。これが今回の対象。

実際に読んで分かったこと:

- 既存のカスタムメニュー項目は`MenuItem::with_id`で作り、`on_menu_event`
  (`lib.rs:174`付近)でidを見て処理している。`new_deck`はフロントへ
  `app_handle.emit("menu:new-deck", ())`で渡しており、これは
  **全ウィンドウへの送信** になる。undoで同じことをすると、全ウィンドウの
  履歴が一斉に戻ってしまう。フォーカス中のウィンドウにだけ送る
  (`emit_to`とウィンドウ単位の`listen`)必要がある。CLAUDE.mdの
  「ウィンドウごとの状態はlabelで分ける」と同じ種類の問題。
- フロントでの購読は`ipc/deckIpc.ts`の`subscribe`(`listen()`の
  ラッパー)で、`onMenuNewDeck`が前例になる。
- `e2e/helpers/mockTauri.ts`は、Tauriのイベント配信
  (`plugin:event|listen`)を最小限だが実際に実装している。e2eから
  メニューイベントを疑似的に発行して、フロント側の振り分けをテストできる。

要調査(推測を含む。実装前に確かめる):

1. **Cmd+Zはメニューとページの`keydown`のどちらに先に届くか。**
   `Studio.tsx`のCmd+C処理のコメントには「`preventDefault`でネイティブの
   Edit-menu Copyが走らなくなる」とある。つまり、WKWebViewではページの
   keydownが先に届き、`preventDefault`でメニューのキー割り当てが抑止される
   可能性が高い(推測。PR #76の実機確認でもCmd+Zで確かめる)。これで
   二重発火を防ぐ方式が変わる(方針のA/B)。
2. **`document.execCommand('undo'/'redo')`がWKWebViewのtextareaで効くか。**
   `PredefinedMenuItem::undo`を外すと、textareaのCmd+Zを受けるネイティブの
   `undo:`アクションもなくなる。代わりにフロントから`execCommand`で
   ネイティブのテキスト履歴を呼ぶ想定だが、WKWebViewで確実に動くかは
   未確認。動かない場合は、案Cを検討する。
3. メニューイベントを「フォーカス中のウィンドウ」に届ける方法。
   `on_menu_event`の`app_handle`から、フォーカス中のウィンドウを
   `get_focused_window()`などで特定できるかを確かめる。

## 方針

`PredefinedMenuItem::undo`/`redo`を、`MenuItem::with_id(app, "undo",
"Undo", true, Some("CmdOrCtrl+Z"))`と`"redo"`(`CmdOrCtrl+Shift+Z`)に
置き換える。`on_menu_event`では、フォーカス中のウィンドウにだけ
`menu:undo`/`menu:redo`を送る。フロントは受け取ったら、次のように
振り分ける。

- textarea/inputにフォーカスがある → `document.execCommand('undo'|'redo')`
- それ以外 → 既存の`replayHistory('undo'|'redo')`

キーボード経路の扱いは、要調査1の結果で決める。

- **案A(推奨)**: メニューを唯一の入口にする。`onKeyDown`からCmd+Zの
  処理を外し、キーボードもメニューのキー割り当て経由で`menu:undo`に
  一本化する。二重発火の余地がなく、キーボードとマウスの経路が同じに
  なる。ただし、ページ内でCmd+Zの`preventDefault`をやめたときに、
  WebKitの文書全体undoが勝手に走らないことを確認する必要がある
  (`undo:`アクションを持つメニュー項目がなくなるので、走らない見込み)。
- **案B**: `onKeyDown`はそのまま残し、メニューはマウス選択用の補助に
  する。要調査1で「keydownが先で、`preventDefault`がメニューを抑止する」
  と確認できた場合だけ成立する。textareaにフォーカスがあるときはkeydownが
  returnしてメニューに流れるので、その経路も`execCommand`になる。
- **案C(要調査2で`execCommand`が不安定な場合)**: `PredefinedMenuItem`の
  undo/redoを残したまま、構造操作用に別の項目(例: 「スライド操作を
  取り消す」)を追加する。メニューに似た項目が2つ並ぶので、ユーザーの
  意図(1つの「取り消す」で両方)からは外れる。採用する場合は、実装前に
  ユーザーへ確認する。

メニュー項目の見た目は、まずは固定ラベル(Undo/Redo)で常に有効にする。
グレーアウトや、操作名を含むラベル(例: 「Undo Move Slide」)は、
先送り事項で扱う。

## レイヤー配置

- `src-tauri/src/lib.rs`: メニュー項目の置き換えと、`on_menu_event`での
  フォーカス中のウィンドウへの送信だけを行う(薄い配線層のまま)。
  「idからイベント名への対応」のような判断ロジックが増えるなら、
  状態に依存しない関数として切り出し、`#[cfg(test)]`でテストする。
- `ipc/deckIpc.ts`: `onMenuUndo`/`onMenuRedo`(`onMenuNewDeck`と同じ形)。
  ウィンドウ単位で`listen`する。
- `dom/`: フォーカス位置で振り分ける関数(textarea/inputかどうかの判定と
  `execCommand`呼び出し)。`dom/fieldFocus.ts`に置くのが自然。
- `components/Studio.tsx`: 購読して、`replayHistory`か`dom/`側の関数を
  呼ぶ。案Aなら`onKeyDown`からCmd+Zの分岐を削除する。

## テスト

- e2e(`e2e/structural-undo-redo.e2e.ts`に追記): `mockTauri`のイベント
  配信で`menu:undo`/`menu:redo`を発行し、次を確かめる。
  - フォーカスが外にあるとき、構造操作が戻り、やり直される
  - textareaにフォーカスがあるとき、スライド構成は変わらない
    (Chromiumの`execCommand('undo')`でテキストが戻ることも、可能なら
    確認する)
  - 案Aの場合: Cmd+Zのkeydownだけでは構造操作が動かないこと
    (経路が本当にメニューに一本化されたこと)
- Rust: 切り出した純粋関数があれば、その`#[cfg(test)]`。
- 既存のe2e 9件(並べ替えを含む)が、案A/Bのどちらでもグリーンのままで
  あること。案Aでkeydown経路を外す場合、既存テストの`Meta+z`は
  モックのメニューイベントに置き換える必要がある。

## 実装メモ(案Aで実装 — 実機確認待ち)

- **案Aを仮採用**: メニューを唯一の入口にした。`Studio.tsx`の`onKeyDown`
  からCmd+Zの分岐を外したので、Cmd+Z/Cmd+Shift+Zはメニュー項目の
  アクセラレータ経由でだけ届く。要調査1の結果(keydownとメニューの
  どちらが先か)に関係なく、1回の押下で1回だけ動く。要調査2
  (`execCommand`)が実機で駄目なら、案Cへ切り替える(ユーザー確認が必要)。
- **`execCommand`の根拠**: WebKitの`EditorCommand.cpp`では、`Undo`/`Redo`
  の可否判定は`supported`(スクリプトからも実行できる)で、
  `supportedFromMenuOrKeyBinding`ではない。WKWebViewで実際にテキスト
  履歴に届くかは未確認。
- **Rust**: `src-tauri/src/edit_menu.rs`。項目id(`edit_undo`/`edit_redo`)
  からイベント名への対応と、フォーカス中のウィンドウの選び方を純粋関数に
  して`#[cfg(test)]`でテストした。送信は
  `emit_to(EventTarget::webview_window(label))`。
- **フロントの購読はウィンドウ単位**: `ipc/deckIpc.ts`の`onMenuUndo`/
  `onMenuRedo`は`getCurrentWebviewWindow().listen`。素の`listen()`
  (target: Any)は、`emit_to`が別ウィンドウ宛てに送ったイベントも受け取る
  (Tauriの`match_any_or_filter`)。`e2e/helpers/mockTauri.ts`もこの
  振る舞いを再現し、e2eで確かめている。
- **振り分け**: `dom/fieldFocus.ts`の`replayFocusedFieldHistory`。
  input/textareaにフォーカスがあれば`execCommand`、なければ
  `replayHistory`。プレビューの端末形状メニュー(`phoneShapeMenuOpen`)が開いている間は、ほかの
  ショートカットと同じく何もしない。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] 第1段階: `domain/editorHistory.ts` + 逆操作関数 + テスト(PR #76)
- [x] 第1段階: `Studio.tsx`への配線(PR #76)
- [x] 第1段階: ドラッグ並べ替え後のCmd+Z(`dom/fieldFocus.ts`、PR #76)
- [x] メニュー項目の置き換えと、フォーカス中のウィンドウへのイベント送信
- [x] フロントでの購読と、フォーカス位置による振り分け
- [x] `bun test` / `bun run typecheck` / `bun run test:e2e` グリーン
- [x] `cargo test` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] ネイティブEditメニューとの共存方式を決定
      (2026-09-24: メニューからも構造操作を戻せるようにする)
- [ ] 要調査1・2の実機確認(Cmd+Zがどちらに先に届くか、WKWebViewでの
      `execCommand('undo')`)と、その結果による案A/B/Cの決定。
      案Cになる場合はユーザーに確認する
- [ ] 実機確認: 受け入れ条件の4項目(メニューのマウス選択、textarea内、
      二重発火なし、複数ウィンドウ)

## 先送り事項

- 第2段階: テキスト編集のUndo/Redoグルーピング(スペース区切り・
  無入力時間・IME確定単位など)と、構造操作との統一スタック化。vim mode
  調査(`studio-settings-panel.md`、CodeMirror移行の是非)の結論待ち。
  このtodoの完了時に、別todoとして切り出す。
- メニュー項目のグレーアウト(履歴が空のとき)や、操作名を含むラベル
  (「Undo Move Slide」など)。履歴の状態をRust側のメニューへ反映する
  配線が必要になる。`build_menu`はメニュー全体を作り直す作りなので、
  項目単位で`set_enabled`/`set_text`できるかの調査から始める。
- PageCommentを持たないスライドへのレイアウト変更などをUndoすると、
  `<!-- {} -->`が残る(peitho-coreは受け付けるので実害はない)。
- 本文のオートセーブ(`handleSave`)は、構造操作の直列化(`serialized`)の
  外にある。保存中に構造操作やUndoを実行すると、2つの全文保存が競合
  しうる。実際に問題になったら対応する。
- 外部変更時の再読み込み確認(`Studio.tsx`の`refreshSource`付近)が
  `window.confirm()`を使っている。CLAUDE.mdの「WKWebViewで
  `window.confirm()`は信頼できない」に該当する(#76以前からの既存コード)。
