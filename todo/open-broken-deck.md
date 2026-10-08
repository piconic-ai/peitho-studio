---
status: todo
description: peitho-coreがビルドを拒むデッキ(構文違反)でも、ソースだけでエディタを開けるようにし、エラーの行と内容を見ながら直して保存できるようにする
tags: [engine, rust-command, editor, error-handling]
---

# ビルドできないデッキを開けるようにする

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: Markdownがpeithoの構文に違反していると、Studioはそのデッキを
開けない(Welcome画面にエラーが出るだけで、直す手段がStudioの中にない)。
「開けるようにしたい」。3本組の1本目 — 壊れたスライドだけ除いて残りを
描画するのは`todo/isolate-broken-slides.md`、エラーをエージェントに自動で
伝えるのは`todo/auto-report-build-error.md`。どちらも本ファイルが前提
(構造化したビルドエラーと、描画なしで開いた状態)。

## スコープ

- **目的**: `open_deck`の描画が失敗しても、デッキのセッションは作り、
  エディタをソースだけで開く。エラーバーにpeitho-coreのエラー(行・スライド
  番号・message・help)を出し続け、ユーザーがその場で直して保存すると普通の
  描画に戻る。
- **やらないこと**:
  - 壊れたスライド以外を描画すること(`todo/isolate-broken-slides.md`)。
  - エージェントへの自動コメント(`todo/auto-report-build-error.md`)。
  - 構文エラーの自動修正・候補提示(`domain/imageSlot.ts`のような個別の
    「直し方」ボタンは既存のまま。新しい個別対応はここでは増やさない)。
  - 描画が失敗する以外の`open_deck`失敗(ファイルがない、既に開いている、
    更新が必要)。これらは今まで通りWelcome画面で失敗する。
  - `peitho present`/`peitho build`が壊れたデッキでどうなるか。
  - 「ビルドできない状態でも保存できる」かどうかの設計変更。本ファイルの
    範囲では今まで通り、保存はビルドが通ったときだけ(下記「背景」参照)。
    別スライドが壊れたまま別のスライドを保存したい、は
    `todo/isolate-broken-slides.md`で扱う。
- **受け入れ条件**:
  - ビルドが失敗するデッキ(例: frontmatterに未知のキー、スロットの個数
    違反、重複したスライドキー、`layouts/`のHTMLが壊れている)を開くと、
    Welcome画面ではなくエディタになり、ヘッダーにデッキのパスが出る。
  - スライド一覧にソースの各スライドがプレースホルダーとして並び、
    クリックして本文・ノートを編集できる。
  - エラーバーにエラーの先頭行(peitho-coreの`headline()`相当: 行番号・
    スライド番号・キー)とhelpが出て、直るまで消えない(今の6秒で消える
    タイマーの対象にしない)。プレビュー欄にも同じ内容が出て、空白のまま
    にならない。
  - 壊れたスライドを直して保存すると、描画が通ってサムネイルとプレビューが
    出て、エラーバーが消える。
  - 直したつもりで別の箇所がまだ壊れていれば、保存はブロックされ(現状と
    同じ)、エラーバーが新しいエラーに置き換わる。
  - エラーがスライドに紐づくとき(`slide`あり)、そのスライドが一覧で
    選択済みになって開く。
  - Recent Decksに記録される(`remember_recent_deck`が今まで通り走る)。
  - モックe2e(`commandError`で`open_deck`を失敗させる、または
    `realEngine`で本物のエラー)で上記が通る。

## 背景・要調査

実際に読んで分かったこと:

- **失敗の場所**: `src-tauri/src/peitho.rs`の`open_deck`(`#[tauri::command
  (async)]`)は、セッションを作る前に`pipeline::render_source`を呼び、
  `?`で失敗を返す。失敗するとセッションも`AssetServer`もファイル監視も
  作られない。フロントは`components/Studio.tsx`の`runOpen`で`catch`し、
  `setErrorMessage`+`dispatch({type:'failed'})`で`domain/deckLifecycle.ts`
  の`opening`→`welcome`に戻る。`WelcomeScreen.tsx`がエラー文字列を出す。
- **Studio自身は壊れたデッキを書かない**: `commitChange`(Studio.tsx)は
  `render_draft`が通ってから`save_deck_source`する。つまり壊れたデッキは
  外から来る: エージェントの編集、他のエディタ、peithoを上げたら古い記法が
  拒まれるようになった(未知のfrontmatterキーなど)、`include`先のファイル。
- **開いた後は既に耐えている**: `renderPreview`(Studio.tsx)は失敗しても
  最後に成功した描画を残し、エラーバーだけ出す。外部変更
  (`handleExternalChange`)もこの経路。穴は「開くとき」だけ。
