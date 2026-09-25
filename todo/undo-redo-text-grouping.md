---
status: wip
description: Cmd+Zをテキスト編集とスライド操作をまたぐ1本の時系列にする(統一Undo/Redoの第2段階)
tags: [undo-redo, editor, codemirror]
---

# 統一Undo/Redo 第2段階 — テキストとスライド操作を1本の時系列に

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `todo/archive/unified-undo-redo.md`(第1段階、PR #76/#77)の
先送り事項。元の要望は「テキスト編集も含めた統一のUndo/Redoスタックを
アプリ側に持つ」。本文とノートはCodeMirror 6に移行済み
(`todo/archive/codemirror-editor.md`)で、vim modeも入った
(`todo/vim-mode.md`)。

期待する挙動をユーザーと確認した(2026-09-25):

1. **Cmd+Z / Edit > Undoは1本の時系列**。「本文を打つ → レイアウトを
   変える → 本文にフォーカスを戻してCmd+Z」では、フォーカスに関係なく
   直前のレイアウト変更が戻る(Keynote/Googleスライドと同じ)。
2. **スライドをまたぐ**。「スライドAで打つ → Bに移る → Cmd+Z」では、
   スライドAを開き直して、Aで打った文字を戻す。
3. **vimの`u`/`Ctrl-R`は、そのエディタの文字だけ**を戻す(Vimのバッファと
   同じ)。スライド操作は戻さない。
4. **undo/redoは、変更が起きたスライドを選択する**(2026-09-25、
   ユーザーの提案)。スライドの選び直しそのものは履歴に残さない
   (undoの1回ぶんに数えない)。操作ごとの選択:
   - テキストの入力: 打ったスライド(2と同じ)
   - レイアウト/Draft/Skip/セクションの変更(`config`): そのスライド。
     今は選択が動かず(`selectionPlanFor`の`replace`が`keep`)、別の
     スライドを見ていると何が戻ったか見えない
   - 並べ替え(`move`): 動かしたスライド。今は開いていたスライドを
     追いかける(`follow-move`)
   - 挿入の取り消し(削除になる)と、削除の取り消し(挿入になる): 今の
     まま(隣のスライド / 戻ったスライド)

## スコープ

- **目的**: 上の1〜3を満たす。
- **やらないこと**:
  - 複数ウィンドウ間での履歴の共有、アプリ終了後の履歴の保存
  - メニュー項目のグレーアウトや操作名つきラベル(別の先送り事項)
  - テキストの取り消し単位を自前で決めること。CodeMirrorの`history`の
    グルーピング(`newGroupDelay`など)をそのまま使う
- **受け入れ条件**:
  - 1〜4の場面がそのとおりに動く。Redoも同じ時系列を逆にたどる。
  - vimの`u`で戻したテキストの変更を、そのあとのCmd+Zがもう一度戻そう
    としない(同じ変更を二重に戻さない)。
  - 本文の保存でスライドの数が変わったとき(`---`の入力など)、外部変更で
    読み直したときなど、今の履歴の破棄の規則は保たれる。

## 背景・要調査

実際に読んで分かったこと:

- スライド操作の履歴: `domain/editorHistory.ts`(`HistoryStep`は
  `slides`と`config`)と`state/historyStore.ts`。スライドを位置(index)で
  指す。本文の保存でスライド数が変わると`history.clear()`する
  (`components/Studio.tsx`)。
- テキストの履歴: `dom/codeEditor.ts`のCodeMirror `history()`。
  エディタは本文とノートの2つだけで、スライドを切り替えると
  `resetCodeEditorText`が状態を作り直し、履歴を捨てる。
- Cmd+Zの振り分け: `Studio.tsx`の`onMenuHistory`がフォーカスで決める
  (エディタ内ならCodeMirrorの履歴、外ならスライド操作)。vimの`u`は
  CodeMirrorの履歴を使う。
- スライドの`key`は、明示されていなければ見出しから作られる
  (`domain/slides.ts`)。見出しを編集すると変わるので、テキストの履歴の
  持ち主を`key`で識別するのは危険。位置(index)は並べ替えでずれる。

**着手条件**: `todo/editor-slide-state-cache.md`(スライドごとの
エディタ状態の保持)が完了していること。

設計(Fable(`claude-fable-5-1`)のレビュー、2026-09-25で決定):

- **テキストの履歴の正はCodeMirror**。アプリの時系列は「順番」だけを
  持つ。Cmd+Zで時系列のテキストの目印に当たったら、そのスライドを開き、
  そのエディタでCodeMirrorの`undo`を1回呼ぶ。これでvimの`u`/`Ctrl-R`と
  Cmd+Zが、同じ1つの履歴を操作することになり、食い違わない。
- **目印の形**: `{ kind: 'text'; index: number; field: 'body' | 'note';
  seq: number }`を`HistoryStep`に足す。自分自身が逆操作(`inverseStep`は
  そのまま返す)で、redo用の目印も同じ`seq`を持つ。
- **目印の持ち主は、記録したときの位置(index)をそのまま使う**。変換も
  内部IDも要らない。時系列は新しい順にしか戻らないので、ある目印に
  たどり着いた時点では、それより後の操作はすべて戻っており、スライドの
  並びは記録したときと同じになっている(スライド操作の`HistoryStep`が
  すでに位置で持てているのと同じ理由)。並びが外部要因で変わる場面では
  すでに履歴を捨てている。
- **「新しい履歴グループができた」ことの検出**: `undoDepth`をそのまま
  目印に使うのは不可。CodeMirrorは履歴が`minDepth + 20`を超えると
  古いものを切り詰めるので、深さがずれて古い目印が全部飛ばされる。
  代わりに、エディタごとに通し番号の写し(`TextHistoryMirror = { live:
  number[]; undone: number[] }`)を純粋な関数で更新する
  (`domain/textHistory.ts`、新規)。
  - `updateListener`で各トランザクションを`undo`/`redo`/`change`/`other`に
    分類し、変更前後の`undoDepth`と変更後の`redoDepth`を渡す。
  - `change`で深さが1増えた → 新しい番号を`live`に積み、`undone`を空に
    して、新しいグループとして通知する。深さが変わらない → 直前の
    グループに合流(入力の続き、IMEの変換)。通知しないが`undone`は空に
    する。深さが減った → CodeMirrorの切り詰めに合わせて`live`の古い側を
    削る。
  - `undo` → `live`の末尾を`undone`へ。`redo` → その逆。
  - `other`(選択だけ、`addToHistory: false`、設定の組み替え) → 何もしない。
  - 有効かどうか: `live`の末尾がその番号ならundoできる。`undone`の末尾が
    その番号ならredoできる。
  - 番号はウィンドウで1つの通し番号にする(エディタやスライドごとに
    しない)。
- **vimの`u`で先に戻された目印は、Cmd+Zで飛ばす**(有効でない目印は
  捨てて、次の目印へ進む。redo側にも積まない)。vimの`Ctrl-R`で戻すと
  再び有効になる。
- **スライド操作をまたいだ入力の合流を防ぐ**: CodeMirrorは500ms以内の
  隣接した入力を1つのグループにまとめるので、スライド操作の直前と直後の
  入力が1つのグループになり、目印がスライド操作より下に来てしまう。
  スライド操作を記録または再生するたびに、両方のエディタへ
  `isolateHistory: 'full'`の空のトランザクションを送って区切る。
- **履歴の上限**: `MAX_HISTORY_DEPTH = 100`(`domain/editorHistory.ts`)は
  入力の塊100個ぶんにしかならないので、1000程度に上げる。CodeMirrorも
  `history({ minDepth: 1000 })`にして、時系列が参照しているグループを
  切り詰めないようにする。
- **自動保存**: テキストのundoは`undo(view)` → `onChange` → 下書き →
  自動保存という、今のエディタ内undoと同じ経路を通る。別のスライドの
  undoは`selectSlide`を呼ぶので、開いているスライドの未保存の下書きは
  先に保存される。テキストの目印の再生も`serialized`の順番待ちに入れる。
  - その保存でスライド数が変わって履歴が捨てられた場合は、取り出した
    目印も捨てる(`handleSave`が「スライド数が変わったか」を返すように
    する)。
- **`setCodeEditorText`**(保存応答で差分だけ書き戻す、履歴に積まない)は
  そのままでよい。CodeMirrorは、履歴に積まない変更も履歴の位置合わせに
  反映する。
- **設定の変更(レイアウトなど)と本文のエディタ**: 本文のエディタには
  PageCommentが入っていない(`extractPageComment`)ので、`config`の
  ステップはエディタの履歴と重ならない。
- **`onMenuHistory`**: フォーカスでの振り分けをやめ、時系列をたどる。
  `execCommand`によるネイティブのundoは、セクション見出しのような普通の
  `<input>`だけに残す。`replayFocusedCodeEditorHistory`は削除する。
  設定画面を開いている間は今までどおり何もしない。
- **undo/redo時の選択(受け入れ条件4)**: 通常の操作の選択
  (`selectionPlanFor`)とは別に、undo/redoの再生用の選択を決める純粋関数を
  用意する(例: `domain/editorHistory.ts`の`selectionForReplay(step)`)。
  `config`はそのスライドを`select`、`move`は動かしたスライドの移動先を
  `select`、`insert`/`delete`は今の`selectionPlanFor`のまま。`runStep`は
  再生のときだけこれを使う。
- **別のスライドのundoで、キーボードのフォーカスはエディタへ移さない**。
  CodeMirrorのundoがスクロールして見せる。
- **既存のe2eのうち2つは、新しい挙動と逆のことを確かめているので
  書き換える**:
  - `e2e/structural-undo-redo.e2e.ts`の「本文にフォーカスがあるとき、
    Edit > Undoでスライド操作は戻らない」
  - `e2e/code-editor.e2e.ts`の「スライドAで1文字消してBに切り替え、
    Edit > UndoしてもBに戻らない」(Aに戻って文字が戻るのが新しい挙動)
- **既知の並びの癖**(許容): 「g1を打つ → `u` → Sの操作 → `Ctrl-R` →
  Cmd+Z」では、g1より先にSが戻る。`Ctrl-R`で時系列に積み直すのは
  後回し(先送り事項)。

## レイヤー配置

- `domain/editorHistory.ts`: `text`の目印、`inverseStep`、上限の引き上げ。
- `domain/textHistory.ts`(新規、純粋): 通し番号の写しと、その更新・
  有効判定。
- `dom/codeEditor.ts`: `history({ minDepth })`、`updateListener`から写しの
  更新と新しいグループの通知(`options.onHistoryGroup(seq)`)、区切りの
  トランザクション、指定したエディタでの番号つきundo/redo。
- `dom/fieldFocus.ts`: 普通の入力欄のネイティブundoだけを残す。
- `components/Studio.tsx`: 目印の記録、区切り、`replayHistoryNow`での
  テキストの目印の再生(飛ばす処理を含む)、`onMenuHistory`の書き換え。
- 写しは`dom/`側で保持し、signalには入れない。

## テスト

- `domain/textHistory.ts`のspecとadversarial: 新しいグループ、合流、
  undo、redo、undo後の入力で`undone`が空になる、切り詰め、履歴に積まない
  変更、`3u`、有効判定(末尾/末尾でない/空)。
- 飛ばす処理: 無効なテキストの目印を飛ばす、スライド操作で止まる、
  すべて無効なら何もしない。
- `inverseStep`の`text`。
- e2e: 受け入れ条件1(打つ → メニューでレイアウト変更 → 本文にフォーカス
  → undoでレイアウトが戻り、もう一度で文字が戻る)、2(Aで打つ → Bを
  クリック → undoでAが開き文字が戻り、`deck.source`も戻る。redoで
  やり直し)、本文とノートの順番、vimの`dd` → メニューのundoで戻る、`u`の
  あとのメニューのundoで二重に戻らない、`u` → `Ctrl-R` → メニューのundo
  で1回だけ戻る、スライド操作で区切られた入力が別々に戻る、`---`の入力で
  履歴が捨てられる、開いているスライドの設定変更で目印が増えない、保存が
  遅いときに素早く2回undo(1回目が別のスライド)。上の2つの既存テストの
  書き換え。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] 要調査1〜4をFableのレビューを踏まえて決め、このファイルに記録
