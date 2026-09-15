---
status: wip
description: セクション時間設定を分/秒スピナーのGUIに置き換え、不正フォーマット入力を構造的に防ぐ
tags: [ui, section, time]
---

# セクション時間設定のGUI化(分/秒スピナー)

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: 時間設定をGUIで変更できるようにしたい。現状は
`SlideList.tsx`のセクションヘッダーにある自由入力のテキストフィールド
(`onSectionTimeInput`)で、"30s"/"1m"/"1m30s"のような peitho 独自の
定型フォーマットが求められているが、それ以外を打つと
`domain/slides.ts`の`parseDurationToMs`が`null`を返し、
`Studio.tsx`の`commitSectionEdit`はfrontmatterの時間合計同期を
黙ってスキップするだけ(エラー表示なし)。ユーザーとの壁打ちの結果、
**分/秒それぞれをスピナー(数値ステッパー)で選ぶUI**に置き換え、そもそも
不正なフォーマットを入力できなくする方針に決定。

## スコープ

- **目的**: セクション時間の編集を、フォーマットエラーが原理的に起き
  ないGUI(分/秒スピナー)に置き換える。
- **やらないこと**: peitho独自の時間フォーマット文字列("1m30s"等)自体の
  変更、秒未満(ミリ秒)精度への対応、スライド単位(セクション以外)の
  時間設定UI。
- **受け入れ条件**: セクション時間の編集がスピナーのみで完結し、
  `parseDurationToMs`が失敗する入力をそもそもUIから作れない。

## 方針

- `SlideList.tsx`のセクション時間入力(現行`<input>`1個)を、分用・秒用
  それぞれ独立した数値入力(`<input type="number">`またはステッパー
  ボタン付きの自前UI)の2つに置き換える。
- 秒は0-59に丸める(60以上を入れたら繰り上げるか、単純にクランプするかは
  実装時に`domain/slides.ts`側の関数で決める)。
- 内部表現(peitho独自フォーマット文字列としてPageCommentに書き込む値)は
  従来通り`formatDurationMs`で組み立てる — フォーマット自体は変更しない。
  変わるのはUIの入力手段のみ。

### 実装時に決めたこと

- **UI**: `<input type="number">`を2つ(分・秒)。ネイティブのスピン
  ボタンとキーボードの上下キーでステップでき、直接入力もできる。分には
  `min="0"`、秒には`min`/`max`を付けない(矢印で59を超えて/0を下回って
  ステップさせ、繰り上げ/繰り下げを起こすため)。
- **60秒以上は繰り上げ、負の秒は分から繰り下げ**(時計と同じ挙動)。
  合計は`[0, MAX_DURATION_MS]`にクランプし、整数秒に丸める
  (`minutesSecondsToMs`)。`MAX_DURATION_MS`は`Number.MAX_SAFE_INTEGER`
  msを秒単位に切り下げた値 — これを超えると`formatDurationMs`が
  `1e+21m`のような指数表記を出し、`parseDurationToMs`が読めなくなるため。
- **`SectionDraft`は`{ name, timeMs }`(ミリ秒)に変更**した。
  `{ minutes, seconds }`だと`0分90秒`と`1分30秒`のように同じ時間に2つの
  表現ができてしまうため、正規形が1つのミリ秒にした。表示時に
  `msToMinutesSeconds`で分解する。
- **0秒は保存時に1秒へクランプ**(`savableSectionTimeMs`)。peitho-core
  は`time must be greater than zero`で0を拒否する。編集中は0分0秒を表示
  できるようにした(分を0にしてから秒を打つ途中で秒欄を書き換えないため)。
  同じく保存時に、他セクションとの合計が`MAX_DURATION_MS`を超えない
  ようにもクランプする(peitho-coreは合計が`Number.MAX_SAFE_INTEGER` ms
  を超えるデッキを拒否する)。
