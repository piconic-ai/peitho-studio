# Studio.tsx リファクタリング実行計画

原則・恒久ルールは`docs/architecture.md`を参照。ここは実行計画・進捗の
作業台帳——**完了したら削除ないしアーカイブする**。

設計担当: Fable(Plan)。2026年着手、`git log`で経緯を追える
(`bfa5577`, `fe4aa3f`が直接の動機になった2バグ)。

## 0. 現状分析(2293行時点のスナップショット)

### 0.1 定量

| 項目 | 値 |
|---|---|
| 総行数 | 2293(ロジック ≈1380行、JSX ≈910行) |
| `createSignal` | 35 |
| `createMemo` / `createEffect` | 6 / 5 |
| トップレベル関数 | 51 |
| `invoke()` 呼び出し | 13箇所(11コマンド) |
| サムネイル`<iframe>`の`ref`コールバック | 1634〜1883行、約250行(1関数) |
| TEMPORARYデバッグコード(Cmd+Shift+D) | 268〜398行 + 1260〜1265行、約135行 |
| 全45コミット中Studio.tsxを触ったもの | 35(78%)。`slides.ts`は6、`src-tauri`は4 |

### 0.2 責務クラスタとシグナル/関数の対応

| # | 責務(状態の塊) | シグナル / メモ | 関数(行) | 触れる副作用 |
|---|---|---|---|---|
| A | デッキのライフサイクル(Welcome/Open/New Deck/Recent/ウィンドウ) | `deckPath`, `isBusy`, `recentDecks`, `newDeckModalOpen`, `newDeckParentDir`, `newDeckName` | `loadDeckCore`(592), `loadDeck`(615), `refreshRecentDecks`, `openDeckInNewWindow`, `openDeckPreferringCurrentWindow`, `handleOpenFolder`, `handleNewDeck`, `submitNewDeck`, `onMount`内のpending/dev deck処理(1230〜1246) | `open_deck`, `create_deck`, `open_deck_window`, `get_recent_decks`, `take_pending_deck`, `dev_default_deck`, `openDialog`, `getCurrentWindow().close()` |
| B | レンダー結果(manifest/fragments/canvas/asset URL) | `manifest`, `assetBaseUrl`, `canvasWidth`, `canvasHeight`, `fragmentSignals`(per-key), `sectionStartByIndex` | `applyRenderPayload`(410), `renderPreview` + `previewGeneration`(443), `buildSlideDoc`, `buildSelectedSlideDoc`, `patchSlidePreviewIframes`(539) + effect(557) | `render_draft`, `document.querySelectorAll` |
| C | ソーステキストと範囲 | `fullSource`, `slideRanges` | `refreshSource`(563), `rebuildSource`, `syncedSource`, `currentSlideText`, `existingSlideKeys`, `slideConfigOf` | `read_deck_source` |
| D | エディタセッション(選択+ドラフト) | `selectedIndex`, `bodyDraft`, `noteDraft`, `originalBody`, `originalNote`, `pageConfig`, `selectedRange`, `isDirty`, `selectedSlide`, `selectedSlideKey`; 非リアクティブ: `bodyTextareaEl`, `noteTextareaEl`, `bodyComposing`, `noteComposing` | `syncEditorFields`(212), `currentDraftSource`, `selectSlide`(808), `handleSave`, fast-lane effect(472), slow-lane effect(486), `commitChange`(730) | `render_draft`, `save_deck_source`, textarea DOM |
| E | スライド構造コマンド | `clipboardSlideText`, `sectionDrafts` | `addSlide`, `pasteSlideAfter`, `deleteSlide`, `cutSlide`, `moveSlide`, `reorderSlides`, `updateSlideConfig`, `changeSlideLayout`, `toggleSlideDraft/Skip/Section`, `commitSectionEdit`, `copySlide` | すべて`commitChange`経由 |
| F | ドラッグ並べ替えジェスチャ | `draggedIndex`, `dragOverGap`, `dragDeltaY` | `startSlideDrag`(914〜998) | `window` mouse/blur listeners, `document.body.style` |
| G | コンテキストメニュー/レイアウトピッカー | `contextMenu`, `layoutPickerOpen`, `layoutPreviews`, `layoutPreviewCss`, `layoutPickerView`; `contextMenuEl` | `openContextMenu`, `closeContextMenu`, `contextMenuAppendIndex`, `loadLayoutPreviews`, 画面内クランプeffect(1027) | `preview_layouts`, `getBoundingClientRect`, `requestAnimationFrame` |
| H | 外部変更/キーボード/Present/カラム幅 | `presentMenuOpen`, `slideListWidth`, `editorWidth` | `handleExternalChange`(1192), `onKeyDown`(1259〜1329), `handlePresent`, `startResize` | `deck-file-changed`/`menu:new-deck` listen, `window.confirm`, `present_deck` |
| I | 通知/デバッグ | `statusMessage`, `errorMessage`, `errorMessageCopied` | `copyErrorMessage`, 自動消去effect(254); ~~TEMPORARY: `rectToPlain`, `scanColumn`, `scanRow`, `copyThumbnailDebugSnapshot`~~(Step 1で削除済み——このコミットで) | `navigator.clipboard` |
| J | サムネイルiframeの実装詳細(JSX内) | — | `ref`コールバック(1634〜1883): サイズ同期`syncIframeSize`, `ResizeObserver`, overscan/clip-path; オーバーレイ`ref`(1952〜1980) | DOM計測・スタイル書き込み |

### 0.3 コード上に型として存在しない「暗黙の契約」(バグの温床)

| 契約 | どこに書かれているか | 破られたときの症状 |
|---|---|---|
| `loadDeckCore`は呼び出し側が`isBusy`を保持していること | コメント(584〜591) | `bfa5577`のバグ(New Deckが無反応) |
| `commitChange(_, focusIndex)`の`focusIndex`は「現在選択中のスライドの移動後の位置」であって「変更対象の位置」ではない | コメント(751〜759, 893〜900) | `fe4aa3f`のバグ(未保存編集の消失) |
| `applyRenderPayload`はfragment→asset→canvas→manifestの順にセットしなければならない | コメント(411〜420) | 新規行のiframeが空fragmentを永久に捕まえる |
| `syncEditorFields()`はドラフトを非タイピング経路で変えた直後に必ず呼ぶ | コメント(202〜211) | textareaと状態の乖離 |
| `selectSlide`は選択前に必ず`handleSave`でフラッシュする | 本文(810) | 編集消失 |
| `isBusy`は「デッキ読込中」と「保存中」の両方を意味する | 暗黙 | `handleExternalChange`が保存中も無視、slow-laneが読込中も再試行 |
| `contextMenu.index === null`のとき per-slide操作は無効 | JSXの`disabled`が個別に9箇所で判定 | 1箇所の書き漏れで`contextMenu()!.index!`が`null!`になる |
| `layoutPickerOpen`は`contextMenu !== null`かつ`index !== null`のときだけ真であるべき | 暗黙(`closeContextMenu`で同時にfalse) | 空白右クリック→Change Layout(disabled)だが状態は残りうる |
| `sectionDrafts[i]`は`sectionStartByIndex()[i]`が存在する`i`にしか意味がない | 暗黙 | 並べ替え後に古いindexのドラフトが残る可能性 |

これらはすべて「複数の関数が同じシグナル群に暗黙に依存している」ことに起因する。
`docs/architecture.md`のADT原則で、この契約を型と例示テストに移す。

## 1. 提案するファイル構成

