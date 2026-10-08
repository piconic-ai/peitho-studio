---
status: todo
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
  - タイプ中のドラフト(`renderPreview`経由の失敗)での隔離。今まで通り、
    最後に成功した描画を残してエラーバーだけ出す。
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
  エラーの扱いの経緯がある(未読。隔離した結果の見せ方と矛盾しないか
  実装前に一読する)。

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
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `bun run test:e2e` グリーン(新規specを含む)
- [ ] `real-engine-*` specグリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] **設計判断**: 壊れたスライドが残ったまま別スライドの保存を通す
  (=Studioがビルドできないデッキを書く最初のケース)でよいか。代案は
  「壊れたスライドを直すまで一切保存できない」(今の挙動)。本ファイルは
  通す前提で書いてある。
- [ ] 実機での見た目確認: ERRORバッジの色・プレビュー欄の文言

## 先送り事項

- 隔離の上限5を設定にするか(たぶん不要)。
- 隔離中のスライドをプレビューに「最後に成功したときの描画」で出す案
  (`lastRenderedKey`の仕組みで一部は既に出るはず — 出るなら
  バッジだけで足りる)。