- [x] 実装とテスト
- [x] `bun test` / `bun run typecheck` / `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機確認: 受け入れ条件の1〜4と、vimの`u`との組み合わせ

## 実装メモ

- 写しは`EditorState`ごとに持つ(`dom/textHistoryTracking.ts`の`WeakMap`)。
  スライドを離れるときの状態(`dom/editorSlideStates.ts`)と一緒に番号も
  戻ってくる。別のスライドの目印が有効かどうかは、その保存された状態で
  判定する(`peek`)。
- CodeMirrorの切り詰めのほか、履歴に積まない変更が最新のグループを
  消す場合(`addMapping`)と、undoで下のグループが消える場合にも深さに
  合わせて写しを削る。実際のCodeMirrorの履歴に対してテストした
  (`dom/textHistoryTracking.test.ts`)。
- 区切りは、スライド操作の記録とundo/redoの再生のほか、一方のエディタで
  新しいグループができたときにもう一方のエディタへ、保存した状態を戻す
  とき(`restoreCodeEditor`)にも入れる。
- 計画からの逸脱: 電話の形のメニューが開いている間は、今までどおり
  時系列を止め、フォーカスのあるエディタだけがvimの`u`と同じように自分の
  履歴を戻す(既存のe2eが確かめている挙動を保つため)。その目印は後で
  飛ばされる。

## 先送り事項

- vimの`Ctrl-R`でやり直した変更を、時系列に積み直すこと(上の「既知の
  並びの癖」を解消する)。
- 削除したスライドを元に戻したとき、そのテキストの履歴まで復元する
  こと(削除の逆操作に状態を持たせる必要がある)。
- スライド操作のundoの保存中(数十ミリ秒)に入力すると、その目印は保存前の
  位置で記録され、undoのあとでは別のスライドを指すので飛ばされる。redoの
  積み直しも入力より後になる(セルフレビューで発見)。再生中は目印の記録を
  待たせる、または位置を付け替える。下の既存の問題と同じ種類。
- 既存の問題(Fableのレビューで発見): 挿入・削除の保存中に入力すると、
  `reconcileAfterCommit`(`domain/editorSession.ts`)がその下書きを新しい
  スライドの位置と組み合わせてしまう。数十ミリ秒の間だけ起きる。
