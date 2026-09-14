---
status: done
description: WelcomeScreenのOpen Deck/Recentクリックが実機で「フリーズして見える」問題の切り分けと対処
tags: [ui, feedback]
---

# WelcomeScreen Open Deck/Recent の「フリーズして見える」問題

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: [[action-click-feedback]](`todo/action-click-feedback.md`, PR #55,
Presentボタンのクリックフィードバック)の実機検証中にユーザーが発見。
「WelcomeでOpen Deckしているときも、Recentをクリックしても、
インタラクションがないため、フリーズしているように見えました」との指摘。
Present側の対応(`present-ready`イベント待ち)とは別問題であり、
PR #55のスコープには含めず本ファイルとして切り出した。

## スコープ

- **目的**: WelcomeScreenで"Open Deck…"ボタンまたはRecentエントリを
  クリックした際、実機で「押した」ことが体感できるようにする(クリック
  直後から`open_deck`完了までの間、フリーズに見えない)。
- **やらないこと**: アプリ全体の全ボタンへの一律適用。PR #55で対応した
  Presentボタン自体の再修正。ネイティブフォルダピッカー
  (`openDialog`)が開くまでの体感速度の改善(OSダイアログ自体の話で
  このタスクの範囲外)。
- **受け入れ条件**: 実機で"Open Deck…"/Recentエントリをクリックした
  瞬間から`open_deck`完了までの間、目に見える変化がある(フリーズして
  見えない)。

## 背景・要調査

- `WelcomeScreen.tsx`の`isBusy`フィードバック(`disabled` +
  ラベル"Opening…")は"Open Deck…"ボタンと各Recentエントリの両方に
  **既に実装済み**(`props.isBusy`経由、`deck.isBusy()`は
  `deckLifecycle`が`'opening'`の間`true` — `domain/deckLifecycle.ts`)。
- **調査済み**: Playwright + モックIPCで`open_deck`に1500msの遅延を
  入れて検証したところ、"Open Deck…"・Recentエントリいずれも遅延中
  ずっと正しく`disabled=true` / `text="Opening…"`を維持した(スクラッチ
  スクリプトで確認、リポジトリには未コミット)。**つまりコードレベルの
  リアクティビティ自体は壊れていない** — BarefootJSの既知の落とし穴
  (CLAUDE.md参照)には該当しない。
- 一方、Presentボタンで実際に見つかった根本原因は「IPC呼び出し自体が
  一瞬で解決するため、busyフィードバックが視認できないほど短く点滅する」
  というタイミング問題だった(`present_deck`は`peitho present`
  サブプロセスの`spawn()`が通った時点で即returnする)。`open_deck`も
  実機ではpeitho-coreをin-processでレンダリングしており(CLAUDE.md
  「Design principles」参照)、典型的な小さいデッキだと同様に一瞬で
  解決してしまい、同じ理由でフィードバックが視認できない可能性が高い
  というのが現時点の仮説(未検証 — 実機での体感時間を計測していない)。
- Presentのケースと違い、`open_deck`には「サブプロセスが裏で処理中」
  のような後続の非同期処理は無い — 呼び出しが解決した時点で本当に
  完了している。したがってPresentでは(タイマーだけでは実際の完了と
  無関係な誤魔化しになるため)見送った「最小表示時間(min-duration)」
  的な対処が、`open_deck`には正しい解決策になりうる(誤魔化しではなく、
  「短すぎて知覚できない状態変化を人間が気づける長さまで引き伸ばす」
  だけで済む)。
- 実機のWKWebView固有の要因は**未検証・未確認**。CLAUDE.mdには
  WKWebViewで`window.confirm`/`prompt`が不安定という既知の落とし穴が
  あり、`plugin:dialog|open`(`openDialog`)や、ボタンクリックから
  `disabled`反映までの描画自体に同種の遅延/不具合がないかも要確認。
  Chromeベースの検証だけでは再現しない類の問題である可能性を排除
  できていない。

## 方針

1. **最初に実機で体感時間を計測する**(`run-peitho-studio` skill) —
   実際のデッキで"Open Deck…"/Recentクリックからボタンの見た目変化
   までの間隔を体感/計測し、以下のどちらかを切り分ける:
   - (a) 変化はあるが一瞬すぎて気づけない(Presentと同根の
     タイミング問題)
   - (b) 本当に何も変化していない(WKWebView固有の描画/反映遅延など、
     未知の要因)
2. (a)だった場合: `WelcomeScreen.tsx`のisBusy表示に最小表示時間
   (例: 300ms程度)のガードを導入する。`domain/eventRace.ts`の
   `waitForEventOrTimeout`とは別の、より単純な「最低nms間は表示し
   続ける」ロジックが必要になる可能性が高い(既存関数はイベント待ちの
   ための設計で、min-durationのユースケースには直接転用できない)。
3. (b)だった場合: 実機でのみ発現する原因を別途切り分ける(WKWebViewの
   `disabled`属性反映タイミング、ダイアログ関連の既知の不具合との
   関連など)。方針は原因判明後に再検討。

## レイヤー配置

