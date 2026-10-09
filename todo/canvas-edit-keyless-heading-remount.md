---
status: inbox
description: キーなしスライドの見出しをキャンバスで編集すると、ライブ反映の描画が着地した時点でプレビューが再マウントされ、編集欄が消える
tags: [canvas-edit, preview, bug]
---

# キーなしスライドの見出しのキャンバス編集が描画着地で中断される

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ページ設定コメントで`key`を指定していないスライドの見出しを
プレビューのキャンバス上でダブルクリックして編集すると、入力が
ライブで反映された描画が着地した瞬間(80msデバウンス後)に編集欄が
DOMから外れ、入力中の文字入力が中断される。Meta+Enter/Escapeも
効かない(対象の要素がもうない)。

## 背景・要調査

実際に読んで分かっていること:

- `dom/slideEditing.ts`の編集欄は`input`ごとに`session.commit(value)`で
  エディタ本文へ反映する(ライブコミット)。反映はドラフト描画
  (`renderPreview`)を起こす。
- キーなしスライドのmanifestキーは見出しから導出される
  (モックは`uniqueSlideKey(slugifyTitle(title))`、peitho-coreも見出し
  由来)。見出しを書き換えると描画後のキーが変わる。
- `components/SlidePreview.tsx`のキャンバスは`selectedSlideKey`を
  trackする`createEffect`で`mountSlideCanvas`しているため、選択中
  スライドのキーが変わると丸ごと再マウントされる。`patchSlideCanvas`
  には`data-studio-text-editing`中は差し替えを保留する仕組みがあるが
  (`pendingTextEditFragments`/`flushSlideTextEdit`)、
  `mountSlideCanvas`にはない。
- 再現: `e2e/isolate-broken-slides.e2e.ts`のキャンバス編集テストで
  スライド3をキーなし(`# Three`)にし、`fill`と`press('Meta+Enter')`の
  間に`waitForTimeout(400)`を挟むと、`locator.press`が
  「element was detached from the DOM」で止まる。スライド3に
  `"key":"three"`を付けると通る。CIの`e2e`ジョブ(PR #187)でも
  負荷により同じ失敗が出た(trace確認済み)。`e2e/slide-direct-edit.e2e.ts`
  (main)は編集対象に明示キー`"key":"s"`があるため当たらない。
- 推測(未確認): 実機でも同じ経路なので、キーなしスライドの見出しを
  キャンバスで2文字以上続けて打つと途中で欄が消えるはず。要確認。

## 方針(未整理)

候補:
- `SlidePreview.tsx`の効果で、ホストが`data-studio-text-editing`中なら
  再マウントせず`patchSlideCanvas`経由で保留させる(編集終了時の
  `flushSlideTextEdit`で追いつく)。`data-slide-canvas-key`は新キーに
  更新しておき、以後の`patchSlideCanvases`のセレクタが当たるようにする。
- または、選択をキーではなくソース上の位置で追い、キー変更を
  再マウント要因から外す。

## 完了条件

自動で確認できる項目:
- [ ] キーなしスライドの見出し編集中に描画が着地しても編集欄が残り、
  Meta+Enterで確定できるe2e(描画を遅らせる`renderDraftDelayMs`または
  `waitForTimeout`で着地を先行させる)
- [ ] `bun test` / `bun run typecheck` / 既存e2e グリーン

人間の判断が必要な項目:
- [ ] 実機(WKWebView)で、キーなしスライドの見出しを続けて打っても
  欄が消えないこと
