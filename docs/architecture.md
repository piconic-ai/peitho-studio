# フロントエンド アーキテクチャ原則

`CLAUDE.md`の「純粋関数を好む」「状態はディレクトリ/ファイル構造で区別する」という
原則を、巨大コンポーネント(`components/Studio.tsx`)のリファクタリングを機に、
より具体的な層構成として拡張したもの。実行手順・進捗は`todo/`配下(完了後は削除/
アーカイブ)、ここには**恒久的な原則・ルールのみ**を書く。

## 5層構成

`.ts`=純粋 / `.tsx`=状態あり という2値だけでは、「シグナルは持つがDOM/IPCには
触れない層」「DOMには触れるがシグナルは持たない層」を表現できず、それが結局
すべてを`.tsx`に押し込む圧力になる。ディレクトリで5層に分ける。

| ディレクトリ | 使ってよいもの | 使ってはいけないもの | テスト手段 |
|---|---|---|---|
| `domain/` (`.ts`) | 何にも依存しない純粋関数・ADT・遷移関数・例示データ | `@barefootjs/client`, `@tauri-apps/*`, `document`/`window` | `bun test`(spec / adversarial / property / pairwise) |
| `state/` (`.ts`) | `createSignal`/`createMemo`/`createEffect`/`batch`/`createSelector`、`domain/` | `@tauri-apps/*`、DOM API、JSX | `bun test` + `createRoot`(モデルベーステスト) |
| `ipc/` (`.ts`) | `invoke`/`listen`/`openDialog`の薄い型付きラッパーと境界の型 | シグナル、DOM、ビジネスロジック | 型のみ。e2e用のフェイク実装を同じインターフェースで用意 |
| `dom/` (`.ts`) | DOM計測・スタイル書き込み・イベント購読(iframeサイズ同期、ドラッグジェスチャ、textarea同期) | シグナル、IPC、JSX | 数式部分は`domain/`に押し出して`bun test`。残りはIRテスト/e2e |
| `components/` (`.tsx`) | JSX + 上記4層のimport。合成ルートは「ストア生成・IPC/イベント配線・子の配置」のみ | ビジネスロジック、テキスト操作、状態遷移の判断 | `@barefootjs/test`のIRテスト + Playwright(IPCスタブ) |

依存の向きは `components → state → domain`、`components → ipc`、
`components → dom → domain` の一方向。層をまたぐ禁止importは
`scripts/arch-check.test.ts`で機械的に検出する(`domain/`に`@tauri-apps`が
あれば失敗、`components/`に`invoke(`の直書きがあれば失敗、等)。

## BarefootJSの制約が層構成に課す不変条件

(個別の落とし穴の詳細は`CLAUDE.md`の「BarefootJSで踏んだ落とし穴」を参照。
ここでは、それが今回の層構成の**設計判断**にどう影響したかだけを書く。)

- **Context APIはファイルをまたげない**(バンドルごとに`createContext()`が別
  Symbolになる)ので使わない。親→子は**props**、子→親は**コールバックprops**。
- **子はセッターを受け取らない**。受け取るのは「何が起きたか」を表す
  コールバックだけ(`onSelect(i)`であって`setSelectedIndex`ではない)。
  どの関数がどのシグナルを書くかをストア1箇所に閉じ込め、暗黙の契約が
  複数箇所に散らばるのを防ぐ。
- **読み取りpropsは`Memo<T>`型で公開する**。BarefootJSのリアクティビティ検出は
  `Reactive<T>`ブランド型ベースなので、`Memo<T>`を渡せば別ファイルのJSXから
  読んでも静的にリアクティブと認識される。
- **`Map`/`Set`/`Function`型はpropsに渡せない**(BF049)。コレクションを渡す
  代わりに`(key) => Getter`のようなアクセサ関数を渡す。
- **ローカル関数内にJSXは書けない**(BF045)。「JSXを描画ヘルパー関数に切る」
  形の分割はできない。分割は必ず本物のサブコンポーネントで行う。
- **モジュールスコープの単一シグナルに頼らない**。各`.tsx`は独立したビルド
  チャンクなので、状態共有は合成ルートでファクトリを呼び、テスト時も
  `createRoot`で明示的に所有・破棄する。
- **`const { x } = store`という分割代入でシグナルのgetterを取り出さない**
  (BarefootJSのコンパイラの識別子抽出が分割代入を素通りし、`x`が
  「宣言されていない変数」として扱われて実行時`ReferenceError`になる
  ——`state/xxxStore.ts`のファクトリが`{ draggedIndex, ... }`を返す形
  自体は問題ない。`const store = createXxxStore()`のように受け取り、
  JSX側で`store.draggedIndex()`とプロパティ経由で呼ぶ分には正しく動く
  ことを、`domain/drag.ts`の実装をそのまま使った再現で確認済み——
  一時、逆の教訓(「ファクトリ越しは壊れる」)を誤ってここに書いていた
  ことがあるので注意。実際には動的なリアクティビティ追跡(wrap-by-default)
  が`bf debug graph`の静的解析(`no tracked deps`と出ることがある)より
  広い範囲をカバーする——`bf debug graph`の出力だけで「実機で壊れる」と
  即断せず、疑わしければ実際にブラウザで動かして確認すること)。