- フロント: `components/WelcomeScreen.tsx`(表示ロジック)。min-duration
  用のタイマーロジックを純粋関数として切り出す場合は`domain/`配下
  (例: `domain/minDuration.ts`)に置き、`.tsx`側はそれを呼ぶだけにする
  (CLAUDE.mdの層分離方針に従う)。
- Rust側の変更は現時点では想定していない(`open_deck`自体の処理内容を
  変える話ではない)。

## テスト

- min-duration方式で対処する場合、新設する純粋関数にspec
  (典型: 短い処理が最低表示時間まで引き伸ばされる)・adversarial
  (境界値: 処理時間が最低表示時間ちょうど/それより長い場合に無駄な
  遅延を追加しない、タイムアウト0など)を書く。
- `e2e/helpers/mockTauri.ts`に`open_deck`用の遅延ノブ
  (`openDeckDelayMs`など、`presentDeckDelayMs`と同パターン)を追加し、
  `e2e/`にGiven-When-Thenのテストを追加する。

## 完了条件

自動で確認できる項目:
- [x] `bun test` / `bun run typecheck` グリーン
- [x] 対応するe2eテストがグリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] 実機で"Open Deck…"/Recentクリック時の体感を確認 — ユーザーから
      「Presentのところは、表示が切り替わり問題ない。Open Deck,
      Recentも固まっているように見えるので対処してほしい」との回答を
      得た。Chromeベースの検証(下記実装メモ参照)で原因を再現・特定
      できたため、上記(a)/(b)の切り分けは(a)寄りの原因(後述)で
      決着し、WKWebView固有要因の追加調査は不要と判断。
- [x] 対処実装後、実機で「フリーズして見えない」ことを再確認する —
      `tauri-plugin-playwright`(`docs/tauri-playwright-spike.md`)経由で
      実際のWKWebViewウィンドウに対して`e2e-tauri/tests/
      welcome-busy-floor.tauri.e2e.ts`を実行し、Recentエントリクリック
      →エディタ表示までフリーズ・エラーなく遷移することを確認。ただし
      ソケット越しの通信自体に数百ms〜秒単位の遅延があり、400msの
      フロア時間を実機側でミリ秒精度で検証することはできなかった
      (その精度はモック版e2eテストで担保)。

## 先送り事項

- ネイティブフォルダピッカー(`openDialog`)が開くまでの体感速度は
  このタスクの範囲外(OSダイアログ自体の起動速度の話であり、
  `action-click-feedback.md`で「プレゼンウィンドウ自体の起動速度の
  改善はやらない」としたのと同じ理由で対象外)。

## 実装メモ

想定していた(a)(タイミング問題)とは少し違う、より根が深い原因だった:
`WelcomeScreen.tsx`の`isBusy`表示ロジック自体は元から正常に動作して
いたが、`deck.deckPath()`(WelcomeScreenを表示し続けるかどうかを決める
条件)は`open_deck`が解決した瞬間に非nullへ切り替わり、`isBusy`が
まだtrueかどうかとは無関係に**同じtickでWelcomeScreenごとエディタへ
差し替わる**実装になっていた。典型的な小さいデッキでは`open_deck`が
一瞬(1フレーム未満)で解決するため、busyフィードバックが**一度も
ペイントされないまま**画面がエディタに切り替わっていた
(Playwrightで`openDeckDelayMs: 0`のスクラッチプローブを使い実測:
クリック直後の最初のポーリングで既にWelcomeScreenが消えエディタが
表示されていることを確認)。

対処:
- `domain/minDisplayDuration.ts`に純粋関数`remainingMinDisplayMs`を
  新設(spec+adversarialテストあり)。
- `Studio.tsx`に`welcomeBusyDisplay`シグナルを追加。`deck.isBusy()`を
  ラップし、busyになった瞬間から最低`MIN_WELCOME_BUSY_DISPLAY_MS`
  (400ms)間はtrueであり続けるフロアを持たせた。
- 重要: **`isBusy`propの値だけでなく、`WelcomeScreen`を表示し続ける
  かどうかの条件式自体**(`deck.deckPath() === null` →
  `deck.deckPath() === null || welcomeBusyDisplay()`)も
  `welcomeBusyDisplay()`でゲートするよう変更。propだけ引き伸ばしても
  コンポーネント自体が先に消えてしまうため意味がなかった。
- `NewDeckModal`の`isBusy`も同じ`welcomeBusyDisplay()`を共有(同じ
  `deck.isBusy()`由来の問題のため)。
- `e2e/helpers/mockTauri.ts`に`openDeckDelayMs`ノブを追加
  (`presentDeckDelayMs`と同パターン)。
- `e2e/welcome-busy-feedback.e2e.ts`にGiven-When-Thenのe2eテストを
  3本追加(近似即解決ケース2本 + 元々遅いケースでフロアに打ち切られ
  ないことを確認する1本)。
- 全テストグリーン: `bun test` 294 pass / `bun run typecheck` clean /
  `bun run test:e2e` 12/12 pass。
- Chromeベース(Playwright)での修正後の実測: Recentクリックから
  エディタ表示切り替えまで約360ms(フロア400msに近い値)で、busy状態
  (`disabled=true`)がその間ずっと視認可能であることを確認。ただし
  これは開発サーバー+モックIPC上の検証であり、実機(WKWebView)での
  再確認はまだ。
