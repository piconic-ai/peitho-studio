---
status: todo
description: 画像ファイルのドラッグ&ドロップ、またはクリップボードの画像のペーストで、デッキ内に画像を取り込んでMarkdownを挿入する
tags: [editor, images, tauri, rust-command]
---

# 画像のドラッグ&ドロップ / ペーストによる埋め込み

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザー要望「画像をドラッグ&ドロップしたり、Pasteしたら、埋め込める
と良い?」(2026-09-25)。Peithoの画像はデッキ相対パスのローカルファイルで、
今のStudioでは(1) 画像ファイルをデッキのディレクトリに手で置き、(2)
`![](img/x.png)`を手で書く、の2手が必要。これを1操作にする。

## スコープ

- **目的**: 本文エディタに画像ファイルをドロップ、またはクリップボードの
  画像(スクリーンショット等)をCmd+Vでペーストすると、画像ファイルが
  `<デッキのディレクトリ>/img/`にコピー/保存され、カーソル位置(ドロップ
  なら落とした位置)に`![](img/<名前>.<拡張子>)`が独立した段落として挿入
  される。挿入直後のドラフト描画でプレビューに画像が出る。
- **やらないこと**:
  - 「画像を挿入…」メニュー項目(ファイル選択ダイアログ経由)。dialog
    プラグインは入っているので後から小さく足せる — 先送り。
  - SVGの取り込み。peitho-coreがMarkdown画像でSVGを許していない
    (`png, jpg, jpeg, gif, webp`のみ)。SVGを落とされたらエラーメッセージを
    出すだけ。
  - 画像のリサイズ/圧縮/形式変換(ペーストのPNG化を除く)。
  - Undoしたときに保存済みの画像ファイルを削除すること(ファイルは残す。
    受け入れ条件に明記)。
  - 既存デッキで画像を受けるレイアウトがない場合の自動レイアウト追加
    (「方針」のレイアウト決定を参照。エラー表示までがこのtodo)。
  - ノートエディタへのドロップ/ペースト(ノートは画像を持てない)。
- **受け入れ条件**:
  - Finderから`.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`を本文エディタに
    ドロップすると、`img/`にファイルがコピーされ、ドロップ位置に
    画像Markdownが挿入される。同名ファイルがあれば内容が同じなら再利用、
    違えば別名(連番)で保存される。
  - スクリーンショットをクリップボードに取ってCmd+Vすると、`img/`に
    PNGが保存され、カーソル位置に画像Markdownが挿入される。
  - 挿入は前後に空行を伴う独立段落になる(`![](a.png) text`のような混在
    段落はpeitho-coreがエラーにするため)。
  - 対応外の拡張子や画像以外のファイルはStatusBarにメッセージが出て、
    何も書き込まれない。
  - Studioが作った新規デッキ(`create_deck`)では、ドロップ直後に
    プレビューに画像が出る(=画像を受けるレイアウトがscaffoldに含まれる)。
  - 画像を受けるレイアウトのない既存デッキでは、peitho-coreのエラー
    (「no slot accepts image in layout '…'」)がStatusBarに出て、テキスト
    は挿入されたまま残る(ユーザーがレイアウトを直せる)。
  - 挿入した画像MarkdownはCmd+Zで1回で取り消せる。ファイルは残る。
  - Cmd+Vのテキストペーストは今までどおり動く(画像がないときは
    CodeMirror標準のペーストに委ねる)。

## 背景・要調査

実際に読んで分かったこと(peitho-core v1.34.0 = `~/.cargo/git/checkouts/
peitho-*/5c5734e/`):

- **peitho-coreの画像パス規則**(`crates/peitho-core/src/domain.rs:
  474-554`, `RawImagePath::new`)
  - 拡張子は大文字小文字を問わず`png, jpg, jpeg, gif, webp`。**SVGは不可**。
  - 拒否: 空、`//`, `http:`/`https:`/`file:`/`data:`/`javascript:`、
    絶対パス(`/`, `~`, ドライブレター)、`\`、`?`、`#`、`..`成分。
  - デッキファイルのディレクトリからの相対パス。必須のフォルダ名はない
    が、ドキュメントと例は`img/`を使っている(`README.md:142-150`,
    `examples/image-showcase/img/`)。**`assets/`は避ける** — ビルド出力
    の名前空間で、Studioのアセットサーバも`deck_dir/assets/*`を直接
    配信するフォールバックを持つ(`engine/serve.rs:128-198`)。
  - ファイル名の空白・非ASCIIは上記チェックでは拒否されないが、ハッシュ
    付き出力名の生成(`ResolvedImagePath::from_hashed_asset`)がURL区切り
    文字を拒否する。**ASCIIの安全な名前を生成するのが確実**。
