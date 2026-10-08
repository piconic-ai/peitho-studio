---
status: wip
description: ディスク上のデッキがビルドできないとき、critで待っているエージェントにそのエラーを自動でコメントして直させる
tags: [agent, crit, error-handling]
---

# ビルドエラーをエージェントに自動でコメントする

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: 「AIと繋いでいるなら、peitho syntax errorを直すように自動で
コメントしたい」。`todo/archive/crit-review-bridge.md`/`todo/archive/
review-comment-ui.md`で作った往復(Studioがcritにコメント登録→
`finish`→エージェントが直して返信)に、人が書くコメントの代わりに
ビルドエラーを乗せる。**`todo/open-broken-deck.md`が前提**(構造化した
エラー`RenderErrorPayload`と、開く時の失敗でもセッションができること。
外部変更での失敗だけなら今の構造でも動くが、行番号を文字列から読み戻す
ことになるので先にそちらを終える)。

## スコープ

- **目的**: **ディスク上の**デッキ(開いた時、または外部変更の後)が
  ビルドできないとき、critのセッションでエージェントが待っていれば、
  エラーの行にheadline+helpのコメントを登録してその巡を`finish`する。
  まだ待っていなければ(直したばかりでまだ作業中)、待ち始めるまで保留し、
  その間に直ったら取り下げる。
- **やらないこと**:
  - タイプ中のドラフトのエラー。ディスクに書かれていない(`commitChange`
    が保存をブロックする)ので、エージェントには直しようがない。
  - エージェントが繋がっていないときに「繋いでください」と促すこと
    (既存のconnect cardのまま)。セッションがなければ何もしない。
  - Studio側のエラー修正、`peitho build`の警告。
  - ユーザーがまだ送っていない手書きコメント(`review.pending()`)を
    一緒に送ること。送るのはエラーのコメントだけ。手書きの分は次に
    ユーザーがSendした巡で送られる(下記「人間の判断」)。
  - 同じエラーの再送(ループ防止)。
  - 設定でのon/off(先送り。まずは常にon)。
- **受け入れ条件**:
  - エージェントが待っている状態で、壊れたデッキを開く/エージェント以外が
    壊した外部変更が来ると、ユーザー操作なしにcritにコメントが1件登録され、
    巡が`finish`される。コメントは`deck.md`のエラー行(行がなければ1行目)
    に付き、本文にheadline、help、ラベル`[Build error]`が入る。
  - コメント欄(`ReviewPanel`)にそのコメントがスレッドとして出て、
    エージェントの返信が普通に届く。
  - エージェントが作業中(待っていない)に壊れた場合、待ち始めた時点で
    送られる。待ち始める前に直った(ディスクのソースが描画できた)場合は
    送られない。
  - 同じheadlineのエラーが続く間は再送しない。別のエラーになったら送る。
    一度描画が通った後に再び壊れたら送る。
  - 送った直後にステータスバーに「ビルドエラーをエージェントに送りました」
    (en/ja)が出る。送信に失敗したら`review.setError`に出て、再試行は
    次のトリガーまでしない。
  - `ipc/fakeCritIpc.ts`を使ったe2eで上記が通る。

## 背景・要調査

実際に読んで分かったこと:

- **送る口は既にある**: `critIpc.addComments([NewReviewComment])`→
  `critIpc.finish()`(Studio.tsxの`sendReview`)。`NewReviewComment =
  { startLine, endLine, body, quote, author }`(`domain/critReview.ts`)。
  `review.pending()`(手書きコメント)を経由しなくても登録できる。
  送った後は`refreshReview()`で`listComments`から一覧が更新される。
- **待っているかの判定**: `review.session()`が`{kind:'found', agentWaiting}`。
  `sendAvailability`(`domain/reviewComment.ts`)は`unsent > 0`を要求するので
  そのままは使えない — `session.agentWaiting`を直接見る。待っていない間は
  `pollsForAgent`で3秒ごと(`REVIEW_POLL_MS`)に`sessionStatus`が読み直される
  ので、「待ち始めた」はこのポーリングで拾える。
- **エージェントの編集は外部変更として届く**: `onDeckFileChanged`→
  `noteAgentActivity()`+`handleExternalChange()`→`renderPreview(source)`。
  失敗するとエラーバーだけ出て、描画は最後の成功のまま。この失敗が本件の
  主なトリガー(エージェントが直したつもりで壊した)。エージェントは
  `crit`の返信後に次の巡で待つので、壊した直後は`agentWaiting: false`。
- **コメントのラベル規約**: `agentCommentBody(label, body)`=`[label] body`。
  `commentSlideKey`は`[Slide N (key: x)…]`形式だけを読む。`[Build error]`
  は該当せず`null` → `slideIndexOfComment`が行から探す経路に落ちる
  (`slideIndexOfLine`)。想定通りだが、コメント欄のピン表示
  (`previewPinsOf`)が`quote`なしのコメントをどう扱うかは実装時に確認。
