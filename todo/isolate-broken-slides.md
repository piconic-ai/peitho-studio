---
status: wip
description: ビルドが失敗するスライドだけをメモリ上でdraft扱いにして残りを描画し、壊れたスライドはERRORバッジ付きのプレースホルダーとして一覧に出す
tags: [editor, error-handling, slide-list]
---

# 壊れたスライドだけ除いて残りを描画する

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: `todo/open-broken-deck.md`(前提。先にそちらを終える)だけだと、
30枚のデッキで1枚にタイポがあるだけで全サムネイルが消え、どこが壊れたか
一覧から分からない。壊れたスライドを除いて残りを描画し、壊れたものを
一覧で目立たせたい。

## スコープ

- **目的**: ディスク上のデッキ(または外部変更)の描画が、スライド番号付きの
  ビルドエラーで失敗したとき、そのスライドをメモリ上で`draft: true`にして
  描画し直し(上限回数まで繰り返す)、残りのスライドを普通に見せる。壊れた
  スライドは一覧でプレースホルダー+ERRORバッジになり、選ぶとプレビュー欄に
  そのスライドのエラーが出る。
- **やらないこと**:
  - `draft`印を**ディスクに書く**こと。隔離は描画用の一時的な置き換えで、
    保存されるソースはユーザーが書いたまま。
  - スライドに紐づかないエラー(frontmatter、include、「全スライドが
    draft」、レイアウトファイル)。これらは`todo/open-broken-deck.md`の
    「描画なしで開く」状態のまま。
  - タイプ中のドラフト(`renderPreview`経由の失敗)で**新たに**スライドを
    隔離すること。ドラフトは前回の描画が隔離したスライドを除いた形で1回
    だけ描画し(`startIsolation`の`known`)、それでも失敗すれば今まで通り
    最後に成功した描画を残してエラーバーだけ出す。隔離の判断は保存
    (`commitChange`)の側でだけ行う。
  - エラーの自動修正、エージェントへの通知
    (`todo/auto-report-build-error.md`)。
- **受け入れ条件**:
  - 1枚だけ壊れたデッキを開くと、他の全スライドのサムネイルが出て、壊れた
    1枚はプレースホルダー+ERRORバッジ。選ぶとプレビュー欄にheadlineとhelp。
  - 複数枚(上限内)壊れていても同様。上限(方針参照)を超えたら隔離を諦め、
    `todo/open-broken-deck.md`の描画なし状態になる(無限ループしない)。
  - 壊れたスライドを直して保存すると、バッジが消えて描画される。
  - **壊れたスライドが残ったまま、別のスライドを編集して保存できる**
    (下記「人間の判断」で確認済みの前提で)。保存後もバッジとエラーバーは
    残る。
  - 隔離に使った`draft`印がディスクに書かれていないことがテストで保証
    されている。
  - 実エンジンe2e(`real-engine-*`)で、スロット個数違反1枚+正常2枚の
    デッキが上記の通りに見える。

## 背景・要調査

実際に読んで分かったこと:

- **peitho-coreは最初のエラーで止まる**: `dispatch_by_convention`/`check_deck`
  (peitho v1.34.0 `mapping.rs`/`check.rs`)はスライドを順に処理して最初の
  `Err`を`?`で返す。parse段も同様。一度の描画で分かる壊れたスライドは
  1枚だけ → 複数枚は「除いて描画し直す」を繰り返して見つけるしかない。
- **`slide.number`はソース上の位置(1始まり、draft含む)**: `source_index + 1`。
  `domain/imageSlot.ts`が同じ前提で`splitSlides`の位置に対応づけている。
- **draftは本家の仕組み**: PageComment`<!-- {"draft":true} -->`のスライドは
  manifestに載らない。`domain/slideList.ts`の`buildSlideList`は
  「非draftのソーススライドをmanifestの次の未使用エントリと順に対応づける」
  ので、**隔離したスライドをdraft扱いだと伝えないと、次のスライドの
  manifestエントリを奪って対応がずれる**(ソースはdraftになっていない
  ので)。`buildSlideList`に除外インデックス集合を渡す形にする。