- **peitho-coreのエラーは構造化されている**: `BuildError { kind: ErrorKind
  (Parse/Layout/Asset/Accepts/Arity/ResidualContent/Theme/Manifest),
  line: Option<usize>, origin_file: Option<PathBuf>, message, help,
  slide: Option<ErrorSlide { number, key }> }`(peitho v1.34.0
  `crates/peitho-core/src/error.rs`)。`headline()`がhelp抜きの1行目、
  `Display`は`headline + "\n  = help: " + help`。`slide.number`は
  `source_index + 1`で、draftを含むソース上の位置(`check.rs`/`mapping.rs`、
  `domain/imageSlot.ts`の注記とも一致)。parse段のエラーもほとんどは
  `attach_slide_context`/`validate_unique_keys`でスライド番号が付くが、
  frontmatter・include・「全スライドがdraft」はスライドなし。
- **Studioの`engine/pipeline.rs`は構造を捨てている**: `parse_source`/
  `render_parsed_with_images`の各段が`.map_err(|err| err.to_string())`で
  `String`にしている。`assets::resolve`(レイアウトHTML/CSSの読み込み)は
  もともと`String`エラー。フロントは文字列を正規表現で読み戻している
  (`domain/imageSlot.ts`の`SLIDE_NUMBER`、Studio.tsxの
  `errorMessage()?.includes("missing 'body' slot")`)。
- **描画なしでスライド一覧が成立するか**: `slideEntries`(Studio.tsx:884)は
  `buildSlideList(render.renderedSource(), manifest?.slides ?? [])`で、
  `renderedSource()`は描画が一度も成功していないと`''` — そのままだと一覧が
  空になる。`buildSlideList`は`manifestSlides`が尽きたスライドを非draftの
  プレースホルダー(`placeholder:<sourceIndex>`)にする仕様で、「短命だが
  実在する状態」と注記されている。エディタ本体は`editor.slideRanges()`
  (`splitSlides(source)`)で動くので描画に依存しない。`SlidePreview.tsx`は
  選択キーに対応するfragmentがなければ空白。
- **`render.manifest()`の利用箇所**はStudio.tsxに8箇所+`renderStore`の
  メモ群。描画なしの状態で各操作(新規スライド、並べ替え、レイアウト
  ピッカー、画像ドロップ、セクション編集)がどう振る舞うかは未確認 —
  **実装時に全部触って、壊れるものは「描画が通るまで無効」にする**(例外を
  投げたり空の操作をしたりしないこと)。
- **e2eの足場**: `e2e/helpers/mockTauri.ts`の`commandError(cmd, args)`で
  `open_deck`/`render_draft`を任意のメッセージで失敗させられる。
  `realEngine`(`e2e/helpers/realEngine.ts`、`cargo build --example
  e2e_engine`)は`open_deck`の描画と`render_draft`を本物のpeitho-coreで
  答える — 構造化エラーを返すなら`peitho.rs`の`invoke_for_e2e`とこの
  helperも合わせる。
- 推測(未確認): `DeckSessionInfo.render`を`Option`/タグ付きにしたとき、
  `fakeDeckIpc.ts`(`ipc/`)とその`.test.ts`にも同じ形を足す必要がある。

## 方針

1. **engineで構造化エラーを作る**(Rust、純粋関数側)。`engine/pipeline.rs`
   に`RenderError = Build(BuildErrorPayload) | Other(String)`を置き、
   `render_source`/`parse_source`/`render_parsed*`は`Result<_, RenderError>`
   を返す。`BuildErrorPayload`(`Serialize`, camelCase)は`kind`(文字列)、
   `line`、`originFile`、`message`、`help`、`headline`、`slide: Option<{number,
   key}>`。`assets::resolve`やIOの`String`は`Other`。`BuildError`からの変換
   は`From`一つで、`headline()`はpeitho-coreのをそのまま使う。
   `layout_fit.rs`など他の呼び出し元は`.to_string()`相当の`Display`で
   今まで通り文字列にできるようにしておく(呼び出し元の変更を最小に)。
2. **`open_deck`は描画失敗でも開く**。`DeckSessionInfo.render`を
   `RenderOutcome = { kind: "rendered", ...RenderPayload } | { kind:
   "failed", error: RenderErrorPayload }`にする(`#[serde(tag = "kind")]`)。
   `failed`でも`AssetServer`・ファイル監視・`insert_first_session`・
   `remember_recent_deck`は同じに行う(`asset_server.update`だけ飛ばす)。
   `render_draft`も`Result<RenderOutcome, String>`にし、`Err`は
   「デッキが開いていない」「ロック」だけに絞る。
   - 迷ったら: `render_draft`の戻り型変更は呼び出し元が多い(`commitChange`、
     `renderPreview`、`layoutDraftPreview`系、モック2種)。IPC層
     (`ipc/deckIpc.ts`)で`failed`を`RenderFailure extends Error`
     (`.error`に構造を持ち、`message`は`headline + "\n  = help: " + help`)
     として投げ直せば、`String(err)`している既存の`catch`は無変更で済む。
     **この形を推す**: 構造が要る場所(本件のプレビュー欄・後続2件)だけ
     `err instanceof RenderFailure`で取り出す。