```
domain/                          # 純粋(既存 slides.ts / previewDoc.ts をここへ移動)
  slides.ts, slides.test.ts, previewDoc.ts, previewDoc.test.ts
  pageConfig.ts                  # PageConfig ADT + parse/serialize(2.5)
  editorSession.ts               # EditorSession ADT + SelectionPlan + reducer(2.1)
  editorSession.examples.ts      # Given-When-Then 例示データ(3章)
  deckLifecycle.ts (+examples)   # DeckLifecycle ADT + transition(2.2)
  slideCommands.ts (+examples)   # SlideCommand ADT: insert/delete/move/replace
  contextMenu.ts (+examples)     # ContextMenu ADT + menuItems()(2.3)
  drag.ts (+examples)            # DragState ADT + dropTarget()/gapToIndex()(2.4)
  keyboard.ts (+examples)        # KeyInfo -> UiCommand | null の純粋な表引き
  geometry.ts                    # fitBox(), clampMenuPosition() など数式
  render.ts                      # Manifest/RenderPayload の型、sectionDraftsFrom(manifest)
  spec.ts                        # defineExamples() DSL(3章)
state/
  deckStore.ts                   # createDeckStore(ipc): lifecycle + recent + newDeck
  renderStore.ts                 # createRenderStore(): manifest/canvas/asset/fragmentOf(per-key)
  editorStore.ts                 # createEditorStore(deps): session + commit + autosave lanes
  uiStore.ts                     # contextMenu / drag / present menu / widths(小さいので1つ)
  *.test.ts                      # モデルベース(fast-check commands)+ spec
ipc/
  deckIpc.ts                     # interface DeckIpc + createTauriDeckIpc()(11コマンド + 2イベント)
  fakeDeckIpc.ts                 # e2e/テスト用のインメモリ実装
dom/
  thumbnailIframe.ts             # mountThumbnailIframe(el, {canvas, fragmentHtml, ...}) — 現1634〜1883行
  borderOverlay.ts               # 現1952〜1980行
  dragGesture.ts                 # startDrag(el, callbacks): mouse/blur購読 + body style — 現914〜998行の副作用部
  slidePreviewPatch.ts           # patchSlidePreviewIframes — 現539〜555行
  textareaSync.ts                # IME安全なvalue同期 — 現186〜215行
  columnResize.ts                # 現1349〜1381行
components/
  Studio.tsx                     # 合成ルート(目標 200〜300行)
  studio/
    WelcomeScreen.tsx            # 現1385〜1446行
    NewDeckModal.tsx             # 現2243〜2290行
    DeckHeader.tsx                # 現1449〜1508行(Present + メニュー)
    SlideList.tsx                # 現1511〜1992行(行はインライン、iframeは dom/ 経由)
    SlideEditor.tsx               # 現1999〜2036行
    SlidePreview.tsx              # 現2043〜2056行
    SlideContextMenu.tsx          # 現2088〜2239行(永続マウントを維持)
    StatusBar.tsx                 # 現2059〜2073行
  studio/__tests__/*.test.ts     # @barefootjs/test IRテスト
e2e/
  tauriStub.ts                   # window.__TAURI_INTERNALS__.invoke をフェイクIPCに接続
  editor.e2e.ts                  # Welcome以降のシナリオ
scripts/
  spec-doc.ts                    # *.examples.ts -> docs/spec/*.md 生成(導入するかは6章参照)
  arch-check.test.ts             # レイヤー違反検出
```

## 2. ADT設計案(詳細)

### 2.1 エディタセッション(バグ`fe4aa3f`の根本対策)

```ts
// domain/editorSession.ts
export interface SlideFields { body: string; note: string; config: PageConfig }

export type EditorSession =
  | { kind: 'none' }
  | { kind: 'editing'; index: number; saved: SlideFields; draft: SlideFields }

export const isDirty = (s: EditorSession): boolean =>
  s.kind === 'editing' && !fieldsEqual(s.saved, s.draft)

/** 変更コミット後に「選択をどうするか」を、呼び出し側が意図として明示する */
export type SelectionPlan =
  | { kind: 'keep' }                                   // 保存・セクション編集: 動かさない
  | { kind: 'follow-move'; from: number; to: number }  // 並べ替え: indexAfterMove で追従
  | { kind: 'select'; index: number }                  // 追加・貼り付け: 新しいスライドへ
  | { kind: 'clamp-after-delete'; deleted: number }    // 削除: 詰めた位置へ

export function selectionAfter(plan: SelectionPlan, current: number | null, count: number): number | null {
  switch (plan.kind) {
    case 'keep':               return current !== null && current < count ? current : firstOrNull(count)
    case 'follow-move':        return current === null ? plan.to : indexAfterMove(current, plan.from, plan.to)
    case 'select':             return Math.min(plan.index, count - 1)
    case 'clamp-after-delete': return count === 0 ? null : Math.min(plan.deleted, count - 1)
    default: { const _x: never = plan; throw new Error(String(_x)) }
  }
}

/** commitChange の「飛行中に選択/ドラフトが変わっていたら上書きしない」規則を純粋化 */
export function reconcileAfterCommit(
  before: EditorSession, now: EditorSession,
  ranges: readonly SlideRange[], plan: SelectionPlan, expected?: Pick<SlideFields, 'body' | 'note'>,
): EditorSession
```

### 2.2 デッキのライフサイクル(バグ`bfa5577`の根本対策)

```ts
// domain/deckLifecycle.ts
export type DeckLifecycle =
  | { kind: 'welcome' }
  | { kind: 'naming-new-deck'; parentDir: string; name: string }
  | { kind: 'creating'; parentDir: string; name: string }
  | { kind: 'opening'; path: string }
  | { kind: 'open'; deckPath: string }

export type DeckEvent =
  | { type: 'open-requested'; path: string }
  | { type: 'new-deck-requested'; parentDir: string }
  | { type: 'name-changed'; name: string }
  | { type: 'create-confirmed' }
  | { type: 'create-cancelled' }
  | { type: 'created'; path: string }
  | { type: 'opened'; deckPath: string }
  | { type: 'failed'; message: string }

export type Decision =
  | { kind: 'transition'; next: DeckLifecycle; effect?: 'invoke-open' | 'invoke-create' | 'spawn-window' }
  | { kind: 'rejected'; reason: 'busy' | 'already-open' | 'invalid-name' | 'not-applicable' }

export function decide(state: DeckLifecycle, event: DeckEvent): Decision {
  switch (state.kind) {
    case 'welcome':
      if (event.type === 'open-requested') return { kind: 'transition', next: { kind: 'opening', path: event.path }, effect: 'invoke-open' }
      // ...
    case 'creating':
      if (event.type === 'created') return { kind: 'transition', next: { kind: 'opening', path: event.path }, effect: 'invoke-open' }  // バグはここが型で強制される
      if (event.type === 'open-requested') return { kind: 'rejected', reason: 'busy' }
      // ...
    case 'open':
      if (event.type === 'open-requested') return { kind: 'transition', next: state, effect: 'spawn-window' }
      // ...
    default: { const _x: never = state; throw new Error(String(_x)) }
  }
}
```

`isBusy`は`createMemo(() => ['opening','creating'].includes(lifecycle().kind))`の
派生値になり、誰も直接書けなくなる。呼び出し順序を型で縛る補助としてブランド型:

```ts
// state/deckStore.ts
declare const busyBrand: unique symbol
type BusyScope = { readonly [busyBrand]: true }
async function withBusy<T>(run: (scope: BusyScope) => Promise<T>): Promise<T>
async function runOpen(scope: BusyScope, path: string): Promise<void>  // scope なしでは呼べない
```

### 2.3 コンテキストメニューとレイアウトピッカー

