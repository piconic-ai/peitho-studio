---
status: wip
description: Draft/Skipスライドをサムネイル本体を隠さずバッジで識別できるようにする
tags: [ui, slide-list, thumbnail]
---

# サムネイルの Draft / Skip バッジ化

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: Draft化したスライドは現状サムネイルごと消えて見える(非表示)。
Skipは`SlideList.tsx`でサムネイル下に "skip" というテキストラベルが出るのみ。
どちらも本体を隠す/文字だけにするのではなく、サムネイル画像そのものは見えたまま
その上にバッジを重ねる形にしたい。

## スコープ

- **目的**: draft/skip状態のスライドも、サムネイル本体を隠さずに
  「一覧の中で見分けられる」ようにする。
- **やらないこと**: draft/skip以外の新しいステータス種別の追加、
  バッジの色・アイコンをユーザーがカスタマイズする機能、draft/skipの
  一括切替UI。これらは別要望が出たら別タスクとして切り出す。
- **受け入れ条件**: draftスライドがサムネイル一覧から消えず、バッジ
  (オーバーレイ)で識別できる。skipスライドも同様にバッジで識別でき、
  既存の下部"skip"テキストラベルは残っていない。

## 背景・要調査(着手前に必ず確認する)

- `domain/render.ts`の`ManifestSlide`には`skip: boolean`はあるが`draft`
  フィールドがない。
- peitho-core側(`crates/peitho-core/src/parser.rs`)は`draft: true`の
  スライドを**ビルド対象から除外する**仕様
  (`"draft slides are excluded from the build"`、`draft`と`skip`は
  同時指定不可、`draft`のスライドは`page_number: false`も不可)。
- Studioが呼ぶ`render_draft`(`src-tauri/src/peitho.rs`)がエディタ用の
  常時プレビュー経路として、`peitho build`と同じ除外ロジックを踏んでいる
  のか、それともエディタ用途では素通しするのかを最初に読んで確認する。
  - 除外している場合: 「サムネイルが消える」という現状の報告と一致する。
    この場合、フロントエンド側で`manifest.slides`をそのまま`.map()`する
    現行の`SlideList.tsx`の作りでは、draftスライドの情報自体が届いていない
    ため「アイコンを乗せる」ことができない。Rust側にエディタ専用の
    「draftも含めてレンダリングする」オプションを追加するか、
    `editor.slideRanges()`(生テキストの`---`区切り、常に全件)を
    ソースにしたプレースホルダー描画に設計を変える必要がある — どちらを
    選ぶかは規模がかなり違うので、調査結果を踏まえてFableに相談する。
  - 除外していない場合: 単純にフロント側の型(`ManifestSlide`)に`draft`
    フィールドを足すだけで済む可能性が高い。

### 調査結果(実装時に確認済み)

- **`render_draft`はdraftスライドを除外している。** 経路は
  `render_draft`(`peitho.rs`) → `engine::pipeline::render_source` →
  `peitho_core::parse_deck_and_transform` → `parse_markdown`
  (`crates/peitho-core/src/parser.rs`、`draft`が`enabled`の
  `pending_slide`を`filter`で落とし、生き残りだけで`index`を振り直す)。
  エディタ用に素通しするオプションはpeitho-core側のAPIに存在しない。
  `manifest.slides`にも`fragments`にもdraftスライドは載らず、
  `ManifestSlide`に`draft`フィールドもない — `pipeline.rs`の
  `render_source_adversarial_a_draft_slide_never_reaches_the_manifest`で
  この挙動をテストとして固定した(peitho-coreの仕様が変わったら落ちる)。
- skipスライドは除外されず、manifestに`"skip":true`で載る
  (`render_source_spec_a_skipped_slide_stays_in_the_manifest_flagged_skip`)。
- **設計相談に含めるべき既存の不整合(コードトレースで確認、実機未確認)**:
  `SlideList.tsx`の行インデックスは`manifest.slides`上の位置だが、
  `Studio.tsx`はそれをそのまま`selectSlide(index)`/`slideConfigOf(index)`/
  `toggleSlideSkip(index)`等に渡し、`editor.slideRanges()[index]`
  (draftを含む生テキストの区切り)として解釈している。draftスライドが
  1枚でもあると、それより後ろのサムネイルをクリック/右クリックした際に
  **1つ前(draft側)のスライドが編集・トグル対象になる**。draftバッジの
  設計(Rust側でdraftも含めて返す/`slideRanges()`起点に描画する)を
  決める際は、このインデックス対応も同時に解消する必要がある。
  e2eのモック(`e2e/helpers/mockTauri.ts`)はdraftを除外しないため、
  この不整合はモックe2eでは再現しない。

