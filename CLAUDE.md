# peitho-studio 設計ルール

Peitho(Markdown駆動プレゼンテーションエンジン)を包むTauriデスクトップGUI。
Tauri v2(Rust) + BarefootJS CSR + UnoCSS。peitho-coreはサブプロセスではなく
`src-tauri/src/engine/`にin-processで埋め込んでいる。

## 設計原則

フロントエンドの層構成(domain/state/ipc/dom/components)・ADTでありえない
状態を排除する原則・Given-When-Thenでの仕様記述・不具合発見手法の方針は
`docs/architecture.md`に詳しい(`components/Studio.tsx`のリファクタリングを
機に確立)。実行中の移行計画・進捗は`todo/`配下(完了後は削除/アーカイブ)。

- **純粋関数を好む。** 入力から出力が決まる関数を既定にし、副作用・状態への
  依存は本当に必要な箇所だけに絞る。
- **状態を使う場合は、ディレクトリ/ファイル構造で区別できるようにする。**
  「これは状態を持つコードか、純粋なロジックか」がファイルを見ただけで
  判断できることを目指す。具体的な現状の割り当て:
  - フロントエンド: `components/*.ts`(`.tsx`ではない)はシグナル・DOM・IPC
    に触れない純粋ロジック専用(例: `domain/slides.ts`, `domain/previewDoc.ts`)。
    `components/*.tsx`はBarefootJSのシグナル・エフェクト・IPC呼び出しを持つ
    状態あり層。新しい純粋ロジックは`.tsx`の中に埋め込まず、まず`.ts`ファイル
    に切り出せないか検討する。
  - Rust: `src-tauri/src/engine/`はpeitho-coreを呼ぶレンダリングパイプライン
    ——Tauriの`State`を一切参照しない、`(Path, &str) -> Result<T, String>`
    形の決定的な関数群。`src-tauri/src/peitho.rs`はTauriコマンド + 状態管理
    層——`PeithoSession`/`PendingDecks`などの`Mutex`で保持する状態は必ずここに
    集約し、他のモジュールに漏らさない。`src-tauri/src/lib.rs`はアプリの配線
    (メニュー構築・イベントルーティング)のみを行う薄い層とし、ビジネス
    ロジックを持たせない。
- **純粋関数はスコープを小さく保つ。** 1関数1責務。複数の変換を1つの関数に
  詰め込みそうになったら、小さい純粋関数の組み合わせに分割できないか先に
  検討する。
- **spec テストと敵対的テストは基本必須。** 新しい純粋関数を追加/変更したら、
  典型的な入力に対するspecテストと、境界値・不正入力・空文字列などに対する
  敵対的テストの両方をセットで書く。「動くはず」で終わらせない。
  - フロントエンド: `bun test`(`*.test.ts`)。純粋ロジックのみを対象にし、
    BarefootJSコンポーネント本体(`.tsx`)は今のところユニットテスト対象外
    ——コンポーネントの構造検証が必要になったら`@barefootjs/test`
    (ブラウザなしのIRベーステスト)を使う。
  - Rust: 各モジュール内に`#[cfg(test)] mod tests`。`AppHandle`/`State`に
    依存するTauriコマンドそのものは現状ユニットテスト対象外(Tauriの
    テストハーネスが必要)——コマンドから状態非依存のロジックを関数として
    切り出し、そちらをテストする。
- **e2eもほしいが、段階的でよい。** `e2e/`配下のPlaywrightスモークテストは
  Tauriを介さず、開発サーバー(`bun run dev`のフロントエンド部分)に対して
  「起動して主要画面が表示される」ことだけを確認する薄いものから始める。
  実際のTauriウィンドウを操作する本格的なe2e(`tauri-driver`経由)は
  Scope1以降の課題として`tmp/todo.md`に積む。それまでの間、Welcome画面より
  先(デッキを開く/編集する等)の動作を実機で確認する手順は
  `.claude/skills/run-peitho-studio/SKILL.md`にまとめてある。

## コミットの粒度

意味単位でコミットする。「設計ルールを書いた」「このロジックを純粋関数に
切り出した」「テストを足した」はそれぞれ別コミットにする——1つの巨大な
コミットに全部まとめない。

## Tauri (v2 / WKWebView) で踏んだ落とし穴

- `window.confirm()` / `window.prompt()` はTauriのWKWebView上で信頼できない
  (サイレントにキャンセル扱いになることがある)。確認が必要な操作は
  ネイティブダイアログに頼らず、アプリ内の独自UIで組む。
- ネイティブのHTML5 drag-and-drop(`draggable`, `dragstart`など)はWKWebView
  上で不安定。並べ替えUIは`mousedown`/`mousemove`/`mouseup`を自前で組む方式
  にする(コラムのリサイズ用ディバイダーと同じパターン)。
