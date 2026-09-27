---
status: wip
description: デッキ全体の設定(page_numbers / aspect_ratio / breaks / lang)をネイティブの「Deck」メニューに集約し、ヘッダーのページ番号コントロールを外す
tags: [deck-settings, frontmatter, native-menu]
---

# デッキ設定をネイティブ「Deck」メニューに集約

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザー要望「スライド全体に影響する設定(frontmatter)のUIを整理
したい」(2026-09-28)。frontmatterの全キーを設定頻度・分かりやすさで分析
した壁打ちの結論:

- 選択肢から選ぶだけのデッキ設定はネイティブメニュー「Deck」**だけ**に
  置く。アプリ内の「Deck Settings…」画面は当面作らない。
- `todo/page-numbers-toggle.md`(PR #112、マージ済み)でヘッダーに置いた
  ページ番号の3択は、このメニューへ移してヘッダーから外す(ユーザー了承
  済み)。ヘッダーには言語バリアント切替とPresentだけが残る。
- 「新規作成時にだけ設定できる」は避ける。新規作成時の案内は
  `todo/new-deck-settings.md`で扱い、後からの変更はすべてこのメニューで
  できるようにする。

## スコープ

- **目的**: `page_numbers` / `aspect_ratio` / `breaks` / `lang`を、前面
  ウィンドウのデッキに対してネイティブメニューから変更でき、現在値が
  メニューのチェック状態に出るようにする。
- **やらないこと**:
  - アプリ内の設定画面(文字や色を入力するUI)。そのため`pointer_color`
    と、`lang`の自由入力はこのtodoでは扱わない。
  - `resolution`(`todo/pdf-export.md`で扱う)。
  - `css`/`layouts`/`fonts`/`syntaxes`/`code_images`/`time`のUI。`time`は
    すでに自動で書き込まれている。
  - 新規作成ダイアログの変更(`todo/new-deck-settings.md`)。
  - スライド単位の`page_number:false`トグル(右クリックメニューのまま)。
- **受け入れ条件**:
  - メニューバーに「Deck」メニューがあり、次の項目がある。
    - Page Numbers ▸ Off / 1 / 1/N(ラジオ的に1つだけチェック)
    - Aspect Ratio ▸ 16:9 / 4:3(同上)
    - Line Breaks as Written(`breaks: true`のときチェック。名前は仮)
    - Language ▸ English(`en`) / 日本語(`ja`)(同上。候補の追加は方針参照)
  - 各項目を選ぶと、前面ウィンドウのデッキのfrontmatterが書き換わり、
    プレビューとサムネイルに反映される。既定値を選んだときはキーごと
    削除する(Off、16:9、breaksオフ、`en`)。
  - どの操作も1ステップでUndo/Redoできる。
  - ウィンドウを2つ開き、それぞれ別の設定のデッキを開いたとき、前面に
    したウィンドウのデッキの値がチェックに出る。
  - デッキを開いていないウィンドウが前面のとき、Deckメニューの項目は
    無効になる。
  - frontmatterに候補にない値(例: `lang: fr`、`page_numbers: both`)が
    あるとき、どの候補にもチェックが付かず、例外を出さない。候補を
    選べばその値に置き換わる。
  - ヘッダーのページ番号コントロール(`[data-page-numbers]`と
    `[data-page-numbers-unknown]`)がなくなっている。

## 背景・要調査

実際に読んで分かったこと(origin/main `da47008`、peitho-core v1.34.0):

- **メニューの状態を更新する仕組みがない**。`src-tauri/src`に
  `CheckMenuItem`も`set_checked`/`set_enabled`もない。メニューの更新は
  `app.set_menu(build_menu(...))`でアプリ全体を作り直す方法だけで、
  使っているのは最近開いたデッキとUI言語の変更時(`lib.rs:32-35`)。
- **ウィンドウのフォーカスを追跡していない**。`on_window_event`
  (`lib.rs:265-272`)は`Destroyed`だけを扱う。メニュー操作の送り先は、
  クリックされた時点で`is_focused()`を調べて決める(`emit_to_focused`、
  `edit_menu.rs:56-66`)。Undo/Redo/Settings…がこの方法を使う。
- **受け側**: `subscribeToThisWindow`(`ipc/deckIpc.ts:94-97`)が自分の
  ウィンドウ宛てのイベントだけを受ける。`Studio.tsx:1500-1518`の
  `onMenuHistory`が前例。
- **frontmatterの読み書き**: `domain/frontmatter.ts`の
  `readFrontmatterKey`/`setFrontmatterKey`がそのまま使える(値`null`で
  キー削除、コメントや空行だけが残ればブロックごと削除)。ページ番号は
  `Studio.tsx:427`でfrontmatterから読み、`PageNumbersStep`
  (`domain/editorHistory.ts`)で書く。
- **aspect_ratio**: peitho-coreの`manifest.rs:283-290`がキャンバス寸法を
  aspect_ratioから決め(16:9 = 1280×720、4:3 = 960×720)、Studioは
  `state/renderStore.ts:134-135`で毎回のレンダー結果から寸法を受け取る。
  frontmatterを書き換えて再レンダーすれば、サムネイルとプレビューは
  自動で追従する(コードリーディングの結論)。
- **breaks**: Studioの描画経路で効く(peitho-core `render.rs:97`)。
- **lang**: 検証だけ効き、**Studioの表示は変わらない**。peitho-coreは
  `lang`を`<html lang>`としてpresent/build/PDFの文書にだけ出し、
  スライド断片やmanifestには載せない。`lang`の効果が見えるのは
  `peitho present`・配布用ビルド・PDFだけ。
- **不正値**: peitho-coreがparseエラーにし、`commitChange`
  (`Studio.tsx:719-767`)は保存せずエラーバナーを出す。メニューの候補は
  すべて正しい値なので、この経路に入るのは手で書いた値だけ。
- **e2e**: `e2e/page-numbers.e2e.ts`はヘッダーのボタン
  (`[data-page-numbers=...]`)を直接クリックしている。ネイティブメニューは
  mockTauriでクリックできないが、同ファイルの`menu(page, 'undo')`のように
  メニューイベントを模擬して送れる。

要調査(実装時に確かめる):

1. Tauri v2の`CheckMenuItem`を`set_checked`で更新したとき、macOSの
   メニューバーに即座に反映されるか。反映されないなら、フォーカス変更
   時とデッキ設定の変更時に`set_menu`で作り直す方式に倒す。
2. `WindowEvent::Focused(true)`がウィンドウ切り替えのたびに確実に届くか
   (Cmd+`、Dockからの切り替え、新規ウィンドウを開いた直後)。

## 方針

**状態の置き場所**: 各ウィンドウのフロントがfrontmatterから現在値を
読み、変わるたびにRustへ報告する(`report_deck_settings(settings)`
コマンド)。Rust側は`window.label()`をキーにしたマップ(`peitho.rs`の
既存セッションと同じ流儀、CLAUDE.mdの「ウィンドウごとの状態」の項)に
保持し、「前面ウィンドウの値」をメニューに反映する。反映のきっかけは
(1) 前面ウィンドウからの報告、(2) `WindowEvent::Focused(true)`、
(3) ウィンドウの破棄。フロントがメニューを直接いじる方式は取らない —
メニューはアプリ全体で1つなので、どのウィンドウが前面かを知っている
Rust側で決める。

**メニュー操作の送り先**: `emit_to_focused`で前面ウィンドウだけに
`menu:deck-setting`(ペイロードは`{ key, value | null }`)を送る。
フロントは`subscribeToThisWindow`で受け、既存のページ番号と同じく
`performStep`経由で書き込む。

**Undo**: `PageNumbersStep`を一般化するかどうかは実装時に決めてよい。
候補は、キーと前後の値を持つ汎用の`frontmatter`ステップを足し、
`page_numbers`だけは各スライドの`page_number:false`も一緒に扱う
いまのステップを残す形。

**Languageの候補**: `en`と`ja`だけで始める。Studioの表示には効かない
ので、項目の横か下に「present/ビルド/PDFで使われる」旨が伝わる表記に
する(ネイティブメニューで説明文を出せないなら、項目名で表す)。候補の
追加や自由入力は先送り。

**既定値の扱い**: peitho-coreの既定値を選んだときはキーを削除する
(`page_numbers`の「なし」と同じ流儀)。frontmatterを最小に保つため。

**純粋ロジックの分離**: 「frontmatter → メニューに出す状態」の変換
(`DeckSettingsState`、未知値を`unknown`にするADT)は`domain/`、
「メニュー状態 → チェックの付け方」の変換はRust側の純粋関数にして、
それぞれテストする。

## レイヤー配置

- `domain/deckSettings.ts`(新規): frontmatterから各キーの現在値を
  ADTで読む純粋関数、候補一覧、「既定値ならキー削除」の判定。
  `parsePageNumbersMode`(`domain/frontmatter.ts`)は再利用。
- `domain/editorHistory.ts`: 汎用のfrontmatterステップ(方針参照)。
- `ipc/deckIpc.ts`: `reportDeckSettings`と`onMenuDeckSetting`。
- `components/Studio.tsx`: 報告のeffect、メニューイベントのハンドラ。
- `components/DeckHeader.tsx`: ページ番号コントロールの削除。
- `src-tauri/src/deck_menu.rs`(新規): Deckメニューの構築、メニューIDと
  `(key, value)`の対応、状態からチェックを決める純粋関数。
- `src-tauri/src/peitho.rs`: `report_deck_settings`コマンドと、
  ラベルをキーにした設定マップ。
- `src-tauri/src/lib.rs`: メニューへの組み込み、`Focused`イベントの配線
  だけ(ロジックは置かない)。
- `domain/messages.ts`とRustのメニューラベル: 英日の文言。

## テスト

- `domain/deckSettings.test.ts`
  - spec: 各キーの既知の値を読む、キーがないと既定値になる。
  - adversarial: 未知の値、空文字、大文字混じり(`16:9`以外の`16：9`等)、
    クォート付き、frontmatterなし、閉じ`---`なし。
- `domain/editorHistory.test.ts`: 汎用ステップのinverseが往復で元に戻る
  (spec)、キーがない状態からの追加・既定値へのキー削除(adversarial)。
- Rust `deck_menu.rs`の`#[cfg(test)]`: メニューIDと`(key, value)`の
  往復、未知の値でどれにもチェックが付かない、デッキなしで全項目無効。
- e2e: `e2e/page-numbers.e2e.ts`のヘッダー操作を、メニューイベントの
  模擬送信に書き換える。aspect_ratio/breaks/langについても、メニュー
  イベントでfrontmatterが書き換わり、Undoで戻ることを確かめる。
  メニューのチェック表示そのものはmock e2eでは検証できない(Rust側の
  単体テストと実機確認で担保する)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `cargo test` グリーン
- [x] `bun run test:e2e` グリーン(書き換え・追加分を含む)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機(`run-peitho-studio` skill)で、各項目のチェックが前面ウィンドウ
  のデッキに合わせて切り替わること(2ウィンドウで確認)
- [ ] 実機で、4:3に切り替えたときサムネイルとプレビューの比率が変わること
- [ ] メニュー名・項目名(特に`breaks`と`lang`の表記)の最終確認
- [ ] 実機で、Cmd+`・Dockからの切り替え・新規ウィンドウを開いた直後の
  それぞれでDeckメニューのチェックが前面ウィンドウに追従すること(要調査2)

## 実装メモ

- **要調査1(`set_checked`の即時反映)**: muda 0.19.3のmacOS実装を読んだ
  結論として、`set_checked`/`set_enabled`は生成済みの各`NSMenuItem`に
  `setState`/`setEnabled`を直接呼び、メニューは`setAutoenablesItems(false)`
  なので、作り直し(`set_menu`)なしで次にメニューを開いたときから反映される
  はず。実機での目視は上の人間の項目に残す。
- **muda はクリックされたCheck項目のチェックを自分で反転してから
  イベントを送る**(`fire_menu_item_click`)。そのため Deck メニューの
  クリックごとに、報告済みの値からメニュー全体を当て直す
  (`peitho::forward_deck_menu`)。チェックが動くのは、フロントが書き込んで
  報告し直したとき。
- **要調査2(`Focused(true)`の到達)**: コードからは確かめられないため、
  2つの経路を持たせた。(1) `WindowEvent::Focused(true)`で前面を切り替える、
  (2) フォーカス中のウィンドウが報告したら、それを前面とみなす(最初の
  ウィンドウや新規ウィンドウが、フォーカスイベントより先に報告しても
  拾える)。実機確認は人間の項目に残す。
- **フォーカスを失ったとき**(`Focused(false)`)も前面から外し、メニューを
  無効にする。最小化中などフォーカスのあるウィンドウがないのにメニューが
  有効に見え、クリックが黙って捨てられるのを避けるため。
- **Line Breaks as Written** は1項目のチェック。クリック時にRustは
  `choice: "toggle"`を送り、フロントが直列化されたキューの中で、その時点の
  値を反転する(`resolveDeckSettingPick`)。Rust側で最後の報告値から決めると、
  書き込みの報告前に2回クリックしたとき両方「オン」になるため。
- **イベントのペイロード**は計画の`{ key, value | null }`ではなく
  `{ key, choice }`(候補そのもの。`page_numbers`は`none`を含む)にした。
  「既定値ならキー削除」の判定をフロントの`frontmatterValueOf`1か所に
  置くため。
- **Undo**: `aspect_ratio`/`breaks`/`lang`は新しい汎用`FrontmatterStep`、
  `page_numbers`は既存の`PageNumbersStep`のまま。削除したキーをUndoで戻すと
  ブロックの末尾に入る(値は同じ。行末コメントは戻らない)。
- **既知の制約(`resolution`との組み合わせ)**: frontmatterに`resolution`が
  明示されたデッキでAspect Ratioを変えると、peitho-coreが
  「resolution ... does not match aspect_ratio ...」で拒否し、エラーバナーが
  出て保存されない(デッキは壊れない)。`resolution`はこのtodoのスコープ外
  (`todo/pdf-export.md`)なので、あわせて書き換える・項目を無効にする等の
  対応はそちらで判断する。
- **未知の値**: `breaks: True`/`yes`のようにpeitho-core(YAML)は真と読むが
  候補と完全一致しない値は、未知扱い(チェックなし)。選べば`true`に
  置き換わる。
- 報告コマンド`report_deck_settings`はメニューのチェック表示しか変えない
  ので、デッキのレイアウトスクリプトから呼ばれても影響はメニューの表示に
  限られる(`todo/deck-script-tauri-access.md`の観点)。
- mock e2eのキャンバス寸法は、frontmatterの`aspect_ratio`から決めるように
  した(peitho-coreと同じ規則)。4:3でプレビューのキャンバス幅が960に
  なることまでは自動で確かめている。

## 先送り事項

- `lang`の候補追加・自由入力と`pointer_color`(アプリ内の設定画面が
  必要。作るかどうかは別途判断)。
- frontmatterのテキストを直接編集するUI(`todo/raw-frontmatter-editor.md`)。