- **PageComment操作は純粋関数で揃っている**: `extractPageComment`/
  `buildSlideText`/`replaceSlideText`(`domain/slides.ts`など)。隔離用の
  ソースを組み立てるのに描画側の新機能は不要。
- **全スライドがdraftだとエラー**: parser.rsの「every slide in the deck is
  marked draft」。全部壊れていたら隔離をやめる条件に入れる。
- **バッジの作り**: `domain/slideStatus.ts`の`SlideStatusBadge = 'draft' |
  'skip'`、`SlideList.tsx`の`badgeOf`相当(行85〜91)。プレースホルダーは
  `entry.draft`のときだけDRAFTを着る。ERRORはここに3値目として足す。
- **保存のブロック**: `commitChange`(Studio.tsx)は`render_draft(nextSource)`
  が通らないと保存しない。壊れたスライドが残っている間はどのスライドの
  保存も落ちる — 隔離を見せる以上、ここを変えないと「直ったように見えて
  何も保存できない」になる。
- **`todo/archive/layout-picker-mismatch-error.md`**に、レイアウト不一致
  エラーの扱いの経緯がある(実装前に読んだ: レイアウトピッカーは選択前に
  `check_slide_layouts`で候補を事前検証する方式(B)。隔離の見せ方とは
  独立で矛盾しない。ただし下記「先送り事項」の通り、壊れたスライドが
  残っている間はこの事前検証が全体ビルドに巻き込まれて失敗しうる)。
- 実装時に分かったこと(peitho v1.34.0 `parser.rs`): draftの除外は
  `parse_slide`(各スライドのパース)と`validate_unique_keys`の**後**。
  つまりパース段のエラー(重複キー、壊れた脚注、不正なPageComment)は
  draft印を付けても同じスライドで再発する → `isolateSlide`は「同じ番号の
  再発=進展なし」で諦め、`todo/open-broken-deck.md`の描画なし状態になる。
  隔離が効くのはmapping/check段(スロット個数違反、レイアウト不一致)。
  また draft は `skip`/`page_number:false`/`section` と同居できない
  (それぞれparse_page_commentが拒む)ので、隔離用のdraft印はそれらを外し、
  外したsectionの時間ぶんだけfrontmatterの`time:`を描画用ソース内で
  再同期する(`withSlidesDrafted`)。
- 描画結果のedit annotation(`data-peitho-src`のバイト範囲)は**描画に
  渡したソース(attempt)**の座標で、読む側(`textEditFor`、
  `annotatedSpan`)は`renderedSource`=書かれたままのソースを持つ。
  draft印の挿入ぶんだけ後ろのスライドの範囲がずれてキャンバス編集が
  効かなくなる(Pullfrogのレビュー指摘)ので、`withSlidesDrafted`が
  施した編集(`SourceEdit`、UTF-8バイト)を`Isolation.edits`に持ち、
  `restoreEditAnnotations`で元ソース座標へ戻してから
  `applyRenderPayload`する。同じく`slideSpans`(レビューコメントの
  スライド対応)にも`brokenSlides`を渡す。
- `open_deck`は1回しか描画しないので、隔離はフロントの
  `renderPreview(source, { persisted: true })`が回す。同じソースへの
  persisted描画は同時に3箇所(`runOpen`、選択が落ち着くまでのタイピング
  effect)から要求されるので、in-flightの共有と「ビルドできないと分かった
  ソースは変わるまで再描画しない」(`persistedFailedSource`)で、壊れた
  スライド1枚の open が`render_draft` 2回に収まるようにした(e2eの
  non-functionalテストで固定)。共有するのは「まだ最新の描画要求である」
  間だけ: ドラフトの描画に追い越されたin-flightは世代違いで捨てられる
  ので、保存済みテキストに戻したときは描画し直す(レビュー指摘)。