## 方針

- draft/skipどちらも、`.peitho-slide`本体は縮小表示されたまま見せ続け、
  その上に半透明の暗いオーバーレイ + バッジ(例: "DRAFT" / "SKIP" の
  短いラベルまたはアイコン)を重ねる。
- `draft`と`skip`はpeitho-core仕様上同時に立たないため、バッジの出し分け
  は排他でよい(`draft`優先、`skip`次点、程度の単純な優先順位で足りる)。
- 既存のサムネイル下"skip"テキストラベル(`SlideList.tsx:165`)は
  オーバーレイバッジに統一し、削除する。

## レイヤー配置

- `domain/slides.ts`(または新設`domain/slideStatus.ts`。既存ファイルの
  責務が肥大化するようなら分ける)に純粋関数
  `slideStatusBadge(config: PageConfig): 'draft' | 'skip' | null`を追加。
- `components/SlideList.tsx`はこの結果に応じて`.peitho-slide`ホストの上に
  重ねるオーバーレイ要素を出し分けるだけ(DOM操作・スタイリングのみ、
  ロジックは持たせない)。
- Rust側の変更が必要になった場合は`src-tauri/src/engine/`
  (`(Path, &str) -> Result<T, String>`の純粋パイプライン)と
  `src-tauri/src/peitho.rs`(Tauri State層)の責務分離を崩さないこと。

## テスト

- `slideStatusBadge`のspec(draft単体/skip単体/両方false/フィールド欠如)
  + adversarial(draft・skipが両方trueという本来あり得ない入力への挙動を
  明示的に決めておく — 例外を投げるか、片方を優先するか)。

## 完了条件

自動で確認できる項目:
- [x] `slideStatusBadge`純粋関数 + spec/adversarialテスト
      (`domain/slideStatus.ts`、GWT例は`domain/slideStatus.examples.ts`)
- [x] skipバッジのオーバーレイ化と下部"skip"テキストラベルの削除
      (`SlideList.tsx`、`e2e/slide-status-badges.e2e.ts`)
- [x] `bun test` / `bun run typecheck` グリーン
- [x] (Rust変更があれば) `cargo test` グリーン(テスト追加のみ、挙動変更なし)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [x] `render_draft`のdraftスライド扱いを調査した結果、Rust側の変更が
      要ると分かった場合、その設計をFableに相談してから着手する
      — **該当した**(上記「調査結果」)。kfly8確認: 「Draftにしたスライドが
      非表示のままでは要件未達」との指摘を受け、Rust側(peitho-core)を
      変更せず、フロントエンド側で`manifest.slides`ではなく
      `editor.slideRanges()`(常に全件、draft含む)を起点にサムネイル一覧を
      再構築する方式で解決した。
      - `domain/slideList.ts`(新設): `buildSlideList(fullSource,
        manifestSlides)`が両者を突き合わせ、各行を`{kind:'rendered',
        sourceIndex, manifestIndex, slide}`(peitho-coreがレンダリング済み)
        または`{kind:'placeholder', sourceIndex, title, draft, key}`
        (draft、または再レンダリング未反映の一時的な状態)に分類する。
        `manifestIndexAt`/`manifestIndexToSourceIndex`/
        `recordByManifestIndex`/`sectionStartBySourceIndex`で、
        `state/renderStore.ts`側(manifestのインデックス基準のまま)と
        `SlideList.tsx`/`Studio.tsx`の他の全操作(sourceIndex基準)との
        変換を行う。
      - `SlideList.tsx`は`manifest.slides`ではなく`entries`
        (`buildSlideList`の結果)を`.map()`する。`kind:'placeholder'`の行は
        canvasをマウントせず、生Markdownから抽出したタイトルをそのまま
        表示するプレースホルダーにし、`draft`ならDRAFTバッジを重ねる。
      - これにより、draft有無でサムネイル行番号と`slideRanges()`の
        インデックスがずれる既存の不整合(クリック/右クリック/Skip切替が
        1つ前のスライドに効いてしまう問題)も同時に解消した — 両者が
        同じ`sourceIndex`空間に統一されたため。
      - e2eモック(`e2e/helpers/mockTauri.ts`)もdraftスライドを
        manifestから除外するよう修正(実peitho-coreの挙動に合わせた)。
        修正前のモックはdraftを除外しなかったため、上記のずれが
        モックe2eで再現できなかった — `e2e/slide-status-badges.e2e.ts`に
        draft関連の新規テスト4件を追加し、この修正で初めて再現・検証
        できることを確認した。