- **打ちかけの入力(空欄、`-`、`1e`など。`valueAsNumber`がNaN)は時間を
  変えない**(`withDurationPart`)。0として扱うと、`value`バインディングが
  入力中の欄を`0`に書き換えてしまい、`-1`と打つと`01`になる。欄を離れた
  ときに現在の値へ書き戻す。
- **セクションヘッダーの保存は、フォーカスがヘッダーの外に出たとき**
  (`dom/sectionHeader.ts`の`isFocusMovingWithinSectionHeader`)。入力欄
  ごとのblurで保存すると、分→秒へTabした瞬間に保存が走り、その再描画で
  下書きがリセットされて、保存中にステップした秒が消えるため
  (`e2e/section-time-spinner.e2e.ts`の最後のテストで再現・固定)。
- **打った文字列が同じ値に正規化される場合の表示ずれ**(値が`0`のときに
  `000`や`-1`を打つ等)は、reactiveな`value`バインディングだけでは書き
  戻されない。`onChange`で`showCanonicalValue`を呼んで書き戻す。

## レイヤー配置

- `domain/slides.ts`に、既存の`parseDurationToMs`/`formatDurationMs`
  を補完する形で
  - `msToMinutesSeconds(ms: number): { minutes: number; seconds: number }`
  - `minutesSecondsToMs(minutes: number, seconds: number): number`
  を追加(いずれも純粋関数)。
  - 実装時に追加: `withDurationPart`(スピナー1つの編集)、
    `savableSectionTimeMs`/`MIN_SECTION_TIME_MS`(保存時の下限)、
    `MAX_DURATION_MS`。
- `SlideList.tsx`側の`SectionDraft`(`domain/render.ts`)は`time: string`
  のまま(既存の保存経路を変えない)にするか、`{ minutes, seconds }`に
  変えるかは実装時に決める — 後者の方がスピナーの状態とドメインの往復が
  自然になりやすい。→ `{ name, timeMs }`に変更(上記「実装時に決めた
  こと」参照)。初期値は`domain/render.ts`の`savedSectionDraft`。
- `Studio.tsx`の`onSectionTimeInput`/`commitSectionEdit`は
  スピナー由来の値を受け取るよう調整するだけで、`parseDurationToMs`の
  失敗ケース自体が構造上発生しなくなる。
- DOM操作(フォーカス判定・表示の書き戻し)は`dom/sectionHeader.ts`。

## テスト

- `msToMinutesSeconds`/`minutesSecondsToMs`のspec(0ms、59s、60s→1m0s、
  1m30sなど)+ adversarial(負数、非整数、`Number.MAX_SAFE_INTEGER`級の
  巨大値)。
- 相互変換(`minutesSecondsToMs(msToMinutesSeconds(ms).minutes, ...) === ms`
  の往復)テストも入れておく。
- 実装時に追加:
  - `domain/slides.examples.ts`: スピナー編集のGiven-When-Then例(データ)。
    `slides.test.ts`が`example: ...`として実行する。
  - 非機能(堅牢性): `<input type="number">`が返しうる任意の数値
    (NaN/±Infinity/-0/巨大値/小数)に対し、保存される文字列が必ず
    `parseDurationToMs`で同じ値に読み戻せること、および保存値が1秒以上で
    他セクションとの合計が`MAX_DURATION_MS`以下に収まることのプロパティ
    テスト(fast-check)。
  - `e2e/section-time-spinner.e2e.ts`: モックIPC経由で実際の
    SlideList→Studio→`save_deck_source`の経路を通すGiven-When-Then例。
    `e2e/helpers/mockTauri.ts`はPageCommentからセクションを組み立て、
    `render_draft`の遅延を指定できるようにした。

## 完了条件

