---
status: wip
description: Studioに「スライド / レイアウト」のモード切替を設け、レイアウト一覧・プレビュー・適用・新規作成・複製・削除・HTML/CSS編集を専用画面で行えるようにする
tags: [layout, ui, screen]
---

# レイアウト専用画面

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーの要望(2026-10-02)「レイアウト画面を専用に用意したい」。
求められた操作: スライドのレイアウトを選択したレイアウトに変更 / 新規
レイアウト作成 / 複製 / 削除 / (選択レイアウトへ・レイアウト全体へ)
コメントしてAIに変更させる。壁打ちの結論:
- 画面形態は**Studio内のモード切替**(ヘッダーで「スライド / レイアウト」)。
  加えてこの画面からAIにコメントできること(→コメント部分は
  `todo/layout-review-comments.md`に切り出し)。
- 使用中レイアウトの削除は**置き換え先を選ばせる**。

レイアウト画面3本組の2本目。前提: `todo/standard-layouts.md`(定番の
表示名表と、明示方式)。後続: `todo/layout-review-comments.md`。

## スコープ

- **目的**: デッキのレイアウトを一覧で見て、スライドへの適用と、
  レイアウトファイル自体の作成・複製・削除・編集を1つの画面で完結させる。
- **やらないこと**:
  - コメント→AIでのレイアウト変更(→`todo/layout-review-comments.md`)。
  - 視覚的なドラッグ編集(WYSIWYGのレイアウトエディタ)。編集はHTML/CSSの
    テキスト編集のみ。
  - frontmatterの`layouts:`/`css:`パス指定への対応(Studio全体で未対応。
    `engine/assets.rs`冒頭コメント参照)。デッキ直下の`layouts/`/`css/`だけを
    扱う。
  - レイアウトの名前変更(リネーム)。複製+削除で代替できる。必要なら
    先送り事項へ。
  - レイアウトファイル操作(作成/複製/削除)のUndo。
    `todo/archive/image-slot-layout-suggestion.md`と同じく、ファイル操作は
    Undo対象外。削除に伴う置き換え先への書き換えも削除の一部として
    Undo対象外(戻すと消えたレイアウトを指すことになり、レンダが必ず失敗して
    Undoが詰まるため)。削除したレイアウトを指すUndo/Redo手順が履歴に残って
    いれば、履歴ごと消去してステータスで知らせる。