- [ ] 実機(`run-peitho-studio` skill)でdraft/skip双方の見た目を確認
      (skipバッジの半透明オーバーレイ`bg-black/40`は`color-mix()`で
      出力されるため、WKWebViewでの見え方も併せて確認する)。draftの
      プレースホルダー(`bg-muted`のタイトルのみ表示)の見た目も
      合わせて確認する。 — kfly8が実機で確認し、2件の不具合を報告
      (2026-09-15)。原因調査・修正は以下のとおり。**この修正自体は
      Playwright(モックe2e)でのみ検証済みで、実機での再確認がまだ
      残っている**(未チェックのまま):
      - **問題1: Draft化した直後、後ろのスライドのサムネイルが真っ黒に
        なる。** 原因: `commitChange`が新しいmanifestを`applyRenderPayload`
        で反映した直後、`await deckIpc.saveDeckSource(...)`を挟んでから
        `editor.setFullSource(...)`を呼んでいたため、その間`slideEntries`
        (`buildSlideList`)が「新manifest + 旧source」という一致しない
        組み合わせで再計算されることがあった。同じタイトルのスライドが
        複数あるデッキでこれが起きると、後ろのスライドの行が誤った
        manifestエントリと対応付けられ、BarefootJSの keyed `.map()` に
        重複キーを渡してしまい(`[BarefootJS] mapArray: duplicate key`
        警告)、該当スライドのcanvasが恒久的に空になっていた(デッキを
        開き直すまで直らない)。
        - 修正: `state/renderStore.ts`に`renderedSource`
          (manifestを実際に生成したsource文字列を`applyRenderPayload`が
          同じバッチで書き込む)を追加し、`Studio.tsx`の`slideEntries`は
          `editor.fullSource()`ではなくこちらを参照するよう変更。
          `applyRenderPayload`の呼び出し元3箇所(`refreshSource`
          経由の`open_deck`、`renderPreview`、`commitChange`)すべてで
          対応するsourceを明示的に渡すようにした。
      - **問題2: Draft解除すると、そのスライド自身のサムネイルが
        真っ黒になる。** 原因はBarefootJSコンパイラ側の不具合
        ([piconic-ai/barefootjs#3009](https://github.com/piconic-ai/barefootjs/issues/3009)、
        最小再現・原因調査つきで報告済み): keyed `.map()`の1行が
        `rendered`↔`placeholder`という2つの分岐を持つとき、行の
        `key`が同じまま`rendered→placeholder→rendered`と一周すると、
        3回目に`rendered`側へ戻ったときの`ref`が実行されない
        (`mountSlideCanvas`が一度も走らずcanvasが空のまま)。
        draftのPageCommentは`addSlide`が付与した明示的な`key`を
        そのまま保持するため、draft化・解除を1回繰り返すだけで
        必ず`key`が一致していた。
        - 修正: `domain/slideList.ts`のplaceholder行の`key`を、
          スライド自身の`config.key`から独立させ、常に
          `` `placeholder:${sourceIndex}` `` にした。これにより
          `rendered`↔`placeholder`の切り替えは常に「新しいkey」として
          扱われ、BarefootJS側は毎回まっさらな新規マウントを行う
          (既存の、正しく動いているパスと同じ経路になる)。
      - どちらも`e2e/slide-status-badges.e2e.ts`に、修正前は実際に
        失敗する(修正を一時的に戻して確認済み)回帰テストを追加した。

## 先送り事項

- kfly8指摘: SKIPバッジが赤すぎて目立ちすぎる(`bg-destructive
  text-destructive-foreground`)。DRAFTバッジと同じ地味な配色
  (`bg-muted text-foreground`)に統一した — 両バッジとも見た目は同じに
  なり、ラベル文字列(DRAFT/SKIP)だけで区別する。将来的にバッジごとに
  異なる色を付けたくなった場合は、このプロジェクトの中立的なデザイン
  トークン(destructive/secondary/accentのみで、warning系の色相がない)に
  1色追加するかどうかから検討し直す必要がある。