- **外部変更時のconfirm**: `handleExternalChange`は手元が未保存だと
  `window.confirm`を出す(CLAUDE.mdの落とし穴に「WKWebViewで信頼できない」
  とある既存問題)。本件では触らないが、confirmで「破棄しない」を選んだ
  経路でも`renderPreview(source)`は走るので、トリガーは両経路で拾う。
- **二重送信の口**: `sendReview`と本件が同時に`finish`しうる。
  `review.busy() === 'sending'`の間は本件を待たせる。
- 推測(未確認): critは`finish`後に巡が進むとコメントIDを振り直す
  (`todo/archive/crit-review-bridge.md`の落とし穴)。本件はIDを追わない
  ので影響なしのはず。

実装時に分かったこと(前段`todo/isolate-broken-slides.md`の実装に合わせて
方針から変えた点):

- **エラーは1件ではなく一覧**: 前段の隔離で、1回の「ディスクの描画」が
  複数の壊れたスライド(`render.brokenSlides()`、それぞれにエラー)を
  返す。デッキ全体が拒まれた場合(`render.outcome().kind === 'failed'`)
  は1件。`diskBuildOf(outcome, brokenSlides, renderedSource)`がこの2つを
  「ディスクのビルド結果」`{ok} | {failed, errors[], source}`にまとめ、
  コメントはエラー1件につき1つ。トリガーは`runOpen`/
  `handleExternalChange`への配線ではなく、`renderStore`の`outcome`と
  `brokenSlides`を読む`createEffect`(保存で同じスライドを隔離し直しても
  identityの列が変わらなければ何も起きない)。
- **「同じエラー」の判定はheadlineではなく`kind`+`message`+スライドの
  キー(なければ番号)+`originFile`**(`buildErrorIdentity`)。headlineは
  行番号を含むので、エージェントがスライド2を直すとスライド4のエラーの
  行がずれ、同じエラーを送り直してループになる。送信済みのidentityは
  `sent.reported`に持ち、次の失敗ではそこに無いものだけ送る(ディスクが
  一度ビルドできたら忘れる)。
- **`RenderOutcomeState`は`domain/render.ts`へ移し、`failed`に失敗した
  ソース`source`を持たせた**(行番号が数えるテキストを、エラーと一緒に
  持たないとquoteが取れない)。`markRenderFailed(error, source)`。
- **`review.reset()`は`runOpen`の先頭に移した**: 以前は`opened`の後だった
  ので、開いた時の`markRenderFailed`で記録した報告状態を直後のresetが
  消していた。
- **`kind: 'Other'`のエラー(レイアウトHTML、IO)は送らない**
  (`isReportable`)。それだけのときは「壊れているが送るものなし」で、
  `sent`も`idle`も崩さない。
- **送信中の二重送信**は`review.busy()`で防ぐ(本件の送信も`'sending'`に
  する — パネルの「送信中」表示とSendボタンの無効化がそのまま効く)。
  `agentWaiting`と`busy`を読むeffectが「待っている & 送信中でない」に
  なるたび`agent-waiting`をdispatchするので、ユーザーのSendや本件の送信が
  終わった時点で待ちのエラーが自動で流れる。
- `[Build error]`ラベルはパネルで`splitCommentLabel`がtargetとして出す
  (`domain/reviewPanel.ts`)。ピンは`quote`なしの行コメント扱いで
  スライドの隅に付く(`pinOfQuote`、`slideIndexOfLine`で該当スライドに
  紐づく)。
- 送信に使うソースは`render.renderedSource()`(隔離した描画と対になる
  書かれたままのソース)または`outcome.source`で、`editor.fullSource()`
  ではない(`commitChange`は`applyRenderPayload`の後、ディスク書き込みを
  待ってから`fullSource`を更新するため、その隙間に読むとずれる)。

## 方針

1. `domain/buildErrorReport.ts`(新規、純粋)にADTと遷移表:
   ```
   Report = {kind:'idle'} | {kind:'waiting-for-agent'; error} |
            {kind:'sent'; headline}
   Event  = {type:'disk-render-failed'; error} | {type:'disk-render-ok'} |
            {type:'agent-waiting'} | {type:'sent'} | {type:'send-failed'}
   decide(state, event, agentWaiting): {next, effect?: 'send'}
   ```
   - `disk-render-failed`: `sent`で同じheadlineなら無視。`agentWaiting`なら
     即`effect:'send'`、でなければ`waiting-for-agent`。
   - `disk-render-ok`: `idle`に戻す(`sent`も。次に壊れたらまた送る)。
   - `agent-waiting`: `waiting-for-agent`なら`send`。
   - `send-failed`: `idle`(再試行は次のトリガーまでしない)。
   `domain/deckLifecycle.ts`の`decide`と同じ作り(呼び出し元は`next`を
   自分で決めない)。
2. `buildErrorComment(error, source): NewReviewComment`(純粋):
   `startLine = endLine = error.line ?? 1`(範囲外は1に丸める)、
   `quote`はその行のテキスト(空行なら`''`)、`body = agentCommentBody(
   'Build error', headline + "\n= help: " + help + "\n" + 固定の一文)`。
   固定の一文は英語(エージェント向け): 「Fix the deck so `peitho build`
   passes, then reply.」`originFile`があれば本文にファイル名を入れる
   (`include`先やレイアウトは`deck.md`の1行目に付ける。レイアウトHTMLの
   `Other`エラーは本件では送らない — `kind`が取れないため。先送り)。
   `author = REVIEW_AUTHOR`。