- レイアウトファイルの変更後の再描画(`renderAfterLayoutChange`)は、
  タイプ中でなければpersisted扱い(隔離をやり直すので、レイアウトの修正で
  直ったスライドのバッジは消える)、タイプ中なら既知の壊れたスライドを
  除いたドラフト描画。古いレイアウトで読んだin-flightの描画は世代を進めて
  捨てる。
- デッキ全体のソースエディタの保存(`commitSource`)は、エラーの指す
  スライドが既知の壊れたスライドと**本文が一字一句同じ**ときだけ隔離する
  (`sourceSaveDecision`)。全文編集では位置が自由に動くので位置やキーでは
  判断しない。

## 方針

1. `domain/brokenSlides.ts`(新規、純粋): 
   - `isolateStep(source, error, excluded)`: `error.slide.number - 1`が
     範囲内で未除外なら、そのスライドの`draft`を`true`にしたソースと
     新しい除外集合を返す。範囲外・`slide`なし・既に除外済み(同じ番号が
     続く=進展なし)・除外後に非draftが0枚になる、のどれかなら`null`
     (隔離をやめる)。
   - `MAX_ISOLATIONS = 5`(上限。超えたら描画なし状態)。
   - `BrokenSlides = ReadonlyMap<sourceIndex, RenderErrorPayload>`。
2. 描画の駆動(Studio.tsx、副作用あり): `renderDiskSource(source)`が
   `render_draft`→`RenderFailure`→`isolateStep`→`render_draft`…を回し、
   成功したら`applyRenderPayload(payload, source)`(**ソースは元のまま**を
   渡す。manifestは隔離後の描画結果)+`render.setBrokenSlides(map)`。
   `open_deck`の`failed`と`handleExternalChange`の両方から呼ぶ。
   `renderPreview`(タイプ中)は変えない。
3. `buildSlideList(source, manifestSlides, excluded)`: `excluded`に入る
   ソース位置は非draftでもmanifestを奪わず、`kind: 'placeholder'`に
   `error: RenderErrorPayload | null`を持たせる(または`kind: 'broken'`
   を足す — `SlideList.tsx`の`.map()`キーが`placeholder:<sourceIndex>`
   の名前空間を保つなら前者で十分。CLAUDE.mdの#3009の教訓:
   rendered↔placeholderでキーを共有しない)。
4. `commitChange`: `render_draft(nextSource)`が壊れたスライド(既知の
   `brokenSlides`のどれか、またはそれと同じ番号)で失敗したときは、
   隔離して描画→**保存は`nextSource`のまま**行う。失敗が既知でないスライド
   (今編集したスライドを壊した)なら今まで通りブロック。この判断は
   `domain/brokenSlides.ts`の`saveDecision(error, brokenSlides,
   editedIndex)`に出す。
5. バッジ: `SlideStatusBadge`に`'error'`を足し、`SlideList.tsx`で
   destructive系の色。`SlidePreview.tsx`は選択中スライドが`brokenSlides`に
   あればそのエラーを表示(`todo/open-broken-deck.md`で作る表示を流用)。
   エラーバーは「N枚のスライドがビルドできません」+最初のheadline。

## レイヤー配置

- `domain/brokenSlides.ts`(新規): `isolateStep`、`saveDecision`、
  `brokenSlidesSummary`(エラーバー文言の材料)。
- `domain/slideList.ts`: `buildSlideList`に`excluded`引数(省略時は空)。
- `domain/slideStatus.ts`: `'error'`バッジ。
- `state/renderStore.ts`: `brokenSlides`シグナル(**Map全体を1つの
  シグナルに持つのはCLAUDE.mdで避けろとある** — 行ごとの再描画を誘発する
  ので、行が読むのは`isBroken(sourceIndex)`のような個別取得にし、
  `fragmentSignal`パターンに倣うか、`SlideListEntry`に焼き込んで
  `slideEntries`メモ経由でだけ読む)。
