---
status: todo
description: CodeMirrorのエディタにvim modeを載せ、IME自動オフとシステムクリップボード連携を入れる
tags: [editor, vim, ime, settings]
---

# vim mode

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザー要望「vim modeがほしい」(`todo/studio-settings-panel.md`の
3要望の1つ)。設計相談(2026-09-24)で次のように決めた。

- ユーザーは「Vimと同じ使い勝手でないと受けつけない」が、
  「Obsidian程度のvim modeなら十分」。
- 方式は **CodeMirror 6 + `@replit/codemirror-vim`**(Obsidianと同じ
  系統)。本物のNeovimを組み込む案は、エディタの描画の自作とIMEの難しさ
  から採らない。
- 対象は **本文とノートの両方**。
- 必須機能は **IME自動オフ** と **システムクリップボード連携**。

**着手条件**:
- `todo/codemirror-editor.md`が完了していること(エディタがCodeMirrorに
  なっていること)。
- ON/OFFの保存先として、`todo/studio-settings-panel.md`の設定の永続化が
  できていること。先にこちらを始める場合は、仮の保存先で進めてよい。
  その場合は、設定画面ができたら移すことを先送り事項に書く。

## スコープ

- **目的**: 設定でvim modeをONにすると、本文とノートでVimのキー操作
  (ノーマル/挿入/ビジュアルモード、オペレータとモーション、テキスト
  オブジェクト、レジスタ、マクロ、`.`リピート、`/`検索、`:s`置換など、
  `@replit/codemirror-vim`が提供する範囲)が使える。
- **やらないこと**:
  - Neovimの組み込み、Vimプラグイン(surroundなど)の移植
  - 独自キーマップの設定ファイル(ユーザーの必須機能には入らなかった。
    先送り事項を参照)
  - 相対行番号など表示系の設定
  - `:w`/`:q`などのexコマンドをアプリの操作に割り当てること
    (自動保存があるので`:w`は不要。必要になったら別途)
- **受け入れ条件**:
  - 設定でvim modeをON/OFFでき、再起動後も保持される。OFFのときは今の
    編集操作と変わらない。
  - ONのとき、本文とノートの両方でVimのキー操作が効く。今どのモードかが
    画面上で分かる(`-- INSERT --`相当の表示)。
  - **IME自動オフ**: 挿入モードで日本語入力をしていても、`<Esc>`などで
    ノーマルモードに戻った時点で、macOSの入力ソースが英数(ASCII入力が
    できる入力ソース)に切り替わる。ノーマルモードのキーが日本語の変換に
    食われない。
  - **システムクリップボード連携**: `y`でヤンクした内容がOSの
    クリップボードに入り、ほかのアプリで貼り付けられる。ほかのアプリで
    コピーした内容を`p`で貼り付けられる(`clipboard=unnamed`相当)。
  - `<Esc>`はまずVimの操作(挿入モードを抜ける等)に使われる。アプリの
    メニュー(右クリックメニュー、phone shapeメニュー)が開いているときは
    メニューを閉じる、という今の挙動も保たれる。

## 背景・要調査

実際に読んで分かったこと(`@replit/codemirror-vim` 6.4.0のパッケージを
展開して確認):

- `vim()`拡張を、ほかのキーマップより先に入れる。ビジュアルモードの選択
  表示には`drawSelection`が必要。
- CM5互換のAPIがある: `getCM(view)`、`Vim.map`/`Vim.noremap`、
  `Vim.defineEx`、`Vim.defineRegister`、`Vim.setOption`、モード変更
  イベント`vim-mode-change`(`getCM(view).on('vim-mode-change', ...)`)。
- **システムクリップボードとの連携は組み込まれていない**。レジスタは
  ライブラリ内のメモリだけにある。

要調査:

1. **クリップボード連携の方式**。書き込み(ヤンク時)は非同期で後から
   書けばよいが、読み込み(`p`)は、Vimのレジスタの読み出しが同期なのに
   対して、クリップボードの読み取り(`navigator.clipboard.readText`や
   Tauriのclipboardプラグイン)は非同期。候補は次の3つ。
   - ウィンドウにフォーカスが戻ったときなどに、OSのクリップボードを
     無名レジスタへ先に写しておく
   - `p`/`P`をアプリ側のアクションに差し替えて、非同期で読んでから
     貼る
   - `defineRegister`で独自のレジスタを定義する
   Obsidianで同じ課題にどう対処しているかも参考にする。
