---
status: todo
description: レイアウト専用画面から、選択したレイアウト/レイアウト全体へコメントし、crit経由で外部Coding Agentに直させる
tags: [layout, crit, agent, review]
---

# レイアウトへのコメントでAIに変更させる

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーの要望(2026-10-02)「選択したレイアウトに対して、コメントを
して、レイアウトを変更できる」「レイアウト全体に対して、コメントをして、
レイアウトを変更できる」。壁打ちの結論: 経路は**既存のcrit経由**(外部
Coding Agentへ渡す。アプリ内LLMは持たない — `todo/archive/crit-review-bridge.md`
の決定を維持)。

レイアウト画面3本組の3本目。前提: `todo/layout-screen.md`(専用画面)。
関連: `todo/deck-agents-md.md`(エージェントに`layouts/`/`css/`の書き方を
教える指示ファイル — こちらが先に入っていると依頼の成功率が上がる)。

## スコープ

- **目的**: レイアウト画面で、1つのレイアウト、またはレイアウト全体
  (デッキの見た目全般)に対する要望をコメントとして書き、エージェントが
  `layouts/*.html`/`css/*.css`を直したら画面に反映される。
- **やらないこと**:
  - アプリ内LLM・APIキー。
  - レイアウトHTMLの要素単位(行範囲)へのピン留めコメント。プレビュー上の
    要素はlayoutのソース位置を持たない(`data-peitho-src`はdeck.md側のみ)。
    コメントはレイアウト単位/全体単位に限る。
  - crit本体の改修(必要が見つかれば`todo/crit-upstream-notes.md`に追記)。
- **受け入れ条件**:
  - レイアウト画面で選択中のレイアウトに対しコメントを書いて送ると、
    エージェントに「`layouts/<name>.html`(と`css/<name>.css`)への要望」と
    して届く。
  - 「レイアウト全体」へのコメントが、`layouts/`と`css/`全体への要望として
    届く。
  - エージェントがファイルを直して`finish`すると、Studioのレイアウト一覧・
    プレビュー・スライドのサムネイルが更新される(再レンダ+プレビュー
    キャッシュ無効化)。
  - 返信・解決は既存のReviewPanelと同じ見た目・操作で扱える。

## 既にある下地(`todo/layout-screen.md`のPRで用意済み)

コメント送信そのものはまだ無い。差し込み先として次が入っている:

- **コメント欄はレイアウト画面でも出る**: `components/Studio.tsx`の
  コメント列(`data-panel="review"`の`ReviewPanel`)をスライド画面の
  外へ出し、両画面で同じ列・同じ開閉状態(`ui.reviewOpen()`)・同じ
  スレッド(`review`ストア)を共有している。レイアウト画面で閉じたときの
  再表示ボタンは`data-layout-panel-rail`。レイアウト画面の右端カラムに
  収まる(`LayoutScreen.tsx`のプレビュー列が`flex-1`で残りを取る)。
- **行をクリックするとスライド画面へ戻る**: `selectSlideFromReview`
  (`Studio.tsx`)。レイアウト宛てのスレッドは`slideIndex`を持たない
  想定なので、そのときの遷移先(該当レイアウトを選択する等)はここで決める。
- **レイアウト一覧の右クリックメニュー**: `domain/layoutMenu.ts`の
  `LayoutMenu` ADT(`on-layout{name}` / `on-list`)と
  `layoutMenuItems`(項目はデータ)、`components/LayoutContextMenu.tsx`
  (項目を`.map()`で描くだけ)、`Studio.tsx`の`runLayoutMenuAction`。
  「このレイアウトにコメント…」は`on-layout`に、「レイアウト全体に
  コメント…」は`on-list`に、`LayoutMenuAction`を1つ足して
  `layoutMenuItems`/`layoutMenuLabel`/`runLayoutMenuAction`の`switch`に
  1行ずつ足せばよい(網羅性チェックが足りない箇所を教える)。
  メニューの開き方・コンポーネントは変えなくてよい。

残り(このtodoの本体): 要調査1〜5、コメント対象ADT(`domain/reviewComment.ts`
に`layout{name}`/`all-layouts`)、コメント入力の導線(`CommentBox.tsx`を
レイアウト画面から開く — 位置はメニューを開いた座標でよい)、crit
セッション起動引数、finish後のレイアウト再読込(`refreshLayouts`)。

## 背景・要調査

