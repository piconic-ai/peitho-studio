# コード複雑度の計測と対応計画

[cccc](https://github.com/moznion/cccc) v1.8.5 で関数ごとの cognitive complexity と cyclomatic complexity を測定する。
上限はそれぞれ 15 と 10。いずれかを厳密に超える関数を対応候補とする。
15 または 10 ちょうどの値は、その指標の超過に含めない。
この値は保守対象を絞るための初期基準であり、バグや設計不良の判定ではない。

## 再計測

cccc の [v1.8.5 リリース](https://github.com/moznion/cccc/releases/tag/v1.8.5) から OS と CPU に合うバイナリを取得し、同梱の SHA-256 を確認して `PATH` に置く。
計測スクリプトは別バージョンの cccc を拒否する。

```sh
bun run complexity
```

`complexity-results/report.json` が全件の生データ、`complexity-results/summary.md` が超過関数の全件一覧になる。
この文書の計測スナップショットは `summary.md` の内容で更新する。
関数名には親関数を含め、無名のコールバックもファイルと行番号で識別する。

CI の `complexity` は PR、main への push、手動実行で同じ計測を実行する。
結果をジョブサマリーと30日間の artifact に保存する。
既存の超過は情報として報告し、現段階では CI を失敗させない。
ツールの失敗、構文解析エラー、空の計測結果は失敗にする。

しきい値を直接ゲートとして試す場合は、次のコマンドを使う。
現在のコードでは超過があるため終了コード1になる。

```sh
cccc --config cccc.toml --max-cognitive 15 --max-cyclomatic 10 .
```

## 計測範囲

`cccc.toml` に従い、リポジトリ内の TypeScript、TSX、Rust、Python、Swift を再帰的に測定する。
アプリのフロントエンド、Rust バックエンド、site、ビルド・保守スクリプトと設定を含む。
テスト専用のファイルとディレクトリ、fixture、Rust examples、依存パッケージ、生成物を除く。
`.claude/workflows/*.js` は通常の JavaScript と異なるワークフロー DSL のため対象外。
JavaScript、HTML 内のスクリプト、CSS は測定対象に含めていない。

Rust の `#[cfg(test)] mod tests` は本番コードと同一ファイルにあり、cccc の CLI では除外できない。
このため関数総数には Rust のインラインテストも含む。
ネストした関数は、それぞれの指標で独立して数える。
親と子の行を別々の改修件数や工数と解釈しない。

## 対応計画

60関数が31ファイルに分散しているため、一括の書き換えは行わず、操作単位で分けて対応する。
`Studio.tsx` の15関数と `dom/slideEditing.ts` の7関数で超過の約37%を占める。
最初の2段階でこの22関数を対象にし、その結果で残りの優先順位を見直す。

| 順序 | 対象 | 進め方と確認 |
| --- | --- | --- |
| 1 | `dom/slideEditing.ts` の7関数 | キー操作、Markdown 変換、編集開始の責務を分ける。純粋な編集判断は domain に置き、DOM と選択範囲の操作を dom に残す。既存の `todo/canvas-edit-keyless-heading-remount.md` と変更を調整する。IME、箇条書き、Enter・Backspace・Escape、貼り付けの既存 e2e を確認する。 |
| 2 | `components/Studio.tsx` の15関数 | 最初に `onKeyDown` のショートカット判断、次に `runElementAction` と `commitChange` の編集処理を操作単位で整理する。純粋な判断は domain、状態と IPC は既存の state・ipc に合わせる。全体の `Studio` を先に分割する計画にはしない。 |
| 3 | `updates.rs`、`engine/slide_edit.rs`、`engine/serve.rs` | 更新ライフサイクル、画像キャンバス編集、HTTP 応答の分岐を各機能のテストで固定する。状態依存をコマンド層に保ち、engine にアプリ状態を持ち込まない。 |
| 4 | その他の domain・レビュー UI・site・スクリプト | 機能変更時に同じ範囲で整理する。`statusText` のような単純な網羅分岐は、数値を下げるためだけに間接化しない。 |

各変更では典型入力と境界入力のテストを先に確認し、対応する操作の e2e と再計測を行う。
最大値と超過数が下がったことに加え、操作・責務の境界が読み取れるかをレビューする。
初期対応後に、新規の超過だけを拒否する CI 制約を追加するか判断する。
今回の導入ではアプリの振る舞いを変更しない。

## 計測スナップショット

2026-11-02、ベースコミット `b5a846d` に計測ツールと依存更新ワークフローを追加した作業ツリーで測定した。
以下は `bun run complexity` の出力。

Measured 186 files and 3972 functions. Parse errors: 0.

Cognitive > 15: 30 functions. Cyclomatic > 10: 59 functions. Either threshold: 60 functions in 31 files.

Existing complexity is informational while the remediation plan is reviewed.

| File | Function | Cognitive | Cyclomatic |
| --- | --- | ---: | ---: |
| ./dom/slideEditing.ts:351 | `watchSlideEditing / startTextEditing / keydown` | 68 | 51 |
| ./dom/slideEditing.ts:214 | `watchSlideEditing / startTextEditing` | 55 | 61 |
| ./components/Studio.tsx:4226 | `Studio / <anonymous> / onKeyDown` | 54 | 51 |
| ./components/Studio.tsx:138 | `Studio` | 51 | 40 |
| ./dom/slideEditing.ts:304 | `watchSlideEditing / startTextEditing / markdown` | 49 | 50 |
| ./dom/slideEditing.ts:176 | `watchSlideEditing / <anonymous>` | 44 | 39 |
| ./src-tauri/src/updates.rs:495 | `initialize` | 41 | 12 |
| ./dom/slideEditing.ts:88 | `watchSlideEditing / markEmpty` | 39 | 35 |
| ./components/ReviewPanel.tsx:183 | `ReviewPanel / <anonymous>` | 37 | 36 |
| ./components/SlideList.tsx:144 | `SlideList / <anonymous>` | 35 | 28 |
| ./components/Studio.tsx:1821 | `Studio / runElementAction` | 34 | 41 |
| ./components/Studio.tsx:2462 | `Studio / commitChange` | 34 | 24 |
| ./src-tauri/src/engine/slide_edit.rs:107 | `image_canvas_edit` | 33 | 23 |
| ./src-tauri/src/engine/serve.rs:164 | `respond` | 30 | 18 |
| ./domain/buildErrorReport.ts:132 | `decideBuildErrorReport` | 24 | 20 |
| ./src-tauri/src/updates.rs:202 | `check` | 22 | 20 |
| ./src-tauri/src/lib.rs:248 | `run / <closure>` | 22 | 18 |
| ./components/LayoutScreen.tsx:185 | `LayoutScreen` | 21 | 22 |
| ./components/ReviewPanel.tsx:79 | `ReviewPanel` | 19 | 19 |
| ./domain/reviewComment.ts:726 | `previewPinsOf` | 19 | 16 |
| ./domain/frontmatter.ts:89 | `setFrontmatterKey` | 19 | 15 |
| ./domain/slideEdit.ts:20 | `textEditFor` | 18 | 22 |
| ./domain/slideEdit.ts:58 | `slotTextInsertion` | 18 | 15 |
| ./domain/layoutDraftPreview.ts:139 | `shorthandFamilyStart` | 18 | 12 |
| ./components/Studio.tsx:1790 | `Studio / pasteElement` | 17 | 25 |
| ./components/SlideContextMenu.tsx:56 | `SlideContextMenu` | 17 | 15 |
| ./domain/slides.ts:27 | `splitSlides` | 17 | 14 |
| ./domain/layoutDraftPreview.ts:91 | `readFamily` | 17 | 9 |
| ./components/Studio.tsx:793 | `Studio / startSlideTextEdit` | 16 | 22 |
| ./scripts/updateManifest.ts:8 | `makeUpdateManifest` | 16 | 17 |
| ./domain/slideCommands.ts:104 | `validate` | 15 | 16 |
| ./src-tauri/src/updates.rs:422 | `intercept_exit` | 15 | 14 |
| ./components/Studio.tsx:832 | `Studio / startSlideTextEdit / commit` | 14 | 19 |
| ./dom/slideEditing.ts:443 | `watchSlideEditing / paste` | 14 | 18 |
| ./domain/deckLifecycle.ts:51 | `decide` | 14 | 18 |
| ./state/renderStore.ts:196 | `createRenderStore / applyRenderPayload / <anonymous>` | 14 | 14 |
| ./dom/previewComments.ts:69 | `clickOf` | 13 | 16 |
| ./components/Studio.tsx:397 | `Studio / syncEditorFields` | 13 | 14 |
| ./src-tauri/src/crit.rs:399 | `read_events` | 13 | 12 |
| ./domain/layoutDraftPreview.ts:114 | `splitFamilyList` | 13 | 11 |
| ./components/SlidePreview.tsx:74 | `SlidePreview` | 12 | 13 |
| ./components/Studio.tsx:740 | `Studio / renderDraftPreview` | 12 | 12 |
| ./scripts/critRelease.ts:26 | `parseCritRelease` | 12 | 12 |
| ./domain/reviewPanel.ts:117 | `reviewRows / <anonymous>` | 12 | 11 |
| ./components/Studio.tsx:981 | `Studio / dropFiles` | 11 | 19 |
| ./domain/contextMenu.ts:72 | `menuItems` | 11 | 16 |
| ./components/Studio.tsx:905 | `Studio / placePreviewImages` | 11 | 14 |
| ./components/DeckHeader.tsx:37 | `DeckHeader` | 11 | 12 |
| ./components/Studio.tsx:1929 | `Studio / runEditorClipboard` | 11 | 12 |
| ./components/Studio.tsx:2584 | `Studio / selectSlide` | 11 | 11 |
| ./site/src/domain/releases.ts:105 | `recommendedAssets` | 11 | 11 |
| ./domain/reviewComment.ts:258 | `layoutTargetOfComment` | 10 | 15 |
| ./domain/editorSession.ts:143 | `reconcileAfterCommit` | 10 | 12 |
| ./site/src/domain/releases.ts:53 | `detectArch` | 9 | 11 |
| ./dom/slideEditing.ts:138 | `watchSlideEditing / <anonymous>` | 8 | 14 |
| ./components/Studio.tsx:845 | `Studio / startSlideTextEdit / commit / <anonymous>` | 8 | 11 |
| ./components/Studio.tsx:3650 | `Studio / runLayoutMenuAction` | 7 | 11 |
| ./domain/reviewComment.ts:673 | `reviewStatusText` | 7 | 11 |
| ./domain/editorHistory.ts:372 | `stepPinsLayout` | 4 | 11 |
| ./domain/statusMessage.ts:35 | `statusText` | 3 | 22 |