3. Studio.tsx(副作用): `runOpen`の`failed`と`handleExternalChange`の
   描画失敗で`disk-render-failed`、描画成功で`disk-render-ok`、
   `review.session()`が`agentWaiting`に変わる`createEffect`で
   `agent-waiting`をdispatch。`effect:'send'`で`addComments`→`finish`→
   `refreshReview()`→`setStatusMessage({kind:'build-error-reported'})`。
   `review.busy() !== 'idle'`なら次のポーリングまで待つ(`sent`にしない)。
4. 文言: `domain/messages.ts`に`buildErrorReported`(en/ja)。

## レイヤー配置

- `domain/buildErrorReport.ts`: `decide`、`buildErrorComment`、
  `sameError(a, b)`(headline比較)。
- `domain/messages.ts`: 文言。
- `state/reviewStore.ts`: `report`シグナルを足すか、Studio.tsxに閉じるか —
  `review`の他の状態(`session`、`busy`)と一緒に読むので`reviewStore`に
  置き、`decide`の呼び出しだけStudio.tsx。
- `components/Studio.tsx`: トリガーの配線と`send`効果。
- Rust: 変更なし(`crit_add_comments`/`crit_finish`は既存)。

## テスト

- `domain/buildErrorReport.test.ts`: `decide`の全遷移のspec、adversarial
  (同じheadlineの連続、`sent`中の別エラー、`waiting-for-agent`中に
  `disk-render-ok`、`agentWaiting`が`true`のまま`send-failed`→次の失敗で
  再送されること、`idle`への`agent-waiting`は何もしない)。
- `buildErrorComment`: `line`なし/0/行数超、helpが空、`originFile`あり、
  ソースが空文字列、該当行が空行、CRLFソース。
- `state/reviewStore.test.ts`: `report`の初期値と`reset()`で`idle`に戻る。
- e2e(モック、`crit: createFakeCritIpc({agentWaiting: true})`+
  `commandError`で`open_deck`を失敗): 開いただけでfakeCritに`addComments`
  1件+`finish`が記録され、ステータスバーに文言。`agentWaiting: false`で
  開き、途中で`true`に切り替えると送られる(fakeCritの切替口が無ければ
  足す)。直った後(`commandError`を外して外部変更を発火)は送られない。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `bun run test:e2e` グリーン(新規specを含む)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] **設計判断**: 自動送信でユーザーの未送信コメントを巻き込まない
  (エラーだけ送って巡を閉じる)でよいか。代案は「未送信があれば一緒に
  送る」。本ファイルは巻き込まない前提。
- [ ] **設計判断**: 開いた時点で壊れていて、かつエージェントが待っている
  ときも無断で送ってよいか(本ファイルは送る前提。嫌なら「外部変更の
  ときだけ」に絞る)。
- [ ] 実機で、エージェント(Claude Code等)が`[Build error]`コメントを
  受けて実際に直して返信するまでの往復を1回通す。

## 先送り事項

- 設定でのon/off(`SettingsPanel`に項目を足す)。
- レイアウトファイル由来の`Other`エラー(`assets::resolve`)を
  `NewLayoutComment`(`FileLines`)でそのファイルに付ける。
- `handleExternalChange`の`window.confirm`依存(CLAUDE.mdの落とし穴)を
  アプリ内UIに置き換える — 本件とは別。
- タイプ中のドラフトが描画に通ると(隔離なしの1回描画が成功すると)、
  前段の`applyRenderPayload`が`brokenSlides`を空にするので、本件は
  それを`disk-render-ok`と見なす(600ms後の自動保存でディスクも直る
  前提)。保存が通らず壊れたままなら次の失敗で同じエラーを送り直す。
  ドラフトの成功と保存の成功を区別するなら、`renderStore`に「ディスクの
  描画か」を持たせる必要がある。
- 送信失敗後の再試行は「次のイベント」(ディスクの変更、エージェントの
  次の巡)任せ。タイマーでの再試行は入れていない。
- 同じ`kind`+`message`のエラーがキーのないスライドで位置を変えたとき
  (前にスライドを挿入した)は別のエラーとして送り直す。キーを付ければ
  位置に依らない。
- ステータスバーの文言は件数を出さない(「ビルドエラーをエージェントに
  送りました。」)。複数件でも同じ。
- Rust側の`crit_add_comments`は、同じ行・本文・quote・authorの未解決
  コメントが既にセッションにあれば送らない(`unsent_comments`、送信失敗の
  再試行用)。「一度直ってまた同じ壊れ方をした」とき、前のコメントが
  未解決のまま残っていればコメントは増えず`finish`だけになる(critは
  `finish`ごとに未解決コメントを全部エージェントに渡すので、届きはする)。
  モックe2eのfakeCritはこの重複排除をしないので、そこでは2件になる。