読んで分かったこと:

- 現行の往復: Studioが同梱critでセッションを起動
  (`src-tauri/src/crit.rs::start_deck_session` — `crit --no-open deck.md`)、
  コメントを`POST /api/file/comments?path=<file>`で`{start_line,end_line,
  body,quote,author}`として追加し、`POST /api/finish`でエージェントへ渡す。
  返信はSSEの`crit-review`イベント。対象は常にdeck.mdの行範囲
  (`domain/reviewComment.ts`、`engine/crit.rs`)。
- 同梱crit(v0.21.0)の`--help`は`crit <file|dir> [...]`で**複数ファイル/
  ディレクトリのレビュー**をサポートすると書いている。APIはファイル単位
  (`?path=`)。
- `engine/crit.rs::deck_file_in`・`domain/agentConnect.ts`
  (`agentConnectCommand`/`agentConnectPrompt`)はdeck.md 1ファイルを前提。
- critのHTTP APIは内部・不安定(`todo/archive/crit-review-bridge.md`)。

要調査(実装の最初に実際に試す — 推測で進めない):
1. `crit --no-open deck.md layouts css`でセッションを起動し、
   `POST /api/file/comments?path=layouts/<name>.html`が受け付けられるか。
   HTMLファイルが「ファイル」として扱われ、行コメントが付くか。
2. ファイル全体へのコメント(行指定なし)ができるか。できなければ1行目に
   付けて本文で「ファイル全体への要望」と明示する。
3. 「レイアウト全体」コメントの置き場所: crit の review-level コメント
   (`crit comments`の"review-level first"という記述あり)が使えるか。
   使えなければ`css/base.css`の1行目などに付ける。
4. エージェント側の`crit`(ユーザーが`agentConnectCommand`で起動する
   もの)が、Studioの起動したセッションに複数ファイルでも繋がるか。
   起動引数を揃える必要があるなら`agentConnectCommand`を変える。
5. セッション起動時にレイアウトファイルを含めると、既存のdeck.mdへの
   コメント機能が影響を受けないか(回帰確認)。

## 方針

- 要調査1〜4の結果で分岐する:
  - (A) 複数ファイルのセッションが使える → セッション起動を
    `crit --no-open deck.md layouts css`に変え、レイアウトへのコメントは
    該当ファイルへ付ける。本文先頭に`[Layout <name>]`/`[All layouts]`の
    ラベルを付ける(`agentCommentBody`と同じ考え方)。
  - (B) 使えない → deck.md側に付けるのは誤誘導になるので不可。その場合は
    実装を止め、人間に判断を委ねる(crit側の対応依頼 or 代替経路)。
- UIは`CommentBox.tsx`/`ReviewPanel.tsx`を再利用し、レイアウト画面にも
  レビューパネルを出す(モード間で同じスレッド一覧を共有)。対象の種類を
  `domain/reviewComment.ts`のADTに追加する(`layout{name}` /
  `all-layouts`)。

## レイヤー配置

- Rust `engine/crit.rs`: セッション起動引数・ファイルパスの組み立て(純粋)。
  `crit.rs`: 起動コマンド。
- フロント `domain/reviewComment.ts`: 対象ADT拡張、ラベル生成。
  `domain/agentConnect.ts`: 接続コマンドの変更(必要なら)。
- `components/LayoutScreen.tsx`: コメント入力の導線。`Studio.tsx`: finish/
  返信受信時のレイアウト再読込。

## テスト

- TS spec/adversarial: 新しい対象種別のラベル(名前が空・記号入り・長大)、
  コメント対象→ファイルパスの対応(`layout{name}`→`layouts/<name>.html`、
  パス区切りを含む名前の拒否)。
- Rust spec/adversarial: セッション起動引数(`layouts/`/`css/`が無いデッキでは
  付けない)。
- e2e(fakeCritIpc): レイアウトへのコメント送信で`path=layouts/<name>.html`
  が使われる、finish後にレイアウト一覧が再読込される。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] 要調査1〜5の結果をこのファイルに記録した
- [ ] `bun test` / `bun run typecheck` グリーン
- [ ] `cargo test` グリーン
- [ ] `bun run test:e2e` グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 要調査で(B)になった場合の進め方
- [ ] 実機で実際のエージェント(Claude Code等)にレイアウト変更を依頼し、
  反映されるか(ユーザー自身に依頼)

## 先送り事項
