---
status: wip
description: エラーバーの「コピー」をエージェントへの送信に置き換え、ビルドエラーは直るまで消さない。編集中の壊れたスライドはその場で壊れたまま保存して送る
tags: [agent, crit, error-handling, editor]
---

# エラーバーからビルドエラーをエージェントに送る

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: エディタで見出しを消して`slot 'title' got 0 item(s)`になったとき、
エラーバーには「コピー」しかなく、しかも6秒で消えてしまう。「コピーじゃ
なくてAIチャットへのコメントにしよう。出しっぱなしにしよう」。
`todo/auto-report-build-error.md`(#187)の自動送信はディスク上のデッキが
壊れたときだけで、ユーザー自身の打ち込みで出たエラーはディスクに届かない
(保存がブロックされる)ので送られない — それをユーザーの明示操作で
送れるようにする。壁打ちの結論: **押したら、そのスライドを壊れたまま
deck.mdに書いてから、#187と同じ`[Build error]`コメントを送る**
(エージェントはdeck.mdしか見られないので、書かずに送っても直せない。
代案「下書き本文をコメントに同封」「レビュー欄に未送信として置くだけ」は
ディスクとのずれが残るので却下)。

## スコープ

- **目的**: エラーバーに出たビルドエラーを、ボタン1つでcritのエージェント
  に渡せるようにする。渡すために必要なら、編集中の壊れたスライドを
  (#186で決めた「編集中のスライドは壊れたまま書かない」の明示的な例外
  として)壊れたままディスクに書く。ビルドエラーはユーザーが直すか
  エージェントが直すまでエラーバーに出し続ける。
- **やらないこと**:
  - 打ち込みで出たエラーを自動で送ること(#187の線引きは変えない。
    送るのは明示操作だけ)。
  - ビルド以外のエラー(発表の失敗、クリップボード、更新)のボタン変更。
    これらは今まで通り「コピー」と6秒タイマー。
  - エージェントがいないときにcritセッションを起こすこと。接続案内は
    レビュー欄に既にある(`agentConnectCommand`)。
  - プレビュー欄のエラー表示(`SlidePreview.tsx`)にボタンを足すこと。
  - 送った後の往復の変更(返信の表示などは#187のまま)。
- **受け入れ条件**:
  - エラーバーがビルドエラー(`showBuildError`で出したもの、または
    `render.outcome()`/隔離済みスライドのディスクのエラー)を出している
    とき、ボタンは「コピー」ではなく「エージェントに送る」(en: "Send to
    agent")。ビルド以外のエラーでは今まで通り「コピー」。
  - ビルドエラーは6秒で消えない。次の描画が通った時点(打ち直して直った、
    別スライドに移って下書きが消えた、エージェントが直して外部変更が
    来た)で消える。
  - **編集中のスライドの下書きが壊れている**(保存がブロックされている)
    状態でボタンを押すと、そのスライドを含む`nextSource`がそのまま
    deck.mdに書かれ(隔離の`draft`印は書かない — #186と同じ)、その
    スライドはERRORバッジのプレースホルダーになり、エディタは未保存なし
    になる。続けて、エージェントが待っていれば#187と同じコメント
    (エラー行、headline、help、`[Build error]`)が登録されて巡が
    `finish`され、ステータスバーに「ビルドエラーをエージェントに送り
    ました」。待っていなければ「エージェントの接続を待っています」が出て、
    エージェントが待ち始めた時点で送られる(#187の`waiting-for-agent`)。
  - **デッキのソースエディタ**(#185)の下書きが壊れている状態で押すと、
    そのテキストがそのままdeck.mdに書かれ、デッキは#185の描画なし状態
    (または隔離できる分だけ隔離した状態)になり、同様に送られる。
  - **既にディスクのエラーとして自動送信済み**のエラーでボタンを押すと、
    同じエラーでももう1回送られる(ユーザーが明示的に頼んだので、
    `reported`の重複除外は効かせない)。押していないのに2回送られる
    ことはない。
  - 送信に失敗したら`review.setError`に出る(#187と同じ)。
  - `ipc/fakeCritIpc.ts`を使ったモックe2eで上記が通る。

## 背景・要調査

実際に読んで分かったこと(ブランチ`auto-report-build-error` a93e4dc):

- **エラーバー**: `components/StatusBar.tsx`。`errorMessage`と
  `onCopyErrorMessage`/`errorMessageCopied`、画像スロットの直し方ボタン
  (`imageSlotFix`)を持つ。常時マウントして`hidden`で切り替える
  (BarefootJSの条件マウントの落とし穴、ファイル内コメント参照)。
  `Studio.tsx`は`shownErrorMessage = errorMessage() ?? buildError()`を
  渡す(#185)。`buildError`は`render.outcome()`が`failed`のときの
  ディスクのエラー。
- **6秒タイマー**: `Studio.tsx`の`createEffect`(「Skipped while the New
  Deck modal is open」のコメントの直後)。`errorMessage() ===
  shownBuildError`のときは`render.outcome().kind === 'failed'`に限って
  スキップしている。`showBuildError(message)`が`shownBuildError`を記録
  する。スクリーンショットのケース(ディスクは正常、下書きだけ壊れた)は
  この条件から漏れて6秒で消える — 「出しっぱなし」はこの条件から
  `outcome`の制限を外すだけ。消すのは`renderPreview`成功時と
  `commitChange`成功時の`setErrorMessage(null)`で、これは今のまま。
- **下書きのエラーがどこから来るか**: 速いレーン(`renderPreview(draft)`、
  `persisted: false`)の`RenderFailure`と、遅いレーンの`handleSave` →
  `commitChange`の`RenderFailure`(`saveDecision`が`block`を返した
  とき)。どちらも`showBuildError(err.message)`。文字列しか残らないので、
  ボタンが「どのエラーか」を知るには`RenderErrorPayload`を別に持つ必要が
  ある(`shownBuildError`を`{ message, error }`にする)。
- **壊れたまま書く経路は既にある**: `commitChange`は`renderIsolating
  (nextSource, allow)`で描画し、`allow`が`saveDecision(...) ===
  'isolate'`。`saveDecision`(`domain/brokenSlides.ts`)は
  `index === editedIndex`なら`block`。明示操作では編集中のスライドも
  `isolate`にすればよい — `commitChange`にオプション(`handOff: true`
  など)を足して`allow`を差し替える。描画が通れば`saveDeckSource` →
  `markDiskRendered(nextSource, result.broken)`で、`broken`が空でない
  ので`render.diskRender()`経由の既存effect(`diskBuildOf` →
  `dispatchBuildErrorReport({type:'disk-render-failed'})`)が勝手に
  動く。つまり**送信の本体は#187が全部持っていて、ボタンの仕事は
  「書く」と「重複除外を外す」だけ**。
- **隔離できないエラー**: `brokenSlideIndex`が`null`を返すもの
  (frontmatter、`include`先、スライドに紐づかないparseエラー)は
  `renderIsolating`が`failed`を返す。この場合は描画なしで書く:
  `saveDeckSource(text)` → `render.markRenderFailed(error, text)`
  (`diskRender`が`failed`になり、同じeffectが送る)。`open_deck`が
  失敗したときと同じ状態(#185)。ソースエディタの`commitSource`も
  同じ形で、描画が通らなければ書かない — ここも明示操作のときだけ
  書く。
- **重複除外**: `domain/buildErrorReport.ts`の`decideBuildErrorReport`
  は`reported`(デッキが最後にビルドできてから送った
  `buildErrorIdentity`)にあるエラーを`disk-render-failed`で送らない。
  明示操作の再送には新しいイベントが要る。`reported`を空にして
  `disk-render-failed`相当を流せばよい(`agentReady`なら`send`、
  でなければ`waiting-for-agent`)。
- **エージェントがいないとき**: `agentReadyForReport()`は
  `session.agentWaiting && busy === 'idle'`。`waiting-for-agent`に
  なれば`agent-waiting`イベント(待ち始めを見たeffect)が送る。ステータス
  の文言は新規(`statusMessage.ts`に`build-error-waiting`を足す)。
- **e2eの土台**: `e2e/auto-report-build-error.e2e.ts`が
  `createFakeCritIpc()`+`slotErrorAt('BROKEN')`で開く→送信→返信まで
  通している。`crit.calls`で`addComments`/`finish`の順序と中身を見る。
  `mockTauri`の`deck.source`がディスク。エージェントが待っていない
  セッションの作り方は同spec内の既存テスト(`agentWaiting: false`)
  に倣う。

## 方針

1. `domain/buildErrorReport.ts`に`{ type: 'report-requested' }`イベントを
   足す: `errors`は現在のディスクのエラー(`diskBuildOf`の結果を
   `Studio`が渡す — `{ type: 'report-requested'; errors; source }`)、
   `reported`は空にして、`agentReady`なら`send`、でなければ
   `waiting-for-agent`。`disk-render-ok`なら何もしない。
2. `domain/brokenSlides.ts`の`saveDecision`に第5引数`handOff: boolean`
   を足す(`index === editedIndex`でも`handOff`なら`isolate`)。または
   `handOffDecision`を別関数にする — `saveDecision`の呼び出しが1箇所
   なので引数で十分。
3. `Studio.tsx`:
   - `shownBuildError`を`{ message, error: RenderErrorPayload } | null`
     にし、`showBuildError(err)`は`RenderFailure`を受ける(呼び出し
     3箇所)。`sourceCloseUnsaved`の文字列だけのケースは`error: null`。
   - タイマーeffectの条件から`render.outcome().kind === 'failed'`を外す。
   - `handOffBuildError()`:
     1. ソースエディタが開いていて下書きが汚れている → `commitSource`
        に`handOff`を足した経路で書く(描画失敗なら`saveDeckSource` +
        `markRenderFailed`)。
     2. そうでなく本文エディタが汚れている → `handleSave`に`handOff`を
        通し、`commitChange`の`allow`を`saveDecision(..., true)`に。
        それでも`failed`(隔離できないエラー)なら`saveDeckSource` +
        `markRenderFailed`。
     3. 汚れていない(エラーは既にディスクのもの) → 何も書かない。
     4. 最後に`dispatchBuildErrorReport({ type: 'report-requested', ...
        diskBuildOf(render.diskRender()) })`。1〜2で`markDiskRendered`/
        `markRenderFailed`が走ると既存effectが`disk-render-failed`を
        先に流すので、`report-requested`は「重複除外を外して送る」役。
        同じクリックで2回送られないよう、`disk-render-failed`が
        `send`を起こした(`busy === 'sending'`)なら`report-requested`は
        `waiting`に留めず**何もしない**(既に送っている)。
   - 画像スロットの直し方ボタンとの共存: 今まで通り(別ボタン)。
4. `StatusBar.tsx`: `errorAction: 'copy' | 'send'`を受けてラベルを
   出し分ける。`domain/errorBar.ts`(新規・純粋)に
   `errorBarAction(shown: 'build' | 'other' | 'none')`を置くほどでも
   ないので、`Studio.tsx`のmemoで`shownBuildError !== null ||
   buildError() !== null`を見て決める。
5. メッセージ(`domain/messages.ts` en/ja): `sendErrorToAgent`
   ("Send to agent"/「エージェントに送る」)、
   `buildErrorWaitingForAgent`("Waiting for an agent to send the build
   error to."/「エージェントの接続を待っています。」)。

## レイヤー配置

- `domain/buildErrorReport.ts`: `report-requested`イベントと遷移。
- `domain/brokenSlides.ts`: `saveDecision`の`handOff`。
- `domain/statusMessage.ts`/`domain/messages.ts`: 文言。
- `components/StatusBar.tsx`: ボタンのラベル切り替え(値のpropsのまま)。
- `components/Studio.tsx`: `handOffBuildError`、`shownBuildError`の型、
  タイマー条件。Rust変更なし。

## テスト

- `decideBuildErrorReport`の`report-requested`: spec(送信済みのエラーが
  もう一度`send`になる/`agentReady`でなければ`waiting-for-agent`)、
  adversarial(`idle`で`errors`空、`sent`からの再送で`reported`が
  空になる、`send-failed`からの再送)。
- `saveDecision(…, handOff)`: spec(編集中のスライドが`isolate`)、
  adversarial(スライドに紐づかないエラーは`handOff`でも`block`、
  `editedIndex === null`)。
- `statusText`の新kind。
- e2e(`e2e/send-build-error-from-error-bar.e2e.ts`、
  `auto-report-build-error.e2e.ts`の形を踏襲):
  1. 本文を壊して6.5秒待ってもエラーバーが残り、直すと消える。
  2. エージェント待機中にボタン → `deck.source`に壊れた本文、
     `addComments`→`finish`、コメントの行が壊した行、ステータス文言、
     ERRORバッジ、エディタは未保存なし。送信は1回だけ。
  3. エージェント不在でボタン → 「待っています」→ エージェントが
     待ち始めたら送られる。
  4. 自動送信済みのディスクのエラーでボタン → もう1回送られる。
  5. ソースエディタでfrontmatterを壊してボタン → そのまま書かれて
     描画なし状態、送られる。
  6. 発表の失敗など非ビルドエラーでは「コピー」のまま。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] 上記e2e、`auto-report-build-error.e2e.ts`、
  `isolate-broken-slides.e2e.ts`、`open-broken-deck.e2e.ts`がグリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で、下書きのエラーをボタンで送り、エージェントが直して返信
  するまでを1回通す。
- [ ] **設計判断**: 「エージェントに送る」を押した結果、壊れたデッキが
  ディスクに書かれる(`peitho build`が通らない状態になる)ことを
  ユーザーが分かる表示で十分か(ステータス文言だけ)。

## 実装で決まったこと

- 送信の本体は方針通り#187のまま。ボタンは「書く」(`commitChange`/
  `commitSource`の`handOff`)と「重複除外を外して流す」
  (`report-requested`)だけで、`disk-render-failed`が先に`send`を起こして
  いれば`report-requested`は何も足さない(`busy`中は`agentReady`が
  偽で`waiting-for-agent`に留まり、`sent`で空になる)。
- 本文エディタから保存したスライドは`replaceSlideText`の並べ方で
  行がずれる(e2eの`SOURCE`では`BROKEN`が8行目→保存後7行目)。
  コメントはディスクの行に付くので、下書き中にエラーバーが示す行と
  送られる行は一致しないことがある。
- 壊れたまま保存されたスライドは、直前の描画があればそのサムネイルを
  残してERRORバッジが付く(#186の挙動)。e2eはバッジだけを見る。
- `shownBuildError`は文字列のまま。ボタンは`RenderErrorPayload`を
  必要としない(ディスクに書いてから`diskBuildOf`で読み直す)。
- `sourceCloseUnsaved`(閉じられない理由)も`showBuildError`経由なので
  ボタンは「エージェントに送る」になり、押すとソースの下書きが
  そのまま書かれる — 閉じる前に渡す、という意味で妥当とした。

## 先送り事項

- 打ち込みのエラーを一定時間直らなければ自動で送る、という中間案
  (#187の線引きの議論)。