- **レイアウトの制約**(`mapping.rs:368-397`, `image_slot_name`)
  - 画像は、レイアウトに`accepts="image"`のスロットが**ちょうど1つ**ある
    ときだけ配置できる。0個なら「no slot accepts image」、2個以上なら
    「multiple slots accepting image」のエラー。
  - 画像は**画像だけの段落**でなければならない(`parser.rs:2489-2530`)。
  - **Studioの組み込みレイアウト`title-body-code`には画像スロットがない**
    (`src-tauri/src/engine/builtin/title-body-code.html`)。`create_deck`
    はこれをそのままscaffoldする(`peitho.rs:306-313`)ので、**新規デッキに
    画像を落とすと今のままでは必ずエラー**になる。
  - 複数レイアウトがあるときの選択規則(`mapping.rs:57-67`): 明示
    `{"layout":"…"}`が最優先、レイアウトが1つならそれ、複数なら構造的に
    一致するものが**ちょうど1つ**必要(0または2以上はエラー)。したがって
    scaffoldに`title-body-image`(画像スロット`arity="1"`=必須)を足せば、
    画像のないスライドはそれに一致せず(必須スロット未充足)、画像のある
    スライドは`title-body-code`に一致しない(画像スロットなし)ので、
    曖昧にならない — これは規則からの推論で、実装時にテストで確かめる。
- **Studioのレンダリング経路**
  - `render_draft`(`peitho.rs:552-567`)は`engine/pipeline.rs:87-132`の
    `render_source`でメモリ上のテキストを描画し、`DraftImageResolver`
    (`pipeline.rs:171-230`)が画像パスをcanonicalize→デッキ内包含チェック→
    内容ハッシュ→`assets/<hash>-<name>`に写像する。**ディスクには何も
    書かない。** ファイルが存在しなければ「image file not found」エラー。
    → 画像ファイルの書き込みはMarkdown挿入より**前**に完了していなければ
    ならない。
  - `AssetServer`(`engine/serve.rs`)は要求ごとにディスクから読むので
    キャッシュの陳腐化はない。名前が内容ハッシュなので差し替えも新URL。
  - ファイル監視はデッキファイル1つだけ(`NonRecursive`, `peitho.rs:
    483-488`)。画像を書いても監視は反応しないが、Markdown挿入が
    `render_draft`を誘発するので問題ない。
- **エディタ**: CodeMirror 6(`dom/codeEditor.ts:193-200`)。本文と
  ノートの2インスタンス(`Studio.tsx:343-364`、ホストは
  `data-editor="body"` / `"note"`)。
  - `paste`/`drop`/`dragover`のカスタムハンドラは**ない**。CodeMirror
    標準のpasteは`text/plain`/`text/uri-list`しか読まないので、画像だけ
    のクリップボードでは何も起きない。
  - **カーソル位置に文字列を挿入する関数はない。** `setCodeEditorText`は
    アプリ側からの全文置換で、`addToHistory: false`+`fromApp`注釈で
    Undo対象外かつ`onChange`抑止(`codeEditor.ts:225-233`)。新しい挿入
    関数は**この注釈を付けずに**dispatchし、`userEvent: 'input.paste'`
    または`'input.drop'`を付ける。CodeMirrorは`input.type`/`delete`しか
    連続イベントをまとめないので、自動的に独立したUndoグループになる。
  - Undo記録: `addToHistory:false`でない変更は`trackTextHistory`
    (`dom/textHistoryTracking.ts:47-58`)経由で`recordTextGroup`に届き、
    アプリ側タイムラインに`text`ステップが積まれる。追加の配線は不要。
- **Tauri**
  - `tauri.conf.json`のウィンドウ設定に`dragDropEnabled`がない=既定の
    `true`。この場合Tauriがファイルドロップを横取りし、**WebViewの
    HTML5 `drop`にはファイルが届かない**(macOS)。代わりに
    `getCurrentWebview().onDragDropEvent()`(`@tauri-apps/api` 2.11.1に
    あり、`core:default`権限で使える)がファイル**パス**と物理ピクセル座標
    を返す。CLAUDE.mdの「HTML5 DnDはWKWebViewで不安定」とも整合する
    ので、この経路を使う。座標は`devicePixelRatio`で割ってから
    `view.posAtCoords`に渡し、本文エディタの矩形内かを判定する。
  - `dragDropEnabled: false`にしてはいけない理由: CodeMirror標準のdrop
    ハンドラがファイルを`readAsText`して中身を挿入してしまう
    (バイナリは弾くが、制御を奪う必要が出る)。
  - **任意のファイルをデッキの隣に書くコマンドは存在しない。** 書き込み
    系は`save_deck_source`(デッキファイルのみ)、`create_deck`
    (scaffold)、設定/最近のデッキJSONだけ。`tauri-plugin-fs`は入って
    いない(`Cargo.toml:30-45`)。→ 新規Rustコマンドが必要。
  - capabilities(`capabilities/default.json`)は`clipboard-manager`の
    `allow-read-text`/`allow-write-text`のみ。`allow-read-image`はない。