```ts
// domain/contextMenu.ts
export type LayoutPreviewCache =
  | { kind: 'not-loaded' } | { kind: 'loading' }
  | { kind: 'loaded'; previews: LayoutPreview[]; css: string }
  | { kind: 'failed' }

export type ContextMenu =
  | { kind: 'closed' }
  | { kind: 'on-empty-space'; x: number; y: number }
  | { kind: 'on-slide'; index: number; x: number; y: number; layoutPickerOpen: boolean }
  // layoutPickerOpen は on-slide にしか存在しない = 空白右クリックでピッカーが開くのを型で禁止

export type MenuAction =
  | 'new-slide' | 'cut' | 'copy' | 'paste' | 'delete' | 'change-layout'
  | 'toggle-draft' | 'toggle-skip' | 'toggle-section' | 'move-up' | 'move-down'

export interface MenuItem { action: MenuAction; enabled: boolean; checked?: boolean }

export function menuItems(menu: ContextMenu, ctx: { slideCount: number; hasClipboard: boolean; configOf: (i: number) => PageConfig }): MenuItem[]
export function appendIndex(menu: ContextMenu, slideCount: number): number
```

### 2.4 ドラッグ状態

```ts
// domain/drag.ts
export type DragState =
  | { kind: 'idle' }
  | { kind: 'armed'; index: number; startX: number; startY: number }   // mousedown 済み、4px 未満
  | { kind: 'dragging'; index: number; gap: number; deltaY: number }

export function arm(index: number, x: number, y: number): DragState
export function move(s: DragState, x: number, y: number, gapUnderCursor: number): DragState
export function dropTarget(s: DragState): { from: number; to: number } | null
export function cancel(): DragState
```

### 2.5 PageConfig(peitho-coreの制約を型に)

`pageConfig: Record<string, unknown>`は`mizzy/peitho`の
`#[serde(deny_unknown_fields)] struct PageComment { key, layout, section, time, draft, skip, page_number }`
(`crates/peitho-core/src/parser.rs` 33〜44行)に対応。未知キーはpeithoが拒否し、
`section`/`time`は必ずペア。

```ts
// domain/pageConfig.ts
export interface PageConfig {
  key?: string
  layout?: string
  section?: { name: string; time: string }   // ペア制約を構造で表現
  draft?: boolean
  skip?: boolean
  page_number?: boolean
}
export type ParsedPageComment =
  | { kind: 'absent' }
  | { kind: 'ok'; config: PageConfig }
  | { kind: 'malformed'; raw: string }        // 現状は {} に潰して情報を失っている
export function parsePageComment(raw: string): ParsedPageComment
export function serializePageConfig(c: PageConfig): Record<string, unknown>
```

### 2.6 開放閉鎖: スライド操作を`SlideCommand`に統一する

```ts
// domain/slideCommands.ts
export type SlideCommand =
  | { type: 'insert'; at: number; text: string }
  | { type: 'delete'; index: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'replace'; index: number; text: string }

export function applyCommand(texts: readonly string[], cmd: SlideCommand): string[]
export function needsTimeResync(cmd: SlideCommand): boolean
export function selectionPlanFor(cmd: SlideCommand): SelectionPlan
export function validate(texts: readonly string[], cmd: SlideCommand): Rejection | null
```

## 3. Given-When-Then サンプル

`domain/spec.ts`のDSL(`docs/architecture.md`参照)を使う例:

```ts
// domain/editorSession.examples.ts
export const selectionExamples = defineExamples<
  { session: EditorSession; count: number }, SelectionPlan, number | null
>('selectionAfter', [
  {
    id: 'reorder-other-slide-keeps-open-slide',
    given: 'スライド1を開いて未保存の編集がある(全4枚)',
    when:  'スライド3をドラッグして先頭(0)に落とす',
    then:  '選択は「元のスライド1」に追従して index 2 になる(ドロップ先の 0 ではない)',
    state: { session: editing(1, saved, dirty), count: 4 },
    event: { kind: 'follow-move', from: 3, to: 0 },
    expect: 2,
    tags: ['bug-regression'],   // fe4aa3f
  },
  // ... (reorder-the-open-slide-follows-itself, delete-last-clamps 等)
])
```

```ts
// domain/deckLifecycle.examples.ts
export const lifecycleExamples = defineExamples<DeckLifecycle, DeckEvent, Decision>('DeckLifecycle', [
  {
    id: 'created-then-opens-in-same-window',
    given: 'Welcome画面から New Deck を確定して作成中(creating)',
    when:  'create_deck が成功して path が返る(created)',
    then:  'opening に遷移し、invoke-open が実行される(busy 扱いで無視されない)',
    state: { kind: 'creating', parentDir: '/tmp', name: 'talk' },
    event: { type: 'created', path: '/tmp/talk/deck.md' },
    expect: { kind: 'transition', next: { kind: 'opening', path: '/tmp/talk/deck.md' }, effect: 'invoke-open' },
    tags: ['bug-regression'],   // bfa5577
  },
  {
    id: 'pending-deck-failure-closes-window',
    given: 'open_deck_window で生成されたウィンドウが pending deck を開こうとして失敗した',
    when:  'failed を受ける',
    then:  'そのウィンドウは自分自身を閉じる',
    state: { kind: 'opening', path: '/gone/deck.md' },
    event: { type: 'failed', message: 'deck file not found' },
    expect: { kind: 'transition', next: { kind: 'welcome' }, effect: undefined },
    manual: { reason: 'ウィンドウを閉じる副作用(getCurrentWindow().close())はTauri実機でのみ検証可能。遷移自体は自動検証する' },
  },
  // ...
])
```

## 4. 敵対的テスト/ペアワイズの詳細カタログ

### 4.1 意地悪な値カタログ(実装時は`domain/adversarial.ts`)

| 型/領域 | 値 |
|---|---|
| 文字列一般 | `''`, `' '`, `'\n'`, `'<b>&"\'</b>'`, `'😊'`(サロゲートペア), `'日本語'`, ゼロ幅スペース, RTL override, `'\r\n'`混在, BOM, 10万文字, `'__proto__'`, `'constructor'` |
| Markdown/スライドテキスト | `'---'`のみ, 末尾空白付き`'--- '`, フェンス未閉じ, `<!--`未閉じ, PageComment2つ, 見出しなし, 見出しがフェンス内のみ, `'# '`(空見出し) |
| PageConfig JSON | `{}`, `{"section":"x"}`(time欠落), `{"draft":"true"}`(型違い), `{"unknown":1}`(peitho拒否), `null`, `[]`, 数値 |
| duration | `'0s'`, `'1m0s'`, `'1m 30s'`, `'1.5m'`, `'-1s'`, `' 1m '`, 全角 |
| インデックス(number) | `-1`, `0`, `len-1`, `len`, `len+1`, `NaN`, `Infinity`, `1.5`, `-0` |
| 個数/配列 | `[]`, 1要素, 重複key, 逆順, 1000要素 |
| null許容 | `null`, `undefined`, フィールド自体の欠落を別の点として扱う |
| パス | `''`, 末尾スラッシュ, スペース含む, 日本語, 存在しない |
| キャンバス寸法 | `0`, `1`, `99999`, 非整数, 縦長 |
| ジェスチャ座標 | 0px, 3.99px(閾値未満), 4px, 負方向, 全行の中心より下 |

適用はOFAT(1点ずつ差し替え)。

### 4.2 ペアワイズが効く箇所

| 対象(純粋化後) | 軸 |
|---|---|
| `reconcileAfterCommit` | 飛行中に選択が変わった{no,yes} × 飛行中にタイプした{no,yes} × plan{keep,follow-move,select,clamp} × expectedDraft{given,omitted} × 結果の枚数{減,同,増} |
| `decide`(DeckLifecycle) | 状態5種 × イベント8種(40通りなので全数でよい) |
| `menuItems` | target{slide,empty} × clipboard{empty,has} × slideCount{1,2+} × 位置{first,middle,last} × config(draft/skip/sectionの有無) |
| `handleExternalChange`純粋化後 | deck{closed,open} × busy{no,yes} × 変更{same,changed} × dirty{no,yes} × 選択の有効性{valid,out-of-range,none} × confirm{discard,keep} |
| `keyboardCommand` | フォーカス{input,none} × 枚数{0,n} × 選択{none,some} × 修飾{none,meta,meta+shift} × キー × テキスト選択{none,some} |
| `nextIndexAfterRefresh` | preserve{t,f} × current{null,valid,out-of-range} × ranges{0,n} |