3. **フロントの状態**: `state/renderStore.ts`に`outcome(): {kind:'none'} |
   {kind:'rendered'} | {kind:'failed'; error: RenderErrorPayload}`を足す
   (描画成功で`rendered`、`open_deck`の`failed`と、**ディスク上のソースの**
   描画失敗で`failed`。タイプ中のドラフト失敗は今まで通り`errorMessage`
   だけで、`outcome`は触らない — ディスクの状態と手元の状態を混ぜない)。
   `slideEntries`は`manifest() === null`のとき`editor.fullSource()`から
   作る(全部プレースホルダー)。`runOpen`は`failed`でも`opened`を
   dispatchし、`refreshSource(false)`(payloadなし)の後に`outcome`を
   `failed`にし、`error.slide.number - 1`が範囲内ならそのスライドを選択。
4. **見せ方**: エラーバーは`outcome().kind === 'failed'`の間は自動で消さない
   (Studio.tsx:1205のタイマー条件に加える)。`SlidePreview.tsx`は
   `outcome`が`failed`なら、空白の代わりにheadlineとhelpを等幅で出す
   (常時マウント+`hidden`切り替え — CLAUDE.mdのBarefootJS分岐の落とし穴
   を踏まないこと)。文言は`domain/messages.ts`にen/ja両方。
5. **直して保存**: `commitChange`は変更なし(ビルドが通れば保存し、
   `applyRenderPayload`で`outcome`が`rendered`に戻る。通らなければ今まで
   通りブロックしてエラーバーを差し替える)。外部変更で直った場合も
   `handleExternalChange`→`renderPreview`成功で戻る。

## レイヤー配置

- Rust `engine/pipeline.rs`: `RenderError`/`BuildErrorPayload`と変換。
  `Tauri`の型は参照しない。
- Rust `peitho.rs`: `RenderOutcome`(Serialize)、`open_deck`/`render_draft`
  の分岐。`open_deck`から「描画結果→セッション作成」の判断を
  `fn open_outcome(result: Result<RenderOutput, RenderError>) -> (Option<
  RenderOutput>, RenderOutcome)`のような状態非依存の関数に出してテスト。
- `domain/render.ts`: `RenderErrorPayload`/`RenderOutcome`型、
  `renderFailureMessage(error)`(エラーバー用の文字列)、
  `brokenSlideIndex(error, slideCount)`(選択するスライド、範囲外は`null`)。
- `domain/slideList.ts`: `buildSlideList`の呼び方を変えるだけ(関数自体は
  変えない見込み)。
- `ipc/deckIpc.ts`: `RenderFailure`、`failed`→throwの変換。`fakeDeckIpc.ts`
  も同じ契約に。
- `state/renderStore.ts`: `outcome`シグナル。
- `components/Studio.tsx`/`SlidePreview.tsx`/`StatusBar.tsx`: 配線のみ。

## テスト

- Rust `engine/pipeline.rs`: `render_source`が (a) 未知のfrontmatterキー →
  `Build`で`slide: None`、`line: Some`; (b) 重複キー → `slide: Some`;
  (c) スロット個数違反 → `kind: "Arity"`、`slide`と`line`あり; (d)
  `layouts/`のHTMLが壊れている → `Other`; (e) 空文字列のソース; (f)
  `---`だけのソース。`headline`がpeitho-coreの`Display`の1行目と一致する
  こと。
- Rust `peitho.rs`: `open_outcome`のspec(成功/`Build`/`Other`)。
- `domain/render.test.ts`: `renderFailureMessage`(helpが空、lineなし、
  originFileあり)、`brokenSlideIndex`(0、範囲外、`slide: null`、
  slideCount 0)。
- `ipc/fakeDeckIpc.test.ts`: `failed`を`RenderFailure`として投げ、`message`
  の形が決めた通り。
- e2e(モック): `commandError`で`open_deck`を失敗させ、エディタが開く・
  一覧にプレースホルダー・エラーバーが6秒後も残る・編集して保存(次は
  成功させる)でサムネイルが出る。
- e2e(`real-engine-*`): スロット個数違反のデッキで開き、エラーバーの
  行番号が本物と一致、該当スライドが選択されている、直して保存で描画。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン(`src-tauri/`)
- [ ] `bun run test:e2e` グリーン(新規specを含む)
- [ ] `cargo build --example e2e_engine`後の`real-engine-*`specがグリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機での見た目/挙動確認(ユーザー自身に依頼する — 自動化していた
  `run-peitho-studio` skillは削除済み、`CLAUDE.md`のe2e節参照): 壊れた
  デッキを開いたときのプレビュー欄の文言と、描画なし状態で無効にした操作
  の選び方
- [ ] `render_draft`の戻り型を変えるか、IPC層で`RenderFailure`に変換するかの
  最終確認(方針2の「迷ったら」を推す)

## 先送り事項

- `domain/imageSlot.ts`の`SLIDE_NUMBER`正規表現と、Studio.tsx:638の
  `missing 'body' slot`文字列一致を、構造化した`error.slide`/`error.kind`
  に置き換える(本件のついでに直さない。別todoにする価値あり)。
- `peitho build`相当の「警告」(エラーではないが怪しい)をStudioで出す話は
  peitho-core側にその概念があるか未確認。