- `Builder::menu(factory)`に渡すファクトリは、Tauri自身の内部管理状態
  (`PathResolver`など)が`manage()`される**前**に呼ばれる。ここで`app.path()`
  など管理状態に依存するAPIを呼ぶとパニックする。空データでプレースホルダーの
  メニューを組み、`setup()`完了後に本物のメニューを`app.set_menu()`で
  差し替える(`src-tauri/src/lib.rs`の`build_menu`/`build_menu_with_recents`
  参照)。
- 開発ビルドではWKWebViewの`isInspectable`が既定で`true`になり、ページ側の
  `contextmenu`ハンドリングに関わらずネイティブの「要素を検証」メニューが
  優先される。独自の右クリックメニューを機能させたいなら
  `tauri.conf.json`のウィンドウ設定で`"devtools": false`にする。
- `<iframe>`は`pointer-events: none`を設定していても右クリックだけは自分の
  ネイティブコンテキストメニュー(「フレームを新規ウィンドウで開く」等)に
  奪ってしまう(通常のクリック/ドラッグは正しく透過する)。iframeの上に
  不透明な(pointer-eventsを殺さない)オーバーレイ`<div>`を重ねて、iframeが
  絶対にイベントターゲットにならないようにする。
- 手動ドラッグ中にカーソルが`<iframe>`の上を通過すると、それは別の
  ブラウジングコンテキストなので`mousemove`が親ドキュメントに届かなくなる。
  ドラッグ中は全`<iframe>`の`pointer-events`を一時的に無効化する。
- ウィンドウごとに異なるべき状態(開いているデッキ、そのファイル監視、
  そのサブプロセス)は、単一のグローバルではなく`window.label()`をキーにした
  マップで持つ。そうしないと2つ目のウィンドウが1つ目の状態を黙って上書きする。
- 実行時に生成したウィンドウへ「どのリソースを開くか」を渡すには、URLの
  クエリ文字列に埋め込むより、`Mutex<HashMap<label, T>>`の「pending」レジストリ
  にウィンドウ生成**前**に登録し、そのウィンドウが起動時に一度だけ取り出す
  方式の方がシンプルで壊れにくい(`PendingDecks`/`take_pending_deck`参照)。

## BarefootJS で踏んだ落とし穴