- **受け入れ条件**:
  - デッキを開いた状態でヘッダーから「レイアウト」モードに切り替えられ、
    デッキの`layouts/*.html`が全部、サムネイル付きで一覧される。
  - 一覧でレイアウトを選び「スライドに適用」すると、スライドモードで選択中の
    スライドのページコメントに`"layout":"<name>"`が書かれる(既存の
    `changeSlideLayout`経路 = Undo可)。合わないレイアウトは既存の
    `check_slide_layouts`で事前に弾かれ、理由が表示される。
  - 「新規作成」で、空のテンプレートまたは定番レイアウトから名前を付けて
    `layouts/<name>.html`(+`css/<name>.css`)を作れる。既存名は拒否。
  - 「複製」で`<name>-copy`(衝突時は連番)としてHTML/CSSを複製できる。
  - 「削除」で、使用中でなければファイルを削除。使用中なら使用枚数を示し、
    置き換え先を選ばせ、該当スライドのlayoutを書き換えてから
    ファイルを削除する(書き換えはUndo対象外、上記)。書き換え前に
    `check_layout_removal`がビルドまで検査し、削除が拒否されるなら
    deck.mdに触れない。それでも削除が失敗したら書き換えを戻す。
    最後の1つは削除できない。
  - (2026-10-02 実機レビューで追加)一覧の行を右クリックすると、アプリ内
    メニューで「スライドに適用(選択スライドが無い/合わないときは無効、
    理由をツールチップ)・レイアウトを編集・複製・削除」ができる。一覧の
    空き領域の右クリックは「新規レイアウト」。Escapeと外側クリックで閉じる。
  - (2026-10-02 実機レビュー2回目で変更)操作はすべて右クリックメニューから。
    プレビュー上部のツールバー(スライドに適用・複製・削除)と一覧見出しの
    「新規レイアウト」ボタンは無い。削除の確認(使用中なら置き換え先の選択も)と
    新規レイアウトはアプリ内モーダル(`window.confirm`は使わない)。Cancel・
    Escape・外側クリックで閉じ、開くとモーダルにフォーカスが移る。最後の行の
    下に右クリックできる余白がある。
  - (同上)HTML/CSSエディタはスライド本文と同じCodeMirrorで、設定の
    Vimモードがそのまま効く(設定変更は即時反映)。スライドエディタに`:w`の
    割り当てが無いので、こちらにも無い。エディタ内のUndo(Edit > Undo)は
    そのエディタの入力だけを戻し、スライドの履歴には触れない。
  - (同上・2回目)HTML/CSSエディタは折り返さず、横スクロールする(スライド
    本文・ノートは従来どおり折り返す)。
  - (同上・2回目)HTML/CSSを編集すると、保存せずにプレビューが追従する
    (入力が250ms止まったら`preview_layout_draft`で描画)。壊れた下書きでは
    直前に描けたプレビューを残し、理由をプレビューの下に出す。古い要求の
    応答は捨てる。レイアウト切替・元に戻す・保存で保存済みのプレビューに戻る。
    下書きだけが参照するファイル(`<img src>`等)もプレビューで読める
    (`preview_layout_draft`が解決したファイルを`AssetServer`に追加登録し、
    URLはデッキのアセットサーバー基準に直す。追加のみで、保存済みデッキの
    配信は置き換えない)。下書きCSSの`@font-face`も、レイアウト画面で下書きの
    プレビューを描いている間だけページに登録する(元に戻す・保存・切替・
    スライド画面への切替で外れ、レイアウト画面に戻れば再登録)。デッキが
    定義するfont-familyを下書きが定義し直した場合は、下書きCSS内でその
    familyをプレビュー専用の名前に付け替えて登録するので、スライドの
    サムネイルには効かない(`previewDraftCss`)。
  - (同上)コメント欄(`ReviewPanel`)はレイアウト画面でも同じ列・同じ
    開閉状態・同じスレッドで出る(レイアウトへのコメント送信は
    `todo/layout-review-comments.md`)。
  - 選択したレイアウトのHTML/CSSを画面内で編集・保存でき、保存すると
    プレビューとスライドモードのサムネイルが更新される。壊れたHTML
    (`parse_layout`が失敗する)は保存前にエラー表示し、保存しない。

## 背景・要調査

読んで分かったこと:

- 画面切替の仕組みは無い。`Studio.tsx`は`deck.showEditor()`でWelcomeと
  4パネル(スライド/エディタ/プレビュー/レビュー、`PanelToggle`+`ui.*Open()`)
  を出し分けるだけ。設定は`SettingsPanel`のオーバーレイ。モードは新しい
  ADTとして`state/uiStore.ts`に足す(例: `StudioMode = 'slides' | 'layouts'`)。