自動で確認できる項目:
- [x] `domain/slides.ts`への変換関数追加 + spec/adversarialテスト
- [x] `SlideList.tsx`のスピナーUI実装
- [x] `Studio.tsx`側の配線変更
- [x] `bun test`/`bun run typecheck`グリーン
- [x] kfly8レビュー対応: 「時間選択のUIがダサい。クリックしたときだけ
      編集UIが出るのが良い」— スピナーを常時表示せず、クリックするまでは
      「セクション名 + `formatDurationMs`の表示」だけの読み取り専用な
      サマリーボタンにした(`state/uiStore.ts`の`editingSectionIndex`、
      一度に1つのセクションだけが編集状態を持てる)。クリックで展開・
      ヘッダーからフォーカスが外れると保存と同時に元のサマリー表示へ戻る
      (`SlideList.tsx`/`Studio.tsx`)。e2eに展開/収納そのものの例2件を
      追加し、既存の入力系テストは展開後の状態から始まるよう更新した。

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機確認(秒の繰り上がり、既存デッキの読み込み・保存が壊れないこと)
  - WKWebViewのネイティブスピンボタンの見た目・幅(`w-10`で2桁が
    収まるか)と、矢印クリックでの繰り上がり/繰り下がり。e2eはChromeで
    キーボード操作のみ確認している。
  - 分のスピナーから秒のスピナーの矢印を直接クリックしたとき、WKWebView
    がblurの`relatedTarget`を報告し、保存がヘッダー離脱まで遅れること
    (報告しない場合は入力欄ごとに保存する従来の挙動に戻る)。
  - `1h`や`"time": 5`(整数分)など、`parseDurationToMs`が読まない形式で
    時間を書いた既存デッキを開き、スピナーの表示が正しいこと。
  - 収納時のサマリーボタン(セクション名+時間)の見た目・タップ範囲が
    WKWebViewで自然に見えること。
- [x] 0分0秒を保存しようとしたとき1秒に切り上げる挙動でよいか
  (peitho-coreが0を拒否するため。代案: エラー表示して保存しない) —
  kfly8確認: この挙動のままでよい(2026-09-15)。
  - 「スピナー自体で0m0sを選択できなくする」案も検討したが、`分`欄を
    先に0にしてから`秒`欄を打つ編集の流れ(`withDurationPart`のコメント
    参照)と衝突する。0m0sへ寄せる編集を都度弾く/相手側を繰り上げるとい
    う実装は、その編集の流れを壊すか秒欄を編集中に予期せず書き換えるか
    のどちらかになるため、今回は見送り、保存時の切り上げのみで留める。

## 先送り事項

- `sumSectionTimesMs`(スライドの追加/貼り付け/削除時のfrontmatter合計
  同期)は`parseDurationToMs`を使っており、peitho-coreが受け付ける`1h`や
  整数分(`"time": 5`)を読めず0として数える。そうしたデッキでスライドを
  追加/削除するとfrontmatterの合計がずれてビルドエラーになりうる。
- セクションヘッダーからフォーカスを外すだけで、変更がなくても
  `"90s"`が`"1m30s"`に書き換えて保存される(本タスク以前からの挙動)。
  下書きが保存済みの値と同じなら保存しない、というガードを検討する。
- 本文エディタの自動保存など、別の経路の再描画でも`applyRenderPayload`
  がセクションの下書きをリセットするため、スピナー編集中に別の保存が
  着地すると編集が消えうる(本タスク以前からの挙動)。
- 保存中(`commitChange`の完了前)に別のセクションのヘッダーを編集して
  離れると、2つの保存が並行して走る。後から始まった保存が古い
  `editor.fullSource()`を元に組み立てられて先の変更を上書きしたり、
  `render.manifest()`だけ更新済みでfrontmatter合計がずれてビルドエラーに
  なったりしうる(本タスク以前からの挙動。セクション名の編集でも起きる)。
- 各セクションヘッダーのバインディングが`sectionDrafts`のRecord全体を
  読んでいるため、1つのスピナーの編集で全セクションのバインディングが
  再評価される(CLAUDE.mdの「Record全体を1つのシグナルに持たない」)。
  セクション数は通常少ないため未対応。