生成器は決定的シードのgreedy covering arrayを`test/pairwise.ts`として自作(外部依存不要)。

### 4.3 プロパティベーステスト候補

- `splitSlides`: 各rangeの`source.slice(start,end) === text`
- `joinSlideTexts(prefix, splitSlides(s).map(r => r.text), suffix)`の再分割で枚数不変
- `extractNote`/`injectNote`、`buildSlideText`/`parsePageComment`の往復
- `indexAfterMove(i, from, to)`は「恒等配列に実際のspliceを適用」するオラクルと一致
- `selectionAfter`は常に`null`か`[0, count)`の範囲内
- `applyCommand`は`move`で多重集合を保存、`insert`/`delete`で長さが±1
- `uniqueSlideKey(base, keys)`は`keys`に含まれず冪等
- `formatDurationMs ∘ parseDurationToMs`は秒単位で恒等

## 5. 段階的移行計画

各PRは「振る舞いを変えない」か「1つのADTを導入する」のどちらか一方だけにし、
diff 300行以下を目安にする。すべてのPRで共通の検証: `bun run typecheck`、
`bun test`、`bun run build`、IR「診断ゼロ」テスト、e2eスモーク。

- [x] **Step 0a**(スパイク、マージ済みコードなし)完了。`state/spikeStore.ts`
      (createSignal + createSelector)から`components/spike/SpikeList.tsx`
      (親)→`components/spike/SpikeRow.tsx`(別ファイルの子、keyed `.map()`の
      行)へ、生の`index: number`propsと`Reactive<>`型の関数props
      (`label: () => string`, `isSelected: (i) => boolean`)を渡す構成で検証。
      - `bun run build`: 診断エラーなし、2つの独立チャンクとして正常コンパイル。
      - `bf debug loops`: `SpikeRow index <- i`、`SpikeRow label <- item`は
        静的に追跡される。一方`SpikeRow`自身の`bf debug graph`では
        `props.label()`/`props.isSelected(props.index)`の呼び出しは
        `(no tracked deps)`——静的グラフには乗らない。
      - **実機(Playwright, e2e/spike.e2e.ts, 削除済み)で動作検証**:
        (a) `Item A`を末尾に回転(shuffle)後、同じkeyのDOMノードが新しい
        index `3`を正しく報告する(stale indexにならない) — PASS。
        (b) 行1をクリックして`selectedIndex`を変更すると、子コンポーネント内
        `props.isSelected(props.index)`の表示が正しく再描画される
        (静的に`no tracked deps`でもwrap-by-defaultの動的追跡で機能する) — PASS。
      - **結論**: 行を本物の子コンポーネントに切り出す方針(2.2-3, 2.4)は、
        このシンプルなケースでは安全。リスク1・2(下記6章)は解消。
        ただし実際の`SlideList`の行はiframe/ドラッグ/セクションヘッダーを
        含みさらに複雑なので、Step 7(drag)着手時に同様の検証を継続する。
- [x] **Step 0b**完了。`fast-check`追加、`domain/spec.ts`
      (`defineExamples`/`isExhaustivelyAccountedFor`)、`test/pairwise.ts`
      (決定的greedy pairwiseジェネレータ——実装時に無限ループを実際に踏んで
      修正: 全パラメータを同時に貪欲選択すると最初のパラメータが固定され
      進行しない。未カバーペアを1つシードにする方式に変更)、
      `scripts/arch-check.test.ts`(レイヤー違反をパターンマッチで検出、
      実際に違反を注入して検出できることを確認済み)。`domain/`/`state/`
      /`ipc/`はまだ空(spec.tsのみ)なので、`components/`への
      `invoke(`直書き禁止ルールはStep 3(ipc/導入)以降に追加する。
- [x] **Step 1**完了。TEMPORARYデバッグスナップショット
      (`rectToPlain`/`scanColumn`/`scanRow`/`copyThumbnailDebugSnapshot`と
      Cmd+Shift+Dショートカット)を削除、-138行。root-caused済みで
      「remove once root-caused」と明記されていたため隔離ではなく削除。
      挙動不変(typecheck/test/build全通過、バンドルサイズ88.46kB→85.72kB)。
- [x] **Step 2**完了。`slides.ts`/`slides.test.ts`/`previewDoc.ts`/
      `previewDoc.test.ts`を`domain/`へ移動。`scripts/arch-check.test.ts`が
      即座に`previewDoc.ts`の誤検知(生成HTML文字列内の`document.`/`window.`
      リテラル)を検出——ファイル単位ではなくパターン単位の
      `// arch-check-allow: <pattern>`opt-outで対応し、他の禁止パターンは
      引き続き検出されることを確認済み。
- [x] **Step 3**完了。`ipc/deckIpc.ts`(`DeckIpc`インターフェース、11コマンド
      +2イベント、`createTauriDeckIpc()`)。`Studio.tsx`の13箇所の
      `invoke`/`listen`直書きを`deckIpc.xxx()`呼び出しに置換、インライン
      定義されていた型(`Manifest`/`RenderPayload`/`DeckSessionInfo`等)も
      移動。`ipc/fakeDeckIpc.ts`(spec/adversarialテスト付き、将来の
      state層モデルベーステスト用)。`scripts/arch-check.test.ts`に
      `components/`の`@tauri-apps/api/core`/`.../event`直接import禁止を
      追加(Step 0bで先送りしていた項目)——実際に違反を注入して検出を確認済み。
      `@tauri-apps/plugin-dialog`/`.../window`は未対応のまま残す(Welcome画面
      /ウィンドウ操作は別ステップ)。
- [x] **Step 4**完了(一部は後続ステップへ委譲、下記参照)。
      `domain/slides.ts`に`clampFocusIndex`(旧`nextIndexAfterRefresh`——
      `refreshSource`と`commitChange`が微妙に違う候補値で同じ三項演算子
      チェーンを重複させていたのを1関数に統合)と`gapToIndex`
      (旧970行相当のドラッグ&ドロップのgap→to変換)。
      `domain/geometry.ts`(新規)に`clampMenuPosition`。
      `domain/render.ts`(新規)に`sectionStartByIndex(sections)`——
      あわせて`Manifest`/`ManifestSection`/`ManifestSlide`型を
      `ipc/deckIpc.ts`(Step 3で一時的にそこへ置いていた)からこちらへ移動
      (依存方向`ipc→domain`を正しくするため。`scripts/arch-check.test.ts`
      に`domain`が`ipc/`をimportすることを禁止するルールを追加、実際に
      違反を注入して検出を確認済み)。
      全て spec + adversarial テスト付き。
      **後続ステップへ委譲**: `fitBox`(DOM計測と密結合した
      `syncIframeSize`の一部——Step 12〜18のJSX/`dom/`分割まで見送る方が
      安全)、`appendIndex`(`contextMenuAppendIndex`——Step 8の
      `domain/contextMenu.ts`で本格的に扱う)、`keyboardCommand`
      (`onKeyDown`——Step 9のeditorStore整理時に統合)、
      `externalChangePlan`(`handleExternalChange`——同じくStep 9)。