- BarefootJSの制約(`CLAUDE.md`): 分岐で`ref`内`createEffect`がリークする
  (#2927)・分岐内のネスト`.map()`が更新されない(#3274)・分岐に入った直後に
  内側の条件が切り替わると描画されない。→ **両モードを常時マウントし
  `hidden`クラスで切り替える**(`SlidePreview.tsx`/`SlideContextMenu.tsx`と
  同じパターン)。
- 既存のレイアウト関連:
  - `preview_layouts`(`peitho.rs`)はレイアウトごとに合成1枚デッキ
    (見出し+段落+リスト)をレンダする。image/codeが必須のレイアウトは
    `fragment:""`(名前だけのカード)になる。CSSは最初に成功したレンダの
    ものだけ。→ 専用画面では、slot定義(`accepts`/`arity`)からプレース
    ホルダー本文を生成してレンダする方式に改める(「クリックしてタイトルを
    追加」相当の表示)。右クリックメニューのピッカーも同じものを使う。
  - `check_slide_layouts`(`engine/layout_fit.rs`)で適用可否を事前判定できる。
  - `changeSlideLayout`→`updateSlideConfig`→`perform({kind:'config'})`で
    Undo可能に書き換わる(`domain/slides.ts::updatePageComment`)。
  - 既知の不整合: サムネイルの添字(マニフェスト位置)と`updateSlideConfig`の
    添字(`splitSlides`位置)はdraft/includeがあるとずれる
    (`todo/archive/layout-picker-mismatch-error.md`の先送り)。専用画面の
    「使用中スライド数」もこの影響を受けるので、使用状況はマニフェストの
    `source_index`基準で数える。
- レイアウトファイルを書く処理は`scaffold_deck_files`と`add_image_layout`
  のみ。`add_image_layout`は既存ファイルを上書きしない(`refuse_taken`)。
  新しいRustコマンドもこの規則に従う(編集保存だけが明示的な上書き)。
- ファイル監視は`deck.md`のみ(`peitho.rs`)。レイアウトを書き換えたら
  Studio側から明示的に再レンダ+`layoutPreviews`キャッシュ無効化
  (`setLayoutPreviews(null)`)が必要。外部エディタでのレイアウト編集を
  拾う監視の追加はやらない(先送り)。
- レイアウトの単一→複数への切替(1つしかないと無条件適用、2つ以上で
  構造マッチング)は削除で逆向きにも起こる。削除後に全スライドのdispatchが
  変わらないことを`add_image_layout`の`check_addition`と同様に検査する。
- エディタは`dom/codeEditor.ts`(CodeMirror)。HTML/CSSモードが使えるか
  要確認(未確認の推測: 言語パッケージの追加が要る)。

## 方針

- **画面構成**(レイアウトモード): 左=レイアウト一覧(サムネイル+表示名+
  使用枚数)、中央=選択レイアウトのHTML/CSSエディタ(タブ切替)、右=
  選択レイアウトのプレビュー(プレースホルダー表示)、右端=コメント欄。
  操作は一覧の右クリックメニュー(行: スライドに適用・編集・複製・削除、
  空き領域: 新規作成)。削除と新規作成はモーダル。
  見た目は既存の4パネルと同じ`columnResize`で揃える。
- **適用の対象スライド**: スライドモードで選択中のスライド(複数選択は
  Studioに無いので1枚)。選択が無ければ「適用」は無効化。
- **段階分け**(この順にPRを分けてよい):
  1. モード切替+一覧+プレビュー+適用(読み取り中心)
  2. 新規作成・複製・削除(置き換え付き)
  3. HTML/CSS編集・保存
- 新規作成のテンプレート: 「空白」(`<section class="peitho-slide
  layout-<name>"><h1><slot name="title" accepts="inline" arity="1">
  </slot></h1></section>`程度)と、`todo/standard-layouts.md`の定番各種。
- 名前の検証は`validate_deck_name`と同じ考え方の純粋関数で(空・パス区切り・
  `.`始まり・既存名を拒否、使える文字は英数字と`-`/`_`)。

## レイヤー配置

- Rust `engine/`: `layout_files.rs`(新規 — 作成前に既存を確認)に
  純粋関数: 名前検証、複製名の決定、テンプレート生成、削除後のdispatch
  不変検査、slot定義→プレースホルダー本文の生成、HTMLの検証(`parse_layout`)。
- Rust `peitho.rs`: コマンド`create_layout`/`duplicate_layout`/
  `delete_layout`/`read_layout`/`save_layout`/`layout_usage`。
- フロント `domain/`: モードADT、一覧の行モデル(名前・表示名・使用枚数・
  削除可否)、削除フローのADT(`idle | confirming{usage} |
  choosing-replacement | deleting`)。
- `state/uiStore.ts`: モード。`ipc/deckIpc.ts`+`ipc/fakeDeckIpc.ts`: 新コマンド。
- `components/`: `LayoutScreen.tsx`(新規)、`DeckHeader.tsx`にモード切替、
  `LayoutContextMenu.tsx`(右クリックメニュー、項目は`domain/layoutMenu.ts`)。
  オーケストレーションは`Studio.tsx`。

## テスト

- Rust spec/adversarial: 名前検証(空・空白・`../x`・`a/b`・`.hidden`・
  既存名・日本語)、複製名(`x-copy`衝突時に`x-copy-2`…)、削除後dispatch
  検査(単一→構造マッチへの切替で壊れるケース)、壊れたHTMLの保存拒否
  (`<section>`2つ・slot属性欠落)、上書き拒否、プレースホルダー生成
  (accepts各種、arity `1`/`0..1`/`1..*`/`0..*`)。
- TS spec/adversarial: 行モデル(使用0枚/複数枚/最後の1つ)、削除フローの
  遷移(置き換え先に自分自身を選べない、キャンセル)。
- e2e(mockTauri): モード切替→一覧表示→適用でdeck.mdに`layout`が書かれる、
  使用中レイアウトの削除で置き換え先選択→書き換え。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `cargo test` グリーン
- [x] `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機でのモード切替・一覧・編集保存の見た目/挙動確認(ユーザー自身に依頼)
- [ ] 画面構成(左一覧/中央エディタ/右プレビュー/右端コメント)がイメージに合うか
- [ ] 実機での右クリックメニュー(WKWebViewのネイティブメニューが出ないこと)と、
  レイアウトエディタでのVimモード(IME切替・クリップボード共有)

## 先送り事項

- `layouts/`/`css/`の外部変更を拾うファイル監視。
- レイアウトのリネーム(参照しているスライドの書き換え込み)。
- 新規デッキの`title-body`は削除できない(code slotを持つのが`title-body`だけで、
  `css/base.css`の`.slot-code`をpeitho-coreが拒否するため。
  `check_layout_removal`が書き換え前に拒否する)。base.css側の`.slot-code`を外すか、別の
  レイアウトにcode slotを持たせるかは未決。
- 一覧の行メニューは右クリックで追加済み(#2930は`SlideList.tsx`と同じく
  一覧コンテナ側のハンドラが行内のクリックを無視して回避)。ツールバーは
  実機レビューで廃止。行ごとの`…`ボタンは作っていない(右クリックだけ)。
- 保存済みレイアウトのプレビュー(`preview_layouts` — 一覧のサムネイルと
  Change Layoutのピッカー)は、レイアウトだけが参照するファイルを配信登録
  しない(このPR以前から)。スライドが使っていればデッキ側で配信されるので
  見える。下書きのライブプレビューは登録する。
- 下書きの`@font-face`はページ全体に登録される(Shadow DOM内での登録が
  WKWebViewで未確認のため、デッキのフォントと同じ方式)。デッキに無い新しい
  familyだけがそのまま登録され、スライド側はそのfamilyを参照しないので
  影響しない。family名の付け替えは`font-family`/`font`宣言と`@font-face`
  だけが対象(値はCSSどおりに読む: `!important`、`font`の短縮記法のサイズ/
  行高さの後のfamily、クォート内のカンマ・エスケープ、クォート無しの複数語)。
  `var()`経由・`calc()`を含む`font`短縮記法・システムフォント(`font: caption`)
  は追わず、そのまま残す。
- 下書きのファイル登録(`AssetServer`の`draft_assets`)はウィンドウが開いて
  いる間増えるだけ(パスはファイルのハッシュ付きなので古くはならない)。
- レイアウトHTML/CSSの構文ハイライト(`@codemirror/lang-html`/`lang-css`の
  追加)。今はプレーンテキストのCodeMirror。