- **クリップボード**
  - 現状の読み書きは`ipc/editorIpc.ts`の`readText`/`writeText`(テキスト
    のみ、vimレジスタ橋渡し用)。`navigator.clipboard.read()`がWKWebView
    で画像Blobを返すかは**リポジトリ内に知見なし**。WebKitでは
    user gesture必須で、システムの「ペースト」吹き出しが出ることがある
    ため、非同期Clipboard APIは避ける。
  - 候補: (a) CodeMirrorの`EditorView.domEventHandlers({ paste })`で
    `event.clipboardData.items`から`image/*`を取る(同期、プロンプトなし)。
    macOSのスクリーンショットは`image/png`または`image/tiff`で来る
    可能性がある — **TIFFはpeitho-coreの許容拡張子にないのでPNGに変換
    が必要**。(b) `@tauri-apps/plugin-clipboard-manager`の`readImage()`
    (2.3.3にあり)はRGBAの生データを返すのでRust側でPNGエンコードする。
  - `todo/archive/vim-mode.md:198-206`: OSクリップボードに画像がある
    ときvimのyank橋渡しが上書きしない、という既存の配慮がある。壊さない
    こと。

要調査(実機でしか分からない):

1. WKWebViewの`paste`イベントで、スクリーンショットが`image/png`で
   取れるか、`image/tiff`だけか。Finderでファイルをコピーした場合に
   `clipboardData.files`にファイルが入るか(アイコン画像だけになる
   可能性あり)。→ 結果次第で候補(a)/(b)を確定する。
2. `onDragDropEvent`の`position`が、複数ディスプレイ/スケール違いの環境で
   `posAtCoords`に正しく変換できるか。

## 方針

**画像を受けるレイアウト(要決定・第一候補あり)**: 組み込みレイアウトに
`title-body-image.html`(タイトル/本文/画像スロット`arity="1"`)を追加し、
`create_deck`のscaffoldにも含める。既存デッキで画像スロットがない場合は
peitho-coreのエラーをStatusBarに出すだけに留める(自動でレイアウトを
足すのは「先送り」)。代案: (b) ドロップ時に`check_slide_layouts`
(`lib.rs`に既存)で事前に判定して警告する / (c) エラーのままにする。
(a)を採るのは、Studioで作ったデッキで「ドロップしたら出る」を成立させる
最小の手段だから。レイアウトの見た目(画像の配置・サイズ)は人間の判断。

**Rustコマンド**: `import_deck_image`を`peitho.rs`に追加(状態=ウィンドウの
`deck_path`を引くため)。純粋な部分は`engine/images.rs`(新規)に分離:

- `fn plan_import(deck_dir: &Path, source_name: &str, bytes_hash: &str,
  existing: impl Fn(&Path) -> Option<Hash>) -> Result<PathBuf, String>`
  のような形で、拡張子の許可判定、ASCII安全名への正規化(例
  `img/screenshot-20260925-143012.png`、ドロップ時は元の名前を正規化)、
  衝突時の連番付与、`deck_dir`内包含の保証を純粋に決める。
- 入力は2種: ドロップ=元ファイルの絶対パス(Rustで読んでコピー)、
  ペースト=バイト列(PNG)。バイト列はTauri v2の生ボディ(`tauri::ipc::
  Request`/`Response`)で渡し、base64のJSONを避ける。
- 戻り値はデッキ相対パス(`img/...`)。フロントはこれをMarkdownに埋める。
- 書き込みは`<deck_dir>/img/`固定。`img/`がなければ作る。

**フロント**:

- `domain/editorText.ts`に純粋関数`imageParagraphInsertion(doc: string,
  pos: number, relPath: string): { from, to, insert }`を置く。前後の
  テキストを見て空行を補い、独立段落にする。alt textは空でよい。
- `dom/codeEditor.ts`に`insertAtCursor(view, insertion, userEvent)`と、
  本文エディタ用の`paste`ハンドラ登録(画像があるときだけ`true`を返して
  CodeMirror標準を止める。テキストだけなら`false`)。