- [x] **Step 5**完了。`domain/pageConfig.ts`(`PageConfig`型 +
      `ParsedPageComment` ADT `absent`/`ok`/`malformed` + `parsePageComment`/
      `configOf`/`serializePageConfig`、spec+adversarialテスト付き)。
      設計時の想定(§2.5、`section?: { name; time }`というネスト構造)は
      実装時に`mizzy/peitho`の実際の`PageComment`struct
      (`crates/peitho-core/src/parser.rs`)を確認したところ誤りと判明
      ——`section`/`time`は独立したフラットな`Option<String>`
      /`Option<PlannedTime>`で、ペア制約はこのアプリのUI側の運用規約に
      すぎない。実データに合わせて`PageConfig`はフラットな型にした。
      `domain/slides.ts`の`extractPageComment`/`updatePageComment`/
      `buildSlideText`の`config`引数・戻り値を`Record<string, unknown>`
      から`PageConfig`/`Partial<PageConfig>`に厳密化(ロジック自体は
      `pageConfig.ts`の関数に委譲)。リファクタリング中に`rest`の計算を
      誤ってtry/catchの外に出してしまい、malformedなPageCommentを
      誤って除去してしまう回帰を作りかけたが、既存の
      `adversarial: malformed JSON is left in place`テストが即座に
      検出——修正して全テスト通過。`components/Studio.tsx`の
      `pageConfig`シグナル/`slideConfigOf`/`updateSlideConfig`も
      `PageConfig`/`Partial<PageConfig>`に追従。
- [x] **Step 6**完了。`domain/editorSession.ts`(新規、Step 9の§2.1が
      本来の置き場所だが、`SelectionPlan`型 + `selectionAfter`だけを
      前倒し——`EditorSession`ADT本体/`reconcileAfterCommit`はStep 9で
      追加)と`domain/slideCommands.ts`(`SlideCommand`ADT
      insert/delete/move/replace + `applyCommand`/`needsTimeResync`/
      `selectionPlanFor`/`validate`、2.6)。
      `commitChange`の引数を`focusIndex: number | null`から
      `plan: SelectionPlan`に変更、`Studio.tsx`の
      `deleteSlide`/`addSlide`/`pasteSlideAfter`/`reorderSlides`/
      `updateSlideConfig`をそれぞれ`SlideCommand`の組み立て+
      `validate`/`applyCommand`/`selectionPlanFor`呼び出しに統一
      (各関数が個別に持っていたガード節・`splice`・選択位置の三項演算子を
      解消)。`needsTimeResync`で`syncedSource`/`rebuildSource`の
      使い分けも1箇所(`sourceFor`)に集約。
      実装中に見つけたバグ: `selectionAfter`の`clamp-after-delete`/
      `select`を`keep`と同じ`clampFocusIndex`(範囲外なら**先頭**に
      フォールバック)で統一しようとしたが、既存の`deleteSlide`の
      `Math.min(index, texts.length - 1)`は範囲外なら**末尾**にクランプ
      する意味論——最後のスライドを消すと選択が先頭に飛ぶ回帰になる
      ところだった。テストを書く前に手計算で気づいて修正、
      `keep`/`follow-move`(先頭フォールバック)と
      `select`/`clamp-after-delete`(末尾クランプ)を意図的に別ロジックの
      ままにした。全spec/adversarialテスト通過(159 pass)。
      pullfrogのレビューコメントでもう1つ発見: `updateSlideConfig`
      (コンテキストメニューでの他スライドのレイアウト/draft/skip/section
      切り替え)は旧実装だと`commitChange(source, index)`——`index`は
      *変更対象*のスライド——を渡しており、変更対象が選択中と別のスライド
      だと選択がそちらへ勝手に移動するバグがあった。新しい
      `selectionPlanFor({type:'replace',...}) = {kind:'keep'}`は
      *現在選択中*のスライドを維持するので、副作用としてこのバグを修正
      している。todo 44行目の不変条件(「選択は現在選択中のスライドの
      行き先を追従すべきで、変更対象を追従すべきでない」)に照らして
      pullfrogが「correction, not a new bug」と判定——狙って直したのでは
      なく、設計の統一の副産物。
      **実機確認**: ロック解除後に実施。`addSlide`(右クリック→New Slide)
      は2回とも正しく新規スライドを挿入・選択(`select`プランが機能)。
      ドラッグ中のフローティング表示(`be02610`)も正常。一方、
      コンテキストメニュー項目のクリック(Mark as Draft等)・
      Forward Deleteキー・ドラッグのmouseup後の並べ替え結果は、この
      環境のGUI自動操作(cliclick/osascriptによるイベント合成)がネイティブ
      メニューやOSレベルのドラッグ処理に届かず、確認できなかった
      (`updateSlideConfig`/`deleteSlide`/`reorderSlides`の実機での動作
      そのものはユニットテストと`addSlide`の成功で間接的に裏付けられて
      いるが、目視での完全な実機確認ではない)。自動化の限界であって
      アプリ側の不具合ではないと判断し先に進めるが、次に人手で操作する
      機会があれば右クリックメニュー経由の操作を一通り触っておきたい。
- [x] **Step 7**完了。`domain/drag.ts`(`DragState`ADT
      idle/armed/dragging + `arm`/`move`/`dropTarget`/`cancel`)と
      `dom/dragGesture.ts`(`gapUnderCursor`/`attachDragListeners`/
      `setDragAffordance`——DOM依存部分のみ)。`startSlideDrag`の
      手組みmousedown/mousemove/mouseupクロージャと3つの緩く関連する
      シグナル(`draggedIndex`/`dragOverGap`/`dragDeltaY`)を、1つの型付き
      状態機械+薄いDOM層に置き換え。`scripts/arch-check.test.ts`に新設の
      `dom/`層ルール(シグナル禁止・Tauri IPC禁止)を追加、違反注入で検出を
      確認済み。
      **重大な発見(CLAUDE.mdに記録済み)**: 当初`state/uiStore.ts`に
      `createDragStore()`ファクトリ(シグナル+3つのmemoを`{draggedIndex,
      ...}`として返す設計、todoのディレクトリ構成案どおり)を実装したが、
      実機で動作せず——`bf debug graph`で調べると該当バインディングの
      `deps`が空(`no tracked deps`)だった。BarefootJSのコンパイラは
      「コンポーネント自身のソースにリテラルで書かれた`createSignal`/
      `createMemo`呼び出し」だけを静的解析しており、関数呼び出しの
      戻り値をたどってシグナルの出所を追わない。`const { x } = store`の
      分割代入は`ReferenceError`で即落ち、`const x = store.x`という
      単純代入でも`deps: []`のまま改善しなかった。シグナル宣言を
      `Studio.tsx`側に戻し(`domain/drag.ts`の状態遷移関数はそのまま
      呼ぶ)て解決。**Step 9/10/11の`state/`層(editorStore.ts/
      deckStore.ts/renderStore.ts)も同じ制約を受ける**——シグナル/メモは
      使うコンポーネントファイルに直接書く前提で設計すること
      (`state/`は「ロジック」ではなく「グルーコード」の置き場という
      位置づけに修正が必要かもしれない)。
      実機確認: ロック解除後に実施(既に解除済みの状態で継続)。
      `dispatchEvent`によるJS直接テストでロジック自体を確認、その後
      物理`cliclick`ドラッグでも並べ替え・保存まで成功を確認
      (`.claude/skills/run-peitho-studio/SKILL.md`に追記した
      「DevToolsのInspect Elementモードが有効だと物理クリックが
      アプリに届かない」問題を検証中に発見・回避)。
      全spec/adversarialテスト通過(173 pass)。
      **【後日訂正】上記の「重大な発見」は誤りだった。** Step 9完了後、
      `domain/drag.ts`の実装をそのまま使い、当時の`createDragStore()`
      ファクトリ+keyed `.map()`+複数memo呼び出しを含む複雑な式を
      正確に再現した最小コードで、DevToolsを使わずPlaywright経由で
      実際にブラウザ動作を確認したところ、**ファクトリ越しでも正しく
      動的に更新された**。つまり「ファクトリ経由だと動かない」は誤り
      ——当時の「実機で動かない」という観察自体は事実だが、原因は
      別(おそらく後で見つけたDevToolsのInspect Elementモードの干渉)
      だった可能性が高い。`bf debug graph`の`no tracked deps`は静的
      解析結果であり、BarefootJSの動的リアクティビティ追跡
      (wrap-by-default)がそれより広くカバーするため、実行時の動作を
      保証しない。CLAUDE.md/docs/architecture.mdは訂正済み。実際に
      確認できた本物の制約は「分割代入(`const { x } = store`)で
      `ReferenceError`になる」の1点のみ。**`state/uiStore.ts`のような
      ファクトリパターンは実際には使える**——Step 9で
      `state/editorStore.ts`を作らなかった判断も再考の余地があるが、
      現状の実装(シグナル直接宣言)も実証済みで問題ないため、無理に
      巻き戻さず現状維持とする。Step 10以降は`state/`ファクトリ
      パターンも選択肢に入れてよい。