- `components/Studio.tsx`: `renderDiskSource`の駆動と`commitChange`の分岐。
- Rust: 変更なしの見込み(`todo/open-broken-deck.md`の構造化エラーで足りる)。

## テスト

- `domain/brokenSlides.test.ts`: `isolateStep`のspec(1枚目/最後/中間、
  既にdraft印のあるスライドの前後関係が崩れない)とadversarial(`slide:
  null`、番号0、番号が枚数超、同じ番号の再発=進展なし、全部除外、空の
  ソース、PageCommentがないスライド)。`saveDecision`(既知の番号/未知の
  番号/編集中スライド自身が壊れた)。
- `domain/slideList.test.ts`: `excluded`ありで対応がずれない(除外の前後の
  スライドが正しいmanifestエントリを得る)、除外と本物のdraftが混在、
  除外が範囲外。
- `domain/slideStatus.test.ts`: `'error'`。
- e2e(モック): `commandError`を「スライド2が壊れている間だけ失敗」に
  仕立て、一覧のバッジ、別スライドの保存が通る、スライド2を直すと消える。
- e2e(`real-engine-*`): 本物のスロット個数違反で同じこと。保存後の
  ファイル内容に`"draft":true`が増えていない(モックの保存内容を読む)。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `bun run test:e2e` グリーン(新規specを含む)
- [x] `real-engine-*` specグリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] **設計判断**: 壊れたスライドが残ったまま別スライドの保存を通す
  (=Studioがビルドできないデッキを書く最初のケース)でよいか。代案は
  「壊れたスライドを直すまで一切保存できない」(今の挙動)。本ファイルは
  通す前提で書いてある。
- [ ] 実機での見た目確認: ERRORバッジの色・プレビュー欄の文言

## 先送り事項

- 隔離の上限5を設定にするか(たぶん不要)。
- 隔離中のスライドをプレビューに「最後に成功したときの描画」で出す案
  (サムネイルは`lastRenderedKey`の仕組みで最後の描画が残る。プレビュー欄
  は選択中の壊れたスライドのエラーを出す実装にした — 描画は出さない)。
- ~~**タイプ中のドラフトの隔離**~~(対応済み): ドラフトは既知の
  `brokenSlides`を除いた形で1回描画する(`draftSeed`→`startIsolation`の
  `known`)。編集中のスライド自身は除かないので、直った瞬間にプレビューに
  出てバッジも消える。タイプで`---`を打って分割がずれても
  `brokenSlidesAfterEdit`で既知の位置を追従する。
- 壊れたスライドが残っている間、`checkSlideLayouts`/`addImageLayout`/
  `createLayout`などデッキ全体のソースをエンジンに渡す操作は、
  `editor.fullSource()`(壊れたまま)を渡すので失敗しうる(エラーバーに
  出るだけで壊れはしない)。描画に使った`Isolation.attempt`相当を渡す
  形にすれば通る。レイアウト変更**後の再描画**は対応済み
  (`renderAfterLayoutChange`、背景の項を参照)。
- `commitChange`の既知判定は位置(`brokenSlidesAfterCommand`で構造変更を、
  `brokenSlidesAfterEdit`でタイプによる再分割を追従)とpeitho-coreが報告
  するキー(導出キー含む)で行う。構造変更(`cmd`あり)に開いている
  スライドのタイプが同乗し、そのタイプが再分割も起こす、という重なりでは
  未知扱い→保存ブロックになる(安全側)。
- `todo/open-broken-deck.md`の「先送り事項」にある`existingSlideKeys()`
  (manifestから鍵を集める)は、隔離中のスライドの鍵がmanifestに無いため
  New Slideが既存の鍵と衝突する鍵を選びうる点で本件にも当てはまる
  (衝突すれば重複キーのparseエラーで保存がブロックされ、実害はない)。
