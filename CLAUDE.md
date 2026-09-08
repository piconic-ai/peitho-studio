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
  (`fragmentSignal`/`indexSignal`パターン、`components/Studio.tsx`参照)。
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
- **シグナル/メモはコンポーネントファイル自身の中で`createSignal`/
  `createMemo`を直接呼んで宣言しないといけない——ファクトリ関数から返す形は
  壊れる。** `state/xxxStore.ts`に`export function createFooStore() { const
  [x, setX] = createSignal(...); return { x, ... } }`を書き、コンポーネント側で
  `const store = createFooStore()`として使うパターン(5層アーキテクチャの
  `state/`層をそのまま素直に実装した形)を試したところ、`store.x()`を
  JSX内で呼んでも画面が更新されなかった(値は実際には変わっている)。
  `bf debug graph <Component>`で調べると、そのバインディングの`deps`が
  空(`(no tracked deps)`)——コンパイラは「そのコンポーネントのソース内に
  リテラルで書かれた`createSignal`/`createMemo`呼び出し」を静的解析して
  依存関係を組み立てており、関数呼び出しの戻り値をたどってシグナルの
  出所を追うことはしていない。`const { x } = store`のような分割代入は
  さらに悪く、`ReferenceError: Can't find variable: x`で実行時に落ちる
  (識別子抽出が分割代入を素通りしてしまう)。`const x = store.x`という
  単純代入に変えても改善しない——同じく`deps: []`のまま。
  **対策**: シグナル/メモの宣言自体は使うコンポーネントの`.tsx`ファイルに
  残し、`domain/`にはロジック(状態遷移関数)だけを置く。例えば
  `domain/drag.ts`はDragStateのADTと`arm`/`move`/`dropTarget`/`cancel`という
  純粋関数を提供し、`components/Studio.tsx`側で
  `const [dragState, setDragState] = createSignal<DragState>(...)`と
  `createMemo`をコンポーネント内に直接書いて、それらの関数を呼ぶ
  (`components/Studio.tsx`の`draggedIndex`/`dragOverGap`/`dragDeltaY`memo
  参照)。5層アーキテクチャの`state/`層は「シグナルを持つグルーコード」の
  置き場所という位置づけ自体は変わらないが、実装上はコンポーネント
  ファイルの外にシグナル宣言そのものを追い出すことはできない、という
  制約と理解しておく。
- **上記の亜種: JSX式の中に`シグナル()`/`メモ()`の呼び出しがリテラルに
  現れないと、それを間接的に読むだけのヘルパー関数越しでも依存追跡が
  外れる。** `const items = createMemo(...)`と`function isEnabled(action)
  { return items().find(...)?.enabled }`を定義し、JSX側で
  `disabled={!isEnabled('cut')}`のように呼ぶと、`bf debug graph`の
  `deps`が空になり更新されない——`isEnabled`の呼び出し自体はJSX式に
  書かれているが、その中で読んでいる`items()`はJSX式のソースには
  現れないため。`disabled={!isEnabled(items(), 'cut')}`のように
  **メモの呼び出し結果をJSX式の中で直接引数として渡す**と直る
  (`domain/contextMenu.ts`の`menuItems`を使う
  `components/Studio.tsx`の`menuItemEnabled`/`menuItemChecked`参照)。
  「シグナル/メモはコンポーネントファイルで直接宣言する」だけでなく、
  「JSXバインディングに使う式は、そのシグナル/メモの呼び出しを式の中に
  直接書く(関数呼び出しの内側に隠さない)」も合わせて守る。

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