2. **IME自動オフの実装**。macOSのText Input Source Services
   (`TISCopyCurrentASCIICapableKeyboardInputSource`と
   `TISSelectInputSource`)をRust側から呼び、入力ソースを切り替える
   Tauriコマンドを作る想定。フロントは`vim-mode-change`でノーマル
   モードに入ったときに呼ぶ。確かめることは次の3つ。
   - Rustから呼ぶ方法(`objc2`系のクレートか、直接のFFIか)
   - WKWebViewの中で変換中のまま入力ソースを切り替えたとき、変換中の
     文字がどうなるか(確定されるか、捨てられるか)
   - 挿入モードに戻ったときに、元の入力ソース(日本語)へ戻すか。
     一般的なVim向けIME切り替え(im-select等)は戻さないことが多い。
     戻す/戻さないはユーザーに確認する
3. **`<Esc>`の衝突**。`Studio.tsx`の`onKeyDown`は`<Esc>`でphone shape
   メニューと右クリックメニューを閉じている。CodeMirrorにフォーカスが
   あるときの優先順位を決める。
4. **Undo**。Vimの`u`/`Ctrl-R`とEdit > Undo(Cmd+Z)は、どちらも
   CodeMirrorの履歴を使う想定。`@replit/codemirror-vim`がCodeMirrorの
   `history`と整合するかを確かめる。
5. **Vimのキーとアプリのショートカットの衝突**。`Ctrl-V`(矩形選択)、
   `Ctrl-D`/`Ctrl-U`など。アプリのショートカットはCmd系なので衝突しない
   見込みだが、`onKeyDown`がCodeMirror内のキーを横取りしていないか
   確かめる。

## 方針

- vim modeのON/OFFはCodeMirrorの`Compartment`で切り替える(エディタを
  作り直さない)。
- IME切り替えのTauriコマンドは、macOS専用の小さなモジュールとして
  `src-tauri/src/`に置く(状態を持たない関数なので`peitho.rs`には混ぜ
  ない)。macOS以外では何もしない。
- クリップボード連携は要調査1の結果で決める。

## レイヤー配置

- `dom/codeEditor.ts`(`codemirror-editor.md`で作るもの): vim拡張の
  ON/OFF、モード変更の購読。
- `src-tauri/src/input_source.rs`(仮): 入力ソースを英数に切り替える
  コマンド。
- `ipc/`: そのコマンドの呼び出し。
- 設定の読み書きは`todo/studio-settings-panel.md`の永続化の仕組みを使う。

## テスト

- e2e: vim modeをONにして、本文でノーマルモードのキー(`dd`、`u`、`p`
  など)を送り、内容が期待どおりに変わること。モード表示が切り替わる
  こと。OFFのときにVimのキーが効かないこと。
- クリップボード: e2eのモックで、ヤンクしたときにクリップボードへの
  書き込みが呼ばれることと、クリップボードの内容を`p`で貼れること。
- Rust: 入力ソースの切り替えそのものは実機依存なので単体テストしない。
  判断ロジックを切り出した場合だけ`#[cfg(test)]`でテストする。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [ ] `bun test` / `bun run typecheck` / `bun run test:e2e` グリーン
- [ ] (Rust変更があれば)`cargo test`グリーン

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 要調査1(クリップボード連携の方式)の決定
- [ ] 要調査2のうち「挿入モードに戻ったとき元の入力ソースへ戻すか」を
      ユーザーに確認
- [ ] 実機確認: IME自動オフ(日本語で打ってから`<Esc>`し、そのまま
      `dd`などが効くこと)
- [ ] 実機確認: システムクリップボード(ほかのアプリとの間でヤンクと
      貼り付け)
- [ ] 実機確認: ユーザー自身が普段のVimの操作で違和感がないか

## 先送り事項

- 独自キーマップの設定ファイル(`jk`→`<Esc>`などの`noremap`)。
  `Vim.map`/`Vim.noremap`で実現できる。今回の必須機能には入らなかった
  ので、要望が出たら別todoにする。
