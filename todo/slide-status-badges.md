---
status: todo
description: Draft/Skipスライドをサムネイル本体を隠さずバッジで識別できるようにする
tags: [ui, slide-list, thumbnail]
---

# サムネイルの Draft / Skip バッジ化

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端はユーザー指摘: Draft化したスライドは現状サムネイルごと消えて見える(非表示)。
Skipは`SlideList.tsx`でサムネイル下に "skip" というテキストラベルが出るのみ。
どちらも本体を隠す/文字だけにするのではなく、サムネイル画像そのものは見えたまま
その上にバッジを重ねる形にしたい。

## スコープ

- **目的**: draft/skip状態のスライドも、サムネイル本体を隠さずに
  「一覧の中で見分けられる」ようにする。
- **やらないこと**: draft/skip以外の新しいステータス種別の追加、
  バッジの色・アイコンをユーザーがカスタマイズする機能、draft/skipの
  一括切替UI。これらは別要望が出たら別タスクとして切り出す。
- **受け入れ条件**: draftスライドがサムネイル一覧から消えず、バッジ
  (オーバーレイ)で識別できる。skipスライドも同様にバッジで識別でき、
  既存の下部"skip"テキストラベルは残っていない。

## 背景・要調査(着手前に必ず確認する)

- `domain/render.ts`の`ManifestSlide`には`skip: boolean`はあるが`draft`
  フィールドがない。
- peitho-core側(`crates/peitho-core/src/parser.rs`)は`draft: true`の
  スライドを**ビルド対象から除外する**仕様
  (`"draft slides are excluded from the build"`、`draft`と`skip`は
  同時指定不可、`draft`のスライドは`page_number: false`も不可)。
- Studioが呼ぶ`render_draft`(`src-tauri/src/peitho.rs`)がエディタ用の
  常時プレビュー経路として、`peitho build`と同じ除外ロジックを踏んでいる
  のか、それともエディタ用途では素通しするのかを最初に読んで確認する。
  - 除外している場合: 「サムネイルが消える」という現状の報告と一致する。
    この場合、フロントエンド側で`manifest.slides`をそのまま`.map()`する
    現行の`SlideList.tsx`の作りでは、draftスライドの情報自体が届いていない
    ため「アイコンを乗せる」ことができない。Rust側にエディタ専用の
    「draftも含めてレンダリングする」オプションを追加するか、
    `editor.slideRanges()`(生テキストの`---`区切り、常に全件)を
    ソースにしたプレースホルダー描画に設計を変える必要がある — どちらを
    選ぶかは規模がかなり違うので、調査結果を踏まえてFableに相談する。
  - 除外していない場合: 単純にフロント側の型(`ManifestSlide`)に`draft`
    フィールドを足すだけで済む可能性が高い。

## 方針

- draft/skipどちらも、`.peitho-slide`本体は縮小表示されたまま見せ続け、
  その上に半透明の暗いオーバーレイ + バッジ(例: "DRAFT" / "SKIP" の
  短いラベルまたはアイコン)を重ねる。
- `draft`と`skip`はpeitho-core仕様上同時に立たないため、バッジの出し分け
  は排他でよい(`draft`優先、`skip`次点、程度の単純な優先順位で足りる)。
- 既存のサムネイル下"skip"テキストラベル(`SlideList.tsx:165`)は
  オーバーレイバッジに統一し、削除する。

## レイヤー配置

- `domain/slides.ts`(または新設`domain/slideStatus.ts`。既存ファイルの
  責務が肥大化するようなら分ける)に純粋関数
  `slideStatusBadge(config: PageConfig): 'draft' | 'skip' | null`を追加。
- `components/SlideList.tsx`はこの結果に応じて`.peitho-slide`ホストの上に
  重ねるオーバーレイ要素を出し分けるだけ(DOM操作・スタイリングのみ、
  ロジックは持たせない)。
- Rust側の変更が必要になった場合は`src-tauri/src/engine/`
  (`(Path, &str) -> Result<T, String>`の純粋パイプライン)と
  `src-tauri/src/peitho.rs`(Tauri State層)の責務分離を崩さないこと。

## テスト

- `slideStatusBadge`のspec(draft単体/skip単体/両方false/フィールド欠如)
  + adversarial(draft・skipが両方trueという本来あり得ない入力への挙動を
  明示的に決めておく — 例外を投げるか、片方を優先するか)。

## 完了条件

自動で確認できる項目:
- [ ] `slideStatusBadge`純粋関数 + spec/adversarialテスト
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] (Rust変更があれば) `cargo test` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] `render_draft`のdraftスライド扱いを調査した結果、Rust側の変更が
      要ると分かった場合、その設計をFableに相談してから着手する
- [ ] 実機(`run-peitho-studio` skill)でdraft/skip双方の見た目を確認

## 先送り事項

(実装時に見つかった、本筋と無関係な改善点があればここに書き出す)