- [x] **Step 8**完了。`domain/contextMenu.ts`(`ContextMenu`ADT
      closed/on-empty-space/on-slide + `MenuAction`/`MenuItem` +
      `menuItems`/`indexOf`/`positionOf`/`isLayoutPickerOpen`/
      `appendIndex`)。旧`contextMenu: {index,x,y}|null`
      シグナルと独立した`layoutPickerOpen`シグナルを1つの`ContextMenu`
      ADTに統合——`layoutPickerOpen`は`on-slide`にしか存在しないため、
      空白右クリックでピッカーが開く状態が型で排除される。JSXに11個
      散らばっていた`disabled={contextMenu()?.index === null || ...}`
      式を`menuItems(contextMenu(), ctx)`1箇所に集約。
      **Step 7の制約の亜種をここでも踏んだ(CLAUDE.mdに追記済み)**:
      `menuItemEnabled(action)`のように内部で`currentMenuItems()`memoを
      読むヘルパー関数をJSXから`disabled={!menuItemEnabled('cut')}`と
      呼んだところ、`bf debug graph`で`deps: []`——ヘルパー関数の呼び出し
      自体はJSX式に書かれているが、その中で読むmemo呼び出しはJSX式の
      ソースに現れないため追跡されない。`menuItemEnabled(items, action)`
      のように**メモの呼び出し結果を引数として渡す**
      (`disabled={!menuItemEnabled(currentMenuItems(), 'cut')}`)形に
      直して解決。「シグナル/メモはコンポーネントファイルで直接宣言」
      だけでなく「JSXバインディングの式にその呼び出しを直接書く」も
      合わせて必要と判明——Step 9以降も同じ注意が要る。
      `bf debug graph`で全disabled/conditionalバインディングの`deps`に
      `currentMenuItems`/`contextMenu`が乗ることを確認。
      全spec/adversarialテスト通過(189 pass)。
      **実機確認は保留**——確認しようとした時点でmacOSが再びロック中
      だったため、静的検証(typecheck/test/build/`bf debug graph`)のみで
      進めた。
      **【後日訂正】上記の「Step 7の制約の亜種」も誤りだった。** Step 9
      完了後の再検証(下記Step 7の訂正注記参照)で、ヘルパー関数が内部で
      memoを読む形(`createMemo`+`function f() { return memo() }`+
      JSXから`{f()}`)も実際には正しく動的に更新されることを確認した
      ——`menuItemEnabled(items, action)`という引数渡しの形に直したこと
      自体は無害だが、直さなくても壊れていなかった可能性が高い。
      「JSXバインディングの式にメモの呼び出しを直接書く必要がある」と
      いう追加の教訓もCLAUDE.mdから削除済み。
- [x] **Step 9**完了。`domain/editorSession.ts`に§2.1の残りを実装:
      `EditorSession`ADT(`none`/`editing{index,saved,draft}`)、
      `isDirty`、`reconcileAfterCommit`、`withRefreshedSaved`、
      `withDraftBody`/`withDraftNote`。`Studio.tsx`の
      `selectedIndex`/`bodyDraft`/`noteDraft`/`originalBody`/
      `originalNote`という5つの独立シグナルと別の`pageConfig`シグナルを、
      1つの`editorSession`ADTシグナル+4つの射影memo
      (`selectedIndex`/`bodyDraft`/`noteDraft`/`pageConfig`)に統合——
      「ADTが複数の独立フィールドに分散する」というdocs/architecture.mdが
      警告する形そのものだった状態を解消。`commitChange`の本体
      (fe4aa3fの回帰対策そのもの)を`reconcileAfterCommit`呼び出し1つに
      置き換え、`refreshSource`/`selectSlide`/`handleExternalChange`の
      該当箇所も書き換え。
      `state/editorStore.ts`は作らなかった——Step 7/8同様、シグナル
      宣言はコンポーネントファイル直書き必須という制約上、`state/`層に
      置ける実質的な中身がなかった(教訓通り)。
      **`reconcileAfterCommit`は元の`commitChange`と1点だけ意図的に
      挙動を変えた**: 元のコードは「選択がin-flight中に変わっても、
      たまたま`plan`の解決先と同じindexに戻っていればsavedを更新する」
      という偶然の一致を許していたが、新実装は「選択が一度でも動いたら
      `now`をそのまま返し、一切触らない」という厳密な条件にした——
      両者は実用上区別がつかないと判断し、意図が読みやすい方を採用
      (`reconcileAfterCommit`のdocコメントに記録済み)。
      `bf debug graph`で`selectedIndex`/`bodyDraft`/`noteDraft`/
      `pageConfig`が全て`editorSession`memoから正しく派生し、
      `e1`/`e2`(autosaveのfast/slow lane effect)の依存にも正しく
      乗ることを確認。全spec/adversarialテスト通過(204 pass)。
      **実機確認は完了できず**——複数デスクトップ(Mission Control
      Space)環境で`cliclick`/`osascript`のフォーカス制御が不安定
      (直前にスクリーンショットで確認したデスクトップとは別の場所に
      操作が届く)という問題に遭遇し、ユーザーの別セッションへの誤操作
      (実害なし)を引き起こしたため中止。詳細は
      `.claude/skills/run-peitho-studio/SKILL.md`に記録。ユーザーの
      判断により、以降のStepは静的検証(typecheck/test/build/
      `bf debug graph`)で進め、実機での動作確認はユーザー自身が後日
      まとめて行う運用にする。
- [x] **Step 10**完了。`domain/deckLifecycle.ts`(`DeckLifecycle`ADT
      welcome/naming-new-deck/creating/opening/open + `DeckEvent` +
      `Decision` + `decide`/`isBusy`)。旧`deckPath`/`isBusy`/
      `newDeckModalOpen`/`newDeckParentDir`/`newDeckName`という5つの
      独立シグナルを1つの`deckLifecycle`ADTシグナル+5つの射影memoに統合。
      `loadDeckCore`/`loadDeck`/`openDeckPreferringCurrentWindow`/
      `alreadyBusy`引数を全廃し、`dispatch(event)`(`decide`を呼び、
      遷移をコミットし、`effect`があれば対応するIPC呼び出しを実行して
      結果を`opened`/`failed`/`created`イベントとして`dispatch`に
      フィードバックする1関数)に統一。
      **バグ`bfa5577`(New Deck作成後にエディタへ遷移しないバグ)の
      根本対策が型で表現された**: `creating`状態の`created`イベントは
      `Decision`型上`opening`への遷移(+`invoke-open`エフェクト)しか
      返せない——`created`から直接`open`に飛ぶ、または`invoke-open`
      エフェクトを落とす、という実装ミスが型エラーになる。
      **実装中に見つけたバグ(既存)**: `commitChange`が`isBusy`を
      デッキライフサイクルの`isBusy`と共有していた
      (`loadDeck`/`submitNewDeck`と同じフラグ)。両者はUIの表示条件
      (`deckPath()===null`かどうか)で排他的だったため実害はなかったが、
      `isBusy`を`deckLifecycle`由来の派生値にする以上、`commitChange`
      専用の独立したシグナル`isSavingSlide`に分離した——2つの無関係な
      「何か処理中」を1つのフラグで表現していた、という暗黙の結合を
      解消。
      **`openDeckPreferringCurrentWindow`の「既にデッキが開いている
      ウィンドウで新しいデッキを開こうとしたら別ウィンドウを開く」
      分岐(`domain/deckLifecycle.ts`では`open`状態の`open-requested`
      → `spawn-window`エフェクト)は、現状のコードパスからは到達不可能
      と判明**——「Open Deck…」ボタン/Recent項目はWelcome画面
      (`deckPath()===null`)でのみレンダーされ、ネイティブの
      「Open Recent」は`onMount`のコメントの通り完全にRust側
      (`open_deck_window`)で処理されフロントエンドを経由しない。ADTには
      完全性のため残したが、実際に発火しうるかは未確認のまま——
      Step 12以降でWelcomeScreenを切り出す際に、この分岐が本当に
      必要か再検討してよい。
      `bf debug graph`で`deckPath`/`isBusy`/`newDeckModalOpen`/
      `newDeckParentDir`/`newDeckName`が全て`deckLifecycle`から正しく
      派生していることを確認。全spec/adversarialテスト通過(222 pass)。
      **実機確認は見送り**——複数デスクトップでのフォーカス制御不安定
      問題(Step 9の訂正記録参照)を受けたユーザーの判断により、静的検証
      (typecheck/test/build/`bf debug graph`)のみで進める運用中。
