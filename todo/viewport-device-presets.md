---
status: todo
description: PC/スマホ切替のスマホを、小さめのスマホ・大きめのスマホ・タブレットの端末プリセットから選べるようにし、比率を実機の表示領域に合わせる(スライド画面・レイアウト画面共通)
tags: [viewport, preview, layout, responsive]
---

# 端末プリセット(小さめのスマホ・大きめのスマホ・タブレット)

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーの実機確認(2026-10-04、PR #163)。「レイアウトエディタ・スライド
エディタの両方で、モバイルの縦長表示が実際のモバイルの比率になっているのか
怪しい。レスポンシブのスライドを作るならば、小さめのスマホ、大きめのスマホ、
タブレットあたりの確認は最低限できると良さそう」。

`todo/archive/preview-viewport-toggle.md`で「端末プリセットは390x844の1種固定、
選択UIは作らない」「実機(配布ビューアは下部バー分を引くので約1280x2500)と
Studio(1280x2770)の差は既知として受け入れる(Safari UI込みの実効高への変更は
将来の判断)」と決めていた。その「将来の判断」を今回行う。

## スコープ

- **目的**: スマホ表示を、少なくとも3種の端末(小さめのスマホ・大きめのスマホ・
  タブレット)から選べるようにし、各端末のキャンバスの縦横比を、実機の
  ビューアで実際に見える領域に合わせる。スライド画面のプレビューとレイアウト
  画面の一覧の両方に効く(状態は共有のまま)。
- **やらないこと**:
  - キャンバスの**幅**を端末の幅(390pxなど)にすること。配布ビューアも幅は
    デッキの幅のまま高さだけ伸ばすので、Studioもそれに合わせる(既存の判断を
    維持。`todo/archive/preview-viewport-toggle.md`の「Phoneでもキャンバス幅は
    390にならない」)。
  - 端末の枠(フレーム)の描画。
  - 任意サイズの入力、横向き(landscape)の切替。必要なら先送り事項へ。
  - peitho-core/配布ビューア側の変更。
- **受け入れ条件**:
  - スマホ表示のメニュー(今の形状メニュー▾)で、端末を選べる: 小さめのスマホ・
    大きめのスマホ・タブレット(+既存の「PCと同じ比率」)。
  - 各端末のキャンバスの縦横比が、方針で決めた「実機で見える領域」に一致する
    (純粋関数のテストで固定)。
  - 選んだ端末はスライド画面・レイアウト画面で共有され、どちらで変えても両方に
    効く。
  - `data-canvas="fixed"`のスライド/レイアウトは従来どおり変わらない。

## 背景・要調査

読んで分かったこと:

- `domain/viewport.ts`: `DEFAULT_DEVICE = 390x844`(1種)。`reshapeCanvas`は
  デッキの幅を保ち、高さを`deck.width * device.height / device.width`に伸ばす
  (16:9なら1280x2770)。`PhoneShape = 'portrait' | 'deck'`、`deviceForShape`、
  `viewportCanvas`(PR #163でスライド・レイアウト共通化)。状態は
  `state/uiStore.ts`の`viewportMode`/`phoneShape`。UIは共通の
  `ViewportToggle`(PR #163で`SlidePreview.tsx`から切り出し)。
- 844はiPhone 14/15の画面全体の高さ(CSSピクセル)で、Safariのアドレスバー・
  ツールバーと、配布ビューアの下部バーを含んでいる。実機で見える領域は
  それより短い。
- 配布ビューアの例(barefootjs `site/core/slides/overview/`の
  `component/narration.ts`): 画面幅820px以下のとき`fitCanvas`で
  高さを`1280 * (画面高さ - 下部バー) / 画面幅`にし、`body.bf-compact`を付ける。
  **820px超(大きめのタブレット)ではこの縦長化が起きない**点に注意。

要調査(実装の最初に確かめ、結果をここに書く):
1. **peitho自身のビューア**(`peitho present`/`peitho build`の配布ビューア、
   `mizzy/peitho`。Studioが使うpeitho-coreのバージョンに対応するもの)が、
   スマホ・タブレットでキャンバスをどう決めるか。上の`narration.ts`と同じか、
   しきい値(820px)や下部バーの高さはいくつか。Studioのプリセットはこれに
   合わせる。ビューアが縦長化しない幅(タブレット)では、Studioもデッキの
   比率のまま表示すべきか。
2. 各端末の「ブラウザで見える領域」の代表値。候補(CSSピクセル、縦向き):
   - 小さめのスマホ: iPhone SE(第2/3世代)375x667、Safari表示領域は約375x548〜
   - 大きめのスマホ: iPhone 15 Pro Max 430x932、Safari表示領域は約430x740〜
   - タブレット: iPad(第10世代)/iPad Air 820x1180、Safari表示領域は約820x1030〜
   Safariのツールバーはスクロールで縮むので、どちらの状態を採るか決める
   (推奨: 縮んでいない初期表示 — 最初に見える形に合わせる)。値は出典を
   コメントに残す。

調査結果(2026-10-05):

1. **peitho自身のビューアはキャンバスを縦長化しない。** Studioが使う
   peitho-core v1.34.0(`src-tauri/Cargo.toml`)の`peitho present`
   (`packages/peitho-present/src/shell.ts`の`installCanvasScaler`、
   `canvas.ts`の`calculateCanvasFit`)も、`peitho build`の配布ビューア
   (`crates/peitho-core/src/render.rs`の`resizeCanvas`)も、キャンバスは
   manifestの`canvasWidth`x`canvasHeight`(1280x720等)固定で、
   `min(innerWidth / W, innerHeight / H)`で縮めて上下に黒帯を付けるだけ。
   端末幅のしきい値も下部バーもない(最新のv1.38.5でも同じ。追加されたのは
   ビューアのUI用の`@media (orientation: landscape) and (max-height: 520px)`
   だけ)。縦長キャンバスは**デッキ自身のレイアウトJS**が行うもの:
   既知の唯一の例がbarefootjs `site/core/slides/overview/component/
   narration.ts`の`fitCanvas`で、`matchMedia('(max-width: 820px)')`の間だけ
   高さを`max(720, round(1280 * (innerHeight - 下部バー) / innerWidth))`にし、
   `--peitho-canvas-height`に書く(820pxを含む。下部バー`#bf-bar`はデッキ
   独自のUIで、上下padding 10px + 48pxのボタン + 1pxの境界線 +
   `env(safe-area-inset-bottom)`、約69px〜)。
   → Studioのスマホ表示は「縦長化するデッキ」をシミュレートするもの、という
   従来の位置付けのまま。プリセットの高さは**ブラウザで見える領域**とし、
   デッキ独自の下部バーは引かない(peitho自身にはバーがなく、バーの有無・
   高さはデッキごとに違うため)。820pxのしきい値については、選んだタブレット
   (iPad 第10世代/iPad Air 11インチ、縦向き820px幅)がちょうど`max-width:
   820px`に入るので縦長化する側になり、「縦長化しない端末」を表す仕組みは
   作っていない(全プリセットが820px以下であることをテストで固定)。
2. **プリセットの値**(縦向き、Safariのツールバーが縮んでいない初期表示の
   `innerWidth`x`innerHeight`。一般に報告されている代表値で、ここでは実測して
   いない — 実機確認は下の人間の判断項目):
   - 小さめのスマホ `small-phone`: iPhone SE(第2/3世代、画面375x667) → 375x548
   - 標準のスマホ `phone`(既定): iPhone 15/16(画面390x844) → 390x664
   - 大きめのスマホ `large-phone`: iPhone 15 Pro Max(画面430x932) → 430x740
   - タブレット `tablet`: iPad 第10世代/iPad Air 11インチ(画面820x1180) → 820x1030
   16:9デッキのキャンバスはそれぞれ1280x1871 / 1280x2179 / 1280x2203 /
   1280x1608(4:3は960x1403 / 960x1634 / 960x1652 / 960x1206)。
   既定が390x844(1280x2770)から390x664(1280x2179)に変わる。

## 方針

- `DevicePreset`の一覧(`DEVICE_PRESETS`)を`domain/viewport.ts`に持ち、
  `PhoneShape`を「端末プリセットのid | 'deck'」に広げる。既定は大きすぎない
  標準的なスマホ(今の390幅相当)を推奨。
- 高さは「ビューアで見える領域」(ブラウザUIとビューアの下部バーを除く)で
  定義する。要調査1でビューアが縦長化しない幅の端末は、その旨をプリセットに
  持たせ、キャンバスをデッキの比率のままにする(ビューアと同じ見え方)。
- メニューの表示は端末名+寸法(例: 「iPhone SE 375×548」)。

## レイヤー配置

- `domain/viewport.ts`: プリセット一覧、`deviceForShape`/`viewportCanvas`の拡張。
- `state/uiStore.ts`: 選択中の端末。
- `components/ViewportToggle.tsx`(PR #163で追加): メニュー項目。
- `domain/messages.ts`: 端末名の表示(日英)。

## テスト

- spec: 各プリセットで1280x720・960x720のデッキがどの寸法になるか、
  ビューアが縦長化しない端末はデッキのまま、`'deck'`はデッキのまま。
- adversarial: 未知のid、0/負/非有限の寸法、`data-canvas="fixed"`。
- e2e(mockTauri): メニューで端末を切り替えるとスライドのプレビューとレイアウトの
  サムネイルの縦横比が変わり、画面を切り替えても保たれる。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] 要調査1・2の結果をこのファイルに記録した
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 要調査1の結果、Studioの見え方を配布ビューアに合わせる方針でよいか
  (特にタブレットで縦長化しない場合)
- [ ] 実機で、各端末の表示が実際のスマホ/タブレットで見る配布ビューアと
  近いか(ユーザー自身に依頼)

## 先送り事項