- **keyedな`.map()`の再利用バグ**
  ([piconic-ai/barefootjs#2859](https://github.com/piconic-ai/barefootjs/issues/2859)
  として報告済み): 同じkeyを持つ行が並べ替えられると、そのkeyのDOMノードは
  再利用されるが、元の`.map()`呼び出し時にクロージャで捕まえた非シグナルの
  値(生の`i`インデックスなど)はレンダー本体の中では更新されない。
  イベントハンドラは(PR #2191で)クリック時に`data-key`からインデックスを
  再導出するため影響を受けないが、レンダー本体で使う値は影響を受ける。
  keyed `.map()`の中で「このアイテムの現在位置」が要るときは、生のループ
  インデックスを直接JSXに書かず、per-keyのシグナルで持つ(下記)。
- **1つのシグナル/メモに`Map`/`Record`をまるごと持たせない。**
  `createMemo<Map<key, X>>`のような「コレクション全体を1つの値として持つ」
  設計は、それを読むすべての行を「コレクション全体」に購読させてしまい、
  どれか1つのアイテムが変わるたびに全行が再レンダーされる(チラつきの原因)。
  代わりに`Map<key, [getter, setter]>`をkeyごとに遅延生成し、
  `createEffect`で「値が実際に変わったキーの setter だけ」呼ぶ
  (`fragmentSignal`/`indexSignal`パターン、`state/renderStore.ts`参照)。
- **`.map()`のコールバックは式本体にする。** `(item, i) => (<jsx/>)`の形に
  し、`{ const x = ...; return <jsx/> }`のようなブロック本体は避ける
  ——ブロック本体はコンパイルエラー(`BF021`)になる。インデックスから
  何かを引きたい場合は`.map()`の外で`createMemo`により事前計算する。
- **(未解決・要注意)** JSX内で連鎖した三項演算子を使い、後段の分岐が
  「マウント後にシグナルが`null`→データありへ遷移して初めて表示される」
  形になっていると、その分岐の中身が描画されないことがあった(データ自体は
  正しく読めているのに)。同じJSXを最初からマウントしておく構成に変えたら
  直った。マウント後の状態遷移で特定の分岐だけ描画されないときは、まず
  この可能性(三項演算子の連鎖 vs マウントで出し分け)を疑う。
- **(訂正済み・下記参照) `bf debug graph`の`(no tracked deps)`だけで
  「実機で壊れる」と即断しない。** 一時、このセクションに「シグナル/メモは
  ファクトリ関数(`state/xxxStore.ts`が`{ x, ... }`を返す形)から渡すと
  壊れる」「ヘルパー関数越しに読むと壊れる」という2つの"制約"を書いていたが、
  どちらも`domain/drag.ts`の実装をそのまま使った再現(ファクトリ関数の
  戻り値をJSXから`store.x()`で呼ぶ、`.map()`の中で複数のmemo呼び出しを
  含む複雑な式で使う、ヘルパー関数が内部でmemoを読んでJSXから
  `helper('cut')`のように呼ぶ、の3パターン)で実際にブラウザ動作を
  確認したところ、**全て正しく動的に更新された**——誤りだったと判明。
  `bf debug graph`はコンパイル時の静的解析結果であり、BarefootJSには
  それとは別に動的なリアクティビティ追跡(wrap-by-default)があるため、
  「静的解析で見つからない依存」がそのまま「実行時に更新されない」を
  意味しない。当時「動かない」と見えたもの(Step 7のドラッグ視覚効果)は、
  後に判明した別の原因(実機確認時、DevToolsのInspect Elementモードが
  有効なままクリックがアプリに届いていなかった)による見かけ上の現象
  だった可能性が高い。**教訓**: `bf debug graph`の`no tracked deps`は
  「深掘りすべき手がかり」であって「壊れている確定証拠」ではない。実際に
  壊れているかどうかは、疑わしければ`@barefootjs/test`のIRテストや
  実ブラウザでの動作確認まで行ってから判断する。唯一実際に確認できた
  本物の制約は次の1点だけ:
  **`const { x } = store`という分割代入でシグナルのgetterを取り出すと
  `ReferenceError: Can't find variable: x`で実行時に落ちる**
  (コンパイラの識別子抽出が分割代入を素通りするため)。`const store =
  createFooStore()`と受け取り、プロパティ経由(`store.x()`)で呼ぶ分には
  問題ない。
- **propsには`Memo<T>`型のgetter自体ではなく、呼び出した値を渡す**
  (`isBusy={isBusy()}`であって`isBusy={isBusy}`ではない)。後者を渡すと
  コンパイラが`BF044`(`Signal/Memo getter passed without calling it`)で
  ビルドエラーにする——`components/WelcomeScreen.tsx`切り出し時に
  `isBusy: Memo<boolean>`という型で設計して踏んだ。BarefootJSのprops
  リアクティビティはSolidJSと同じモデルで、`value={count()}`はコンパイラに
  よって`{ get value() { return count() } }`というgetterプロパティに
  下げられる。子側は`props.xxx`と直接読む(分割代入すると`BF043`警告——
  リアクティビティが失われるため。初期値として1回だけ使う意図なら
  `@bf-ignore props-destructuring`で明示的に黙らせる)。この`props.xxx`型の
  読み取りも`bf debug graph`の静的グラフには乗らない(`no tracked deps`)
  ことが多いが、上記の教訓どおり動的追跡で実際には正しく更新される
  ——Playwrightで確認済み。

## UnoCSS (Wind4 preset) で踏んだ落とし穴

- `border-[Npx]`のような角括弧の任意値構文は、UnoCSS Wind4プリセットで
  border-**color**ユーティリティとして誤解釈され、無効なCSS
  (`color-mix(in oklab, 6px ..., transparent)`)が生成される。border幅は
  数値スケールのユーティリティ(`border-2`/`border-4`/`border-8`)を使う。
- 半透明のborder色(例: `border-foreground/40`)は、要素自身が不透明な
  背景(`bg-black`など)を持っていると、そのローカルな背景に対して
  ブレンドされる(ページ全体の背景に対してではない)。意図した色にならない
  ときは、アルファ付きトークンではなく不透明なトークン
  (`border-muted-foreground`など)を使う。
- `inset-0`はUnoCSSでCSSの`inset`ショートハンドプロパティ
  (`inset: calc(var(--spacing) * 0)`)にコンパイルされるが、この
  アプリが動くWKWebViewでは(実機のCmd+Shift+Dデバッグスナップショットで
  確認済み)`inset`ショートハンド自体が効かず、`position:absolute`/`fixed`は
  適用されるのに`top`/`right`/`bottom`/`left`が一切効かない
  ——絶対配置要素が「制約なし」のフォールバック(static位置・内在サイズ、
  `<iframe>`ならデフォルトの300×150px)になる。`inset-0`は使わず、
  `top-0 right-0 bottom-0 left-0`(個別の物理プロパティ、CSS2から
  存在する)を明示的に並べる。