- [x] **Step 11**完了。`applyRenderPayload`全体を`batch()`で包んだ
      (`Studio.tsx`内、`state/renderStore.ts`は作らず)——Step 7/9/10の
      実績通り、シグナル(`manifest`/各`fragmentSignal`/`canvasWidth`/
      `canvasHeight`/`assetBaseUrl`/`sectionDrafts`)はコンポーネント
      ファイル直書きのままで、`batch()`だけをそこに適用する形にした。
      効果: `patchSlidePreviewIframes`の`createEffect`
      (`manifest()`+全スライドの`fragmentSignal`に依存)が、
      `applyRenderPayload`1回の呼び出しにつき1回だけ発火するように
      なる——batch化前は「フラグメントの数+manifest更新」の回数だけ
      発火していた(2枚目以降は`outerHTML`の一致チェックで早期
      returnする無害な空振りだが、`querySelectorAll`のスイープ自体は
      毎回走っていた)。
      **e2eでのsrcdoc変異回数計測(4→0)は未実施**——`components/
      Studio.tsx`は`createTauriDeckIpc()`を直接呼ぶ設計で、外部から
      `ipc/fakeDeckIpc.ts`のようなフェイク実装を注入する経路がなく、
      実機Tauriウィンドウなしでのe2e計測ができない。前回コミット
      `547c3e8`の「4→0」計測もPlaywrightで実機を操作した一時的な
      検証ハーネス(コミットに残っていない)によるもの。今回の変更は
      `patchSlidePreviewIframes`自体のロジック(`.srcdoc`には一切
      書き込まず`replaceWith`のみ)を触っていないため、srcdoc変異が
      増える経路は構造的に増えていないはずだが、目視/計測での裏取りは
      Step 9の訂正記録以降の運用(静的検証で進め、実機確認はユーザーが
      後日まとめて行う)に従い持ち越し。
- [x] **Step 12**完了。`components/WelcomeScreen.tsx`(新規)に
      Welcome画面のJSX(Open Deck/New Deckボタン、busyフィードバック、
      エラーメッセージ、Recentリスト)をそのまま移動。値(`isBusy: boolean`/
      `errorMessage: string | null`/`recentDecks: string[]`)とコールバック
      props(`onOpenFolder`/`onNewDeck`/`onOpenRecent`)だけを受け取る
      純粋な表示コンポーネント。
      **新たに踏んだ制約(CLAUDE.md/docs/architecture.mdに記録済み)**:
      当初`isBusy: Memo<boolean>`という型で設計し`isBusy={isBusy}`と
      渡したところ、`bun run build`が`BF044`
      (`Signal/Memo getter passed without calling it`)でビルドエラーに
      なった。BarefootJSのpropsリアクティビティは実際にはSolidJSと同じ
      モデルで、`isBusy={isBusy()}`のように呼び出した値を渡すと
      コンパイラが`{ get isBusy() { return isBusy() } }`という
      getterプロパティに下げる——`Memo<T>`型のgetter自体を運ぶ設計は
      誤りだった。`WelcomeScreenProps`を`boolean`/`string | null`/
      `string[]`のプレーンな値型に直し、`Studio.tsx`側の呼び出しを
      `isBusy={isBusy()}`等に修正して解決。
      `bf debug graph`では`props.xxx`型の読み取りは他の`no tracked
      deps`ケース同様に静的グラフへ乗らないが、動的追跡
      (wrap-by-default)で実際には正しく更新されることをPlaywrightで
      確認済み(isBusy/errorMessage/recentDecksそれぞれの伝播)。
      全spec/adversarialテスト通過(222 pass)。
- [x] **Step 13**完了。`components/NewDeckModal.tsx`(新規)にNew Deck
      命名ダイアログ(バックドロップ、名前入力、親ディレクトリ表示、
      Cancel/Createボタン)を移動。`WelcomeScreen`と同じ形——値渡し+
      コールバックprops——に加え、`isOpen: boolean`propsで表示/非表示を
      コンポーネント自身に持たせ、呼び出し側の三項演算子ラップを廃止
      (`<NewDeckModal isOpen={newDeckModalOpen()} .../>`の1行に)。
      `newDeckParentDir()`が`naming-new-deck`/`creating`以外の状態では
      `null`を返す(既存の`domain/deckLifecycle.ts`の射影memoそのまま)
      ため、`parentDir`propsの型は`string | null`にした。
      `bf debug graph`は全propsバインディングが例のごとく
      `(no tracked deps)`——`WelcomeScreen`での実機確認(Step 12)で
      この読み取りパターンが動的追跡で正しく更新されることを既に確認済み
      のため、同型の読み取りしかないこのコンポーネントは再検証しなかった。
      全spec/adversarialテスト通過(222 pass、ロジック変更なしのため
      件数不変)。
- [x] **Step 14**完了。`components/DeckHeader.tsx`(新規)にヘッダーバー
      (デッキパス表示、Present/Present-optionsスプリットボタン、
      rehearsalドロップダウン)を移動。同じ形——値渡し+コールバック
      props。`deckPath`propsは`string | null`(呼び出し元のJSXが
      `deckPath() === null`の`else`分岐内にあっても、関数呼び出しの
      戻り値である`deckPath()`はTypeScript上絞り込まれないため、
      元のコードの`!deckPath()`ガードと同じ型のまま維持)。
      全spec/adversarialテスト通過(222 pass、ロジック変更なし)。
      **【運用上のミス】**このStepの作業を`new-deck-modal`ブランチに
      直接コミットしてしまい(新しいステップごとに新しいブランチを切る
      という繰り返し指摘されている原則への違反)、`git status`で気づいて
      修正した。まだリモートに push していなかったため、該当コミットを
      `git branch temp 461dce4`で退避 → `new-deck-modal`を直前のpush済み
      コミットへ`git reset --hard`→`gh stack add deck-header`→
      `git cherry-pick temp`で新ブランチへ移動、という手順で復旧。
- [x] **Step 15**完了。`components/StatusBar.tsx`(新規)にエラーバナー
      (Copyボタン付き)とフッターのステータス行をまとめて移動。同じ形
      ——値渡し+コールバックprops(`onCopyErrorMessage`)。
      `copyErrorMessage`自体(clipboard書き込み+`errorMessageCopied`の
      タイマー付きトグル)は副作用のため`Studio.tsx`側に残した。
      全spec/adversarialテスト通過(222 pass、ロジック変更なし)。
