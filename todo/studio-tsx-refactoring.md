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
      **実機確認は保留**——確認しようとした時点でmacOSがロック中で
      GUI自動操作ができなかったため、静的検証(typecheck/test/build)の
      みで進めた。次にビルドを実機で触る機会に、スライドの追加・削除・
      並べ替え・貼り付けでタイトル/選択位置が壊れていないか確認する。
- [ ] **Step 7**: `domain/drag.ts` + `state/uiStore.ts`のdrag部分 +
      `dom/dragGesture.ts`。
- [ ] **Step 8**: `domain/contextMenu.ts` + `menuItems()`。
- [ ] **Step 9**: `domain/editorSession.ts` + `state/editorStore.ts`
      (fast/slow lane、`reconcileAfterCommit`)。
- [ ] **Step 10**: `domain/deckLifecycle.ts` + `state/deckStore.ts`。
      `isBusy`を派生値に、`loadDeck`/`loadDeckCore`/`alreadyBusy`を廃止。
- [ ] **Step 11**: `state/renderStore.ts`: `applyRenderPayload`を`batch()`で
      包む。**e2eのsrcdoc変異回数計測(4→0が維持)されることを確認。**
- [ ] **Step 12〜18**: JSXを1PRにつき1コンポーネントずつそのまま移動:
      `WelcomeScreen` → `NewDeckModal` → `DeckHeader` → `StatusBar` →
      `SlidePreview` → `SlideEditor` → `SlideContextMenu`(永続マウント維持) →
      `SlideList`(`dom/thumbnailIframe.ts`へref移動)。
- [ ] **Step 19**: `Studio.tsx`を合成ルートに整理(目標200〜300行)。
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
