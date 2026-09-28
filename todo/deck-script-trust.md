---
status: todo
description: 信頼していないデッキはスクリプト・イベントハンドラを無害化して表示し、帯で「信頼して実行」を選ばせる(Workspace Trust風、デッキのフォルダ単位)
tags: [release, security]
---

# デッキのスクリプトを実行する前の信頼確認

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `todo/deck-script-tauri-access.md`の対策((e'))で、デッキの
スクリプトが開いているデッキの外のファイルに届く経路は塞いだ。ただし
他人のデッキを開いた瞬間にスクリプトが走ることは変わらない。事故が
起きたときに「危険を告げられたうえで、ユーザーが実行を選んだ」と言える
ところまで線を引く(kfly8、2026-09-28)。VS CodeのWorkspace Trustと同じ
構造。

## スコープ

- **目的**: 信頼していないデッキでは、スクリプトもHTMLのイベント
  ハンドラも一切実行せずに表示する。ユーザーが明示的に信頼したデッキ
  (フォルダ)だけ、今まで通りスクリプトを実行する。
- **やらないこと**:
  - スライドの`<iframe>`化((d')、保留中)とCSP(別タスク)。
  - 信頼を取り消すUI(設定画面の一覧など)。先送り事項に書く。
  - `peitho present`/`peitho build`側(upstream、ブラウザの権限で
    動くので対象外)。
- **受け入れ条件**:
  - 信頼していないフォルダのデッキを開くと、レイアウトの`<script>`・
    `on*`属性・`<iframe srcdoc>`などが一切実行されない(サムネイル・
    プレビュー・レイアウトピッカー・編集中のpatchのすべてで)。
  - そのときスクリプトやイベントハンドラを含むデッキなら、画面上部に
    帯が出る。含まないデッキでは帯は出ない。
  - 帯の「信頼して実行」を押すと、そのフォルダが信頼済みとして
    Rust側に保存され、スライドが再描画されてスクリプトが動く。
    アプリを再起動しても、同じフォルダのデッキ(`deck.ja.md`などの
    variantを含む)は最初から信頼済みで開く。
  - New Deckで作ったデッキは最初から信頼済み。

## 背景・要調査

実際に読んで分かったこと(2026-09-28):

- **`<script>`を止めるだけでは足りない。** `dom/slideCanvas.ts`の
  `mountSlideCanvas`は`shadow.innerHTML = fragmentHtml`、
  `patchSlideCanvas`は`document.createElement('div')`に`innerHTML`で
  差し込む。`innerHTML`は`<script>`を実行しないが(だから
  `executeInlineScripts`がある)、`<img src=x onerror=...>`のような
  イベントハンドラ属性は差し込んだ時点で動く(`patchSlideCanvas`の
  wrapperのように未接続の要素でも、メイン文書で作った要素なので画像の
  読み込みは始まる)。`<iframe srcdoc="<script>…">`はsrcdocなので親と
  同じoriginになり、`parent.__TAURI_INTERNALS__`に届く。
- **レイアウトだけでなく`deck.md`本文の生HTMLも同じ経路**で
  fragmentに入る(推測。peitho-coreのMarkdownが生HTMLを通すかは
  実装時に確認する)。無害化はfragment全体に対して行う。
- HTMLを差し込むのは`mountSlideCanvas`/`patchSlideCanvas`の2か所だけ
  (`grep innerHTML dom components state`)。呼び出し元は
  `SlideList.tsx`(サムネイル)、`SlidePreview.tsx`(プレビュー)、
  `SlideContextMenu.tsx`(レイアウトピッカー、`preview_layouts`の
  fragment)、`Studio.tsx:612`(patch)。
- WKWebViewでSanitizer API(`Element.setHTML`)が使えるかは未確認。
  使えない前提で考える。
- 既存の似た仕組み: Recentは`peitho.rs`の`recent_decks.json`
  (`app_data_dir`)にRust側で持っている。信頼済みフォルダの一覧も
  同じ形でRust側に置けば、スクリプトから書き換えられない
  (`update_settings`には入れない)。
- (e')により、一つのウィンドウのセッションは一度しか設定されない。
  信頼状態は`open_deck`のときに決まり、「信頼して実行」で変わるだけ。

## 方針

- **無害化**: DOMPurifyを使う(自前のdenylistは抜けが出やすい)。
  inertな文書でパースしてから差し込むので、パースの時点でハンドラが
  動くことはない。設定は実装時に詰めるが、少なくとも
  `script`/`iframe`/`frame`/`object`/`embed`/`base`/`meta`、
  `on*`属性、`javascript:`URL、`srcdoc`は落とす。`<style>`・
  `data-*`属性・SVG(図のため)・`class`/`style`属性は残す(スライドの
  見た目を変えないため)。実際のfragmentで見た目が変わらないことを
  e2eで確かめる。
- **信頼の単位**: デッキのフォルダ(`deck_dir`を`canonicalize`した
  パス)。レイアウトはフォルダで共有されるので、variantもまとめて扱う。
- **状態の持ち方**:
  - Rust: `trusted_deck_dirs.json`(`app_data_dir`)。`open_deck`が
    返す`DeckSessionInfo`に`trusted: bool`を足す。
  - 新コマンド`trust_open_deck()`: 引数なし。呼び出し元ウィンドウの
    セッションの`deck_dir`を信頼済みにする。信頼していないデッキの
    スクリプトは動かないので、このコマンドを呼べるのは信頼済みデッキ
    (すでに信頼済み)かアプリ本体だけ。
  - `create_deck`は作ったフォルダを信頼済みに登録する。
- **帯の表示**: 無害化で実際に何か(`script`、`on*`属性など)を
  取り除いたときだけ出す。DOMPurifyの`removed`で判定できる。
- **「信頼して実行」を押した後**: 無害化済みで差し込まれたDOMは
  そのまま使えないので、全キャンバスをmountし直す(方法は実装時に
  決める)。
- 帯の文言は日英(`domain/messages.ts`)。例: 「このデッキのスクリプト
  は無効になっています。信頼できる作成者のデッキでなければ実行しない
  でください。[信頼して実行]」。確認のダイアログは`window.confirm()`
  を使わない(CLAUDE.mdのWKWebViewの落とし穴)。

## レイヤー配置

- `dom/slideCanvas.ts`: `mountSlideCanvas`/`patchSlideCanvas`が、信頼
  していないときは無害化したHTMLを差し込み、`executeInlineScripts`を
  呼ばない。信頼状態の渡し方は`setManifestKeysSource`と同じ形の
  モジュール変数か引数のどちらか。
- `dom/`に無害化の関数(DOMPurifyはDOMが要るので`domain/`には置かない)。
- `state/`か`components/Studio.tsx`: 信頼状態のsignal、帯の表示、
  「信頼して実行」後の再描画。
- `components/`: 帯のコンポーネント。
- `ipc/deckIpc.ts`・`ipc/fakeDeckIpc.ts`・`e2e/helpers/mockTauri.ts`:
  `trustOpenDeck`と`DeckSessionInfo.trusted`。
- `src-tauri/src/peitho.rs`: 信頼済み一覧の読み書き、`open_deck`の
  `trusted`、`trust_open_deck`、`create_deck`での登録。パスの比較などは
  `AppHandle`から切り出した純粋関数にする。
- `src-tauri/src/lib.rs`: `generate_handler!`に追加するだけ。

## テスト

- Rust:
  - 「一覧にフォルダが含まれるか」「追加(重複しない)」の純粋関数:
    spec(含まれる/含まれない)、adversarial(symlink経由の同じ
    フォルダ、末尾スラッシュ、存在しないパス、空の一覧、壊れたJSON)。
- e2e(`mockTauri`で`trusted`を切り替える):
  - 信頼していないデッキ: `<img onerror>`・`<script>`・
    `<iframe srcdoc>`を含むfragmentで、どれも実行されない(実行されたら
    `window`に印を付けるスクリプトで確かめる)。帯が出る。
  - 信頼していないが、スクリプトを含まないデッキ: 帯が出ない。
  - 帯の「信頼して実行」: `trust_open_deck`が呼ばれ、スクリプトが動く。
  - 信頼済みのデッキ: 帯が出ず、スクリプトが今まで通り動く
    (`e2e/layout-script-execution.e2e.ts`が通る。mockの`trusted`を
    true にする必要がある)。
  - 無害化しても、スクリプトのない普通のデッキの見た目が変わらない
    (既存のスライド表示のe2eが通る)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン
- [ ] `bun run test:e2e` グリーン(上の新しいe2eを含む)
- [ ] READMEの「Layout scripts」節を、信頼確認の説明に合わせて更新した

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で確認する: スクリプト入りのデッキを信頼せずに開くと帯が出て
  スクリプトが動かない。「信頼して実行」で動く。再起動後も信頼済み。
  New Deckで作ったデッキでは帯が出ない。
- [ ] 帯の文言と見た目の確認

## 先送り事項

- 信頼を取り消すUI(設定画面に信頼済みフォルダの一覧を出す)。
- スライドのCSSが`position: fixed`などでアプリの画面(帯を含む)の上に
  かぶさり、ユーザーを誘導して「信頼して実行」を押させる可能性。
  無害化はスクリプトを消すだけでCSSは残すので、帯をスライドより手前に
  出す・スライドをはみ出させない(`contain`など)の対策を別途検討する。
