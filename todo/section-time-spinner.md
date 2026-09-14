---
status: todo
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

## レイヤー配置

- `domain/slides.ts`に、既存の`parseDurationToMs`/`formatDurationMs`
  を補完する形で
  - `msToMinutesSeconds(ms: number): { minutes: number; seconds: number }`
  - `minutesSecondsToMs(minutes: number, seconds: number): number`
  を追加(いずれも純粋関数)。
- `SlideList.tsx`側の`SectionDraft`(`domain/render.ts`)は`time: string`
  のまま(既存の保存経路を変えない)にするか、`{ minutes, seconds }`に
  変えるかは実装時に決める — 後者の方がスピナーの状態とドメインの往復が
  自然になりやすい。
- `Studio.tsx`の`onSectionTimeInput`/`commitSectionEdit`は
  スピナー由来の値を受け取るよう調整するだけで、`parseDurationToMs`の
  失敗ケース自体が構造上発生しなくなる。

## テスト

- `msToMinutesSeconds`/`minutesSecondsToMs`のspec(0ms、59s、60s→1m0s、
  1m30sなど)+ adversarial(負数、非整数、`Number.MAX_SAFE_INTEGER`級の
  巨大値)。
- 相互変換(`minutesSecondsToMs(msToMinutesSeconds(ms).minutes, ...) === ms`
  の往復)テストも入れておく。

## 完了条件

自動で確認できる項目:
- [ ] `domain/slides.ts`への変換関数追加 + spec/adversarialテスト
- [ ] `SlideList.tsx`のスピナーUI実装
- [ ] `Studio.tsx`側の配線変更
- [ ] `bun test`/`bun run typecheck`グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機確認(秒の繰り上がり、既存デッキの読み込み・保存が壊れないこと)

## 先送り事項

(実装時に見つかった、本筋と無関係な改善点があればここに書き出す)