- [x] **Step 16**完了。`components/SlidePreview.tsx`(新規)に選択中
      スライドのプレビューiframe(+placeholder)を移動。**このStepは
      WKWebViewの`.srcdoc`再代入=リロード仕様(バイト同一でもリロード
      される)に触れる、これまでより慎重さが要る抽出だった**——
      `srcdoc`propsは子で`buildSelectedSlideDoc(key)`を呼び直す形にせず、
      `Studio.tsx`の呼び出し側で`buildSelectedSlideDoc(selectedSlideKey())`
      を評価した**結果の文字列**を渡す形にした。これは元のコードの
      「トラッキング対象の読み取り(`selectedSlideKey()`)は呼び出し側、
      untrackedなfragment参照はその関数内部」という構造(コメントに
      明記済み)を、JSX属性からpropsへ渡し先を変えるだけで保つため。
      `hasDeck`propsは元の`assetBaseUrl() ? ... : ...`(truthinessチェック、
      `null`だけでなく空文字列も偽扱い)と完全に同じ意味論になるよう
      `Boolean(assetBaseUrl())`で渡した(`!== null`だと空文字列がtrueに
      なり意味が変わってしまうところだった)。
      `bf debug graph`は他と同様`(no tracked deps)`。全spec/adversarial
      テスト通過(222 pass、ロジック変更なし)。
      **実機確認を強く推奨**——srcdocの再代入頻度が増えていないか
      (リロードのちらつきが増えていないか)は静的検証では検知できない
      性質のバグなので、ユーザーの後日まとめての実機確認で優先的に
      見てもらいたい箇所としてここに明記する。
- [x] **Step 17**完了。`components/SlideEditor.tsx`(新規)に本文/
      スピーカーノートの2つのtextareaを移動。**このStepはドラフト値
      propsを一切持たない**——両textareaは意図的にuncontrolled
      (`Studio.tsx`の`syncEditorFields`コメント参照: 毎キー入力で
      `.value`を再代入するとWebKitのIME合成バッファとずれる)なので、
      境界を越えるのは生のDOM ref callbackとキー入力callbackだけ。
      `bodyTextareaEl`/`noteTextareaEl`/`bodyComposing`/`noteComposing`
      と初期値セット+IME合成リスナーは全く同じロジックのまま、名前付き
      関数(`onBodyTextareaRef`/`onNoteTextareaRef`)に切り出して`ref`
      propsとして渡す形にしただけ——`syncEditorFields`(スライド切替・
      保存・外部ファイルマージなど複数箇所から呼ばれる)は引き続き
      `Studio.tsx`側でこれらに直接アクセスする。
      具体的な関数シグネチャ型(`(el: HTMLTextAreaElement) => void`)の
      named function をpropsとして渡す形(`onBodyRef={onBodyTextareaRef}`、
      インラインアロー関数ではなく変数参照)もビルドエラーにならないことを
      確認——これまでのStep 12〜16のインラインアロー関数コールバックprops
      と合わせて、具体的シグネチャの関数値であれば渡し方(インライン/
      変数参照)を問わず問題ないとみられる。`docs/architecture.md`の
      「Map/Set/Function型はpropsに渡せない」(BF049)ルール自体は
      未検証のまま(おそらく`Function`という generic 型注釈そのものを
      指しており、具体的なシグネチャ型とは別の話と考えられるが、
      今回はそれを積極的に確かめてはいない)。
      全spec/adversarialテスト通過(222 pass、ロジック変更なし)。
- [x] **Step 18**完了。これまでで最大の抽出。`domain/contextMenu.ts`に
      `menuItemEnabled`/`menuItemChecked`(元は`Studio.tsx`のローカル
      ヘルパー、`MenuItem[]`だけに依存する純粋関数)をspec/adversarial
      テスト付きで昇格させ(別コミット)、`components/SlideContextMenu.tsx`
      (新規)に永続マウントの右クリックメニュー全体(バックドロップ+
      11個のメニュー項目+レイアウトピッカーサブメニュー+プレビュー
      iframe)を移動。
      `menuItems: MenuItem[]`は配列まるごと1つのpropsとして渡した——
      「コレクション全体を1シグナルに持たない」原則は「一部だけ変わって
      全行再レンダー」を防ぐためのものだが、この11項目は常に
      `contextMenu()` ADT 1つから丸ごと再計算される単位であり、
      per-row最適化の対象になる独立した行の集まりではないため適用対象外
      と判断。`menuItemEnabled`/`menuItemChecked`/`buildLayoutPreviewDoc`
      はpropsで橋渡しせず、純粋関数として`domain/`から直接importする形
      にした(既存の`WelcomeScreen`パターンとは異なるが、これらはコンポー
      ネント特有の値を必要としない純粋関数のため、propsを増やすより
      importが素直)。各アクションのonClickは元のインラインクロージャ
      そのまま(「実行してメニューを閉じる」を1つのcallback propsに)。
      全spec/adversarialテスト通過(229 pass、+7件は新規移動した
      `menuItemEnabled`/`menuItemChecked`のテスト)。
      `bf debug graph`は他と同様全て`(no tracked deps)`——既存の教訓通り
      動的追跡で正しく動作するはずだが、11アクション+レイアウト
      ピッカーという規模の大きさから、実機確認の優先度は高めとして
      おきたい。
- [ ] **Step 19**: `SlideList`(`dom/thumbnailIframe.ts`へref移動)。
- [ ] **Step 20**: `Studio.tsx`を合成ルートに整理(目標200〜300行)。
      `CLAUDE.md`の「BarefootJSで踏んだ落とし穴」に分割で得た知見を追記。

順序の意図: 1〜5はリスクほぼゼロで行数を減らし、6〜11でバグ源の暗黙契約を
型に置き換え(この時点で2つのバグクラスは再発不能)、12〜18で初めてJSXに触る。

## 6. リスクと未確定事項

1. ~~keyed`.map()`内で子コンポーネントに`index={i}`を渡したときの鮮度
   (#2859/#2861系)。~~ **Step 0aで解消(実機Playwrightで確認済み)**——
   シンプルなケースでは並べ替え後も新しいindexを正しく報告する。
2. ~~`Memo<T>`型のpropsを子で`props.x()`と呼ぶ形が、コンパイラのブランド検出で
   確実にリアクティブ扱いになるか。~~ **Step 0aで解消**——静的グラフには
   乗らない(`no tracked deps`)が、wrap-by-defaultのランタイム動的追跡で
   実際には正しく再描画される(実機Playwrightで確認済み)。
3. `batch()`によるセッター順序ハザードの解消は理論上正しいが、
   `applyRenderPayload`のコメントにある「新規行が同期的にsrcdocを読む」挙動と
   組み合わせて、e2eの変異回数計測で必ず裏取りする(Step 11)。
4. `createEffect`を`state/`のファクトリ内で作る場合、所有者はファクトリを
   呼んだコンポーネント(`Studio()`)になる。bun testでは`createRoot`で所有する。
5. `bf debug profile --diff`がこのプロジェクト構成で
   コンポーネント名解決できるかは未確認。できなければIRテストの
   `effects`/`signals`件数スナップショットで代替。
6. ディレクトリ追加に伴い、`uno.config.ts`のスキャンglobが`.tsx`のみ対象なら
   変更不要(要確認)。
7. `scripts/spec-doc.ts`(examplesからのドキュメント自動生成)を導入するかは
   Step 0bで判断。当面は`test.each`のrunnerだけで運用し、必要になったら足す。

## Critical Files

- `/Users/kfly8/src/github.com/kfly8/peitho-studio/components/Studio.tsx` — 分割対象そのもの
- `/Users/kfly8/src/github.com/kfly8/peitho-studio/domain/slides.ts` / `slides.test.ts` — 既存の純粋関数群、命名規約の実例
- `/Users/kfly8/src/github.com/kfly8/peitho-studio/docs/architecture.md` — 恒久ルール
- `/Users/kfly8/src/github.com/kfly8/peitho-studio/vite.config.ts` — `barefoot({ components: ['components'] })`の発見範囲