- **keyedな`.map()`の行を子コンポーネントに切り出した場合の`index`propsの
  鮮度は、着手前にスパイクで検証してから分割方針を確定する**(過去に
  #2859/#2861のクロージャstaleness系バグを踏んでいるため)。
- **ビュー切替はネストした三項演算子で書かない**(未解決の描画バグの温床)。
  兄弟の単独条件(`{kind() === 'x' ? <X/> : null}`を並べる)か、
  永続マウント + `hidden`クラストグルで書く。

## 状態の流れ: ADT → ストア → memo射影 → props

「状態はADTで一箇所にまとめて表現したいが、コレクション/複合値を1シグナルに
持つと、それを読む全行が再レンダーされる」という背反は、**ADTはロジック側の
真実、購読は射影側**と役割を分けることで解消する。

```
domain/drag.ts        DragState (ADT, 1つの値)      ← 純粋な遷移: arm/move/dropTarget/cancel
        ↓
state/uiStore.ts      const [drag, setDrag] = createSignal<DragState>({kind:'idle'})
                       const draggedIndex = createMemo(() => drag().kind === 'dragging' ? drag().index : null)
                       const isDragged    = createSelector(draggedIndex)
        ↓
components/SlideList   行は isDragged(i) だけ購読 → 無関係な変化(dragDeltaYなど)では再評価されない
```

`createMemo`は出力を`Object.is`比較してから通知するので、ADTの一部分だけが
変わっても、無関係な射影memoへは通知が伝播しない。

## ADTでありえない状態を排除する

型で表現できてしまう「ありえない組み合わせ」(例: `selectedIndex === null`なのに
`bodyDraft !== ''`、`layoutPickerOpen`が空白右クリック時にも開ける)は、
複数の独立したシグナル/フィールドの直積として状態を持つときに必ず発生する。
判別可能なUnion(ADT)で「実際にありうる状態」だけを列挙し、遷移は`switch`の
`_exhaustive: never`で網羅性をコンパイル時に強制する。

```ts
// 悪い例: 5つの独立フィールドの直積(2^5 - 実際にありうるのはごく一部)
interface State { open: boolean; loading: boolean; index: number | null; ... }

// 良い例: ありうる状態だけを列挙
type EditorSession =
  | { kind: 'none' }
  | { kind: 'editing'; index: number; saved: SlideFields; draft: SlideFields }
```

新しい状態/操作を追加するときの変更点は「ADTのvariantを1つ足す」→
「網羅性チェックがコンパイルエラーで未対応箇所を指摘する」→
「例示テストを1件追加する」の3手順に閉じる。これが開放閉鎖原則の実践形。

## Examples by Specification / Given-When-Then

- 例示は**データ**として`domain/<module>.examples.ts`に置く(テストファイルでは
  ない)。これが機能要件のSingle Source of Truth。
- `<module>.test.ts`がその例示を`test.each`で回す(runner)。既存の
  `test('spec: ...')` / `test('adversarial: ...')`命名はそのまま維持し、
  例示由来のテストは`example: ...`プレフィクスにする。
- 自動化できない例には必ず`manual: { reason }`を付ける。「自動化されている」
  「理由付きで手動」のどちらでもない例が存在しないことをテストで検査する。
- `*.spec.ts`は使わない(`bun test`が拾ってしまい`*.test.ts`と二重の慣習に
  なるため)。例示データを非テストファイルに分離しておくと、ドキュメント
  生成の入力としても再利用できる。

DSLと具体的な記述例は`todo/`配下の実行計画、または実装時に`domain/spec.ts`
として導入する。

## 不具合発見手法の方針

自動テストに最大限投資する(手動検証はAI Agentの自律性を損なうため最小化する)。

- **敵対的テスト**: 型ごとに意地悪な値のカタログ(空文字列、HTML/XSS的文字列、
  絵文字・サロゲートペア、境界値のインデックス等)を用意し、OFAT(1点ずつ
  差し替え)で「落ちない」「不変条件を満たす」ことを検証する。
- **ペアワイズテスト**: 独立した軸が3つ以上絡む判断関数(コミット後の選択
  追従、コンテキストメニューの有効/無効判定など)に適用する。
- **プロパティベーステスト**(`fast-check`、`bun test`でそのまま動く):
  往復関数(parse/serialize)の恒等性、変換の不変条件(枚数保存、多重集合保存)
  など、個別の例より「性質」で語れるものに使う。
- **モデルベーステスト**(`fast-check`の`commands`): `state/`層の状態遷移は
  シグナルの読み書きに閉じ、DOM/IPCという外部依存を持たない
  (`createRoot`で決定的に再現できる)ため、純粋なreducerと同じ要領で
  モデルベーステストにかけられる。直近のバグ2件はいずれも「操作列の
  順序とin-flight状態の組み合わせ」が原因だったため、費用対効果が高い。
- **全数/網羅性テスト**: 遷移関数(`decide`など)は状態×イベントの直積が
  現実的な数(数十程度)に収まるなら、全組み合わせを列挙し「必ず有効な
  結果を返す」(例外・undefinedにならない)ことを検査する。
- **IRテスト**(`@barefootjs/test`): 全`.tsx`をコンパイルし、診断ゼロ・
  シグナル一覧・イベント配線をコードとして固定する。BarefootJSの
  コンパイラ制約(BF021/BF045/BF049など)の退行をCIで捕まえる。
- **アーキテクチャテスト**: 上記の層をまたぐimportを機械的に禁止する。

導入したが優先度が低い手法(ミューテーションテスト等)や、個々の敵対的値
カタログの中身は、実装時に該当する`domain/*.ts`/`*.test.ts`自体に置く
(このドキュメントには複製しない)。

## 手動検証にせざるを得ないもの

IME合成中のtextarea同期、WKWebView固有のiframe描画(角のシーム・stale
paint)、iframe上の右クリック奪取、ドラッグ中のiframe通過、ネイティブ
ダイアログ、フォーカス喪失中のドラッグ、複数ウィンドウのpending deck、
`peitho present`の起動——これらは実機Tauriウィンドウでしか確認できない。
`manual: { reason }`付きの例示として台帳化し、検証手順は
`.claude/skills/run-peitho-studio/SKILL.md`を参照する。