- `ipc/deckIpc.ts`(または新規`ipc/imageIpc.ts`)に`importDeckImage`と
  `onDragDropEvent`の購読(ウィンドウ限定 — `subscribeToThisWindow`と
  同じ流儀)。
- `components/Studio.tsx`で購読と本文エディタを接続。ドロップ座標が
  本文エディタ外なら無視。複数ファイルのドロップは順に処理し、それぞれ
  独立段落として連続挿入する。
- 進行中のフィードバック: 取り込み中はStatusBarに「画像を取り込み中…」
  (`domain/statusMessage.ts`の既存の仕組みに乗せる)。

**ペーストの経路**: 候補(a)(DOM `paste`)を先に実装し、実機調査1の結果
`image/tiff`しか取れない場合は(b)(Rust側で`readImage`→PNGエンコード、
`image`クレート追加、`clipboard-manager:allow-read-image`権限追加)に
切り替える。切り替えた場合は理由をこのファイルに残す。

## レイヤー配置

- Rust
  - `src-tauri/src/engine/images.rs`(新規、純粋): 名前正規化・拡張子
    判定・衝突回避・包含チェック。`(Path, &str) -> Result<T, String>`
    の形を守る。
  - `src-tauri/src/engine/builtin/title-body-image.html`(新規)と
    `builtin.rs`への登録、`peitho.rs`の`create_deck`のscaffold更新。
  - `src-tauri/src/peitho.rs`: `#[tauri::command] import_deck_image`
    (状態アクセスと実I/Oのみ)。`lib.rs`のハンドラ登録に1行。
- フロント
  - `domain/editorText.ts`: `imageParagraphInsertion`(純粋)。
  - `domain/images.ts`(新規、純粋): ドロップされたパス群のフィルタ
    (拡張子で画像だけ残す)と、エラーメッセージの組み立て。
  - `dom/codeEditor.ts`: 挿入関数とpasteハンドラ。
  - `ipc/`: コマンド呼び出しとドロップイベント購読。
  - `components/Studio.tsx`: 配線。

## テスト

- Rust `engine/images.rs`
  - spec: `photo.png`→`img/photo.png`、同名で内容が同じなら再利用、
    内容が違えば`img/photo-2.png`、拡張子の大文字(`.PNG`)を小文字化。
  - adversarial: 空の名前、拡張子なし、`.svg`/`.tiff`/`.txt`、`..`を含む
    名前、`/`や`\`を含む名前、非ASCII/空白のみの名前(生成名に
    フォールバック)、`deck_dir`外を指すシンボリックリンク(canonicalize後
    の包含チェック)、既存の`img`が**ファイル**である場合。
- `domain/editorText.test.ts`
  - spec: 行頭/行中/行末/文書末での挿入で前後に空行が1つずつ入る。
  - adversarial: 空文書、`pos`が範囲外、直前が既に空行(空行を重ねない)、
    CRLF、文書がfrontmatterのみ。
- `domain/images.test.ts`: 拡張子フィルタのspec/adversarial(大文字、
  多重拡張子`a.tar.png`、空配列)。
- e2e(`e2e/*.e2e.ts`、mockTauri): `page.evaluate`で`ClipboardEvent`
  (`DataTransfer`に`File`を積む)を本文エディタに投げ、mockした
  `import_deck_image`が呼ばれてMarkdownが挿入されること、テキストだけの
  ペーストは従来どおりであること。ドロップは`onDragDropEvent`を
  mockTauri側で発火して同様に確認。
- `scripts/arch-check.test.ts`が`domain/*.ts`のimport制約を持つなら、
  新規ファイルもそれに従うこと。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test`(`src-tauri/`)グリーン
- [ ] `bun run test:e2e` グリーン(追加分含む)
- [ ] `create_deck`で作ったデッキに画像だけの段落を足したソースが
  `render_source`でエラーなく描画される(Rustテスト)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] レイアウト決定(上記(a))の承認と、`title-body-image`の見た目
- [ ] 実機での確認: Finderからのドロップ、スクリーンショットのペースト
  (要調査1の結果をこのファイルに追記)、対応外ファイルのエラー表示
- [ ] ペースト経路(a)/(b)の最終決定

## 先送り事項

- 「画像を挿入…」メニュー(dialogプラグイン)。キーボードだけの操作や
  ドロップが使えない環境向け。
- 画像スロットのないデッキに、レイアウトの追加を提案するUI。
- 使われなくなった`img/`内のファイルの掃除(Undoやテキスト削除で参照が
  消えたもの)。
- クリップボードの画像を`peitho present`中にも扱う話は対象外(CLI側)。
