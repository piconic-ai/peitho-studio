---
name: run-peitho-studio
description: Launch the Peitho Studio Tauri desktop app and drive its native window with GUI automation (osascript/System Events/cliclick) to manually verify a change end-to-end. Use before claiming a frontend/Rust fix works, when browser-only e2e (e2e/*.e2e.ts) can't reach past the welcome screen.
---

# Peitho Studio を実機で動かして確認する

`e2e/*.e2e.ts` は Tauri IPC のないプレーンブラウザ相手のスモークテストで、
Welcome画面より先(デッキを開く/編集する等)は検証できない
(`e2e/welcome.e2e.ts` のコメント参照)。それより先の動作を確認するには、
実際の Tauri ネイティブウィンドウを起動してGUI操作するしかない。
`tauri-driver` を使った本格的なe2eはまだ無い(`CLAUDE.md` の
「e2eもほしいが、段階的でよい」参照)ので、当面はこの手順で代替する。

## 0. 事前チェック — ユーザーが既に起動していないか

自分で `tauri dev` を起動する前に、必ず確認する。

```bash
lsof -i :3003 -sTCP:LISTEN
ps aux | grep -iE "tauri dev|target/debug/app" | grep -v grep
```

- 既に動いている(ユーザー自身の開発セッション)場合は、そのウィンドウを
  使って確認する。新たに起動すると `EADDRINUSE`(ポート3003競合)で
  失敗するだけでなく、フロントエンドのビルドが失敗した状態で
  Rustプロセスだけ孤児として残る(`tauri dev` の子プロセスをkillしても、
  ネイティブウィンドウ本体の `target/debug/app` は生き残る)ことがある。
  重複起動に気づいたら、自分が起動した分だけを起動時刻で見分けてkillする
  ——ユーザーの既存プロセスを巻き込まないこと。
- GUI自動操作(マウス移動・クリック)はOS全体のフォーカスを奪う。
  ユーザーが別ウィンドウ/別セッションで並行作業している可能性を
  念頭に置き、疑わしければ一度スクリーンショットで状況を確認してから
  進める。

## 1. 起動

```bash
cd /Users/kfly8/src/github.com/kfly8/peitho-studio
nohup bunx tauri dev > /tmp/tauri-dev.log 2>&1 &
```

`[build] ... Running target/debug/app` がログに出たら起動完了
(初回 or Rust側変更時はcargoビルドが走るので数十秒〜数分かかる。
フロントエンドだけの変更ならキャッシュが効いて数秒)。

ネイティブウィンドウのPIDを特定する
(Cargo.tomlの `[package] name = "app"` なのでプロセス名は `app`):

```bash
ps aux | grep -i "target/debug/app" | grep -v grep
```

## 2. ウィンドウを最前面にしてスクリーンショット

```bash
osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is <PID>) to true'
screencapture -x <path>.png
```

Readツールでスクリーンショットを見て状態を確認する。

## 3. クリック操作は座標ベースで(AXツリーは使えない)

`tell application "System Events" to tell (first process whose unix id
is <PID>) to get name of every button of window 1` のような
アクセシビリティツリー越しのUI要素取得は、この WKWebView ベースの
Tauriウィンドウでは `count of windows` が **0** を返し機能しない
(通常のネイティブアプリなら効くはずのやり方なので、詰まったら真っ先に
これを疑う)。ボタン名指定のクリックは諦め、`cliclick` で座標クリックする。

座標変換(`screencapture` は物理ピクセル、`cliclick`/`osascript` の
クリック座標は論理point):

```bash
system_profiler SPDisplaysDataType | grep -i resolution   # 物理解像度 (例: 5120x2880)
osascript -e 'tell application "Finder" to get bounds of window of desktop'  # 論理解像度 (例: 0,0,2560,1440)
```

Readツールがスクリーンショットを縮小表示するので、その表示座標
`(dx, dy)` から実クリック座標へは:

```
point_x = dx * (論理解像度の幅 / 表示画像の幅)
```

例: 物理5120、表示2000、論理2560 なら倍率は `2560/2000 = 1.28`。

```bash
cliclick c:<point_x>,<point_y>
```

クリック後は必ずスクリーンショットで結果を確認してから次に進む
(座標がずれていても失敗が分かりにくいため)。

## 4. テキスト入力はIME経由で化けるので clipboard 経由にする

日本語IMEが有効な環境で `System Events` の
`keystroke "some/path"` を使うと、英数字だけの文字列でも変換候補として
扱われて文字化けする(パスに日本語が一文字も無くても発生した)。

```bash
printf '%s' "$TEXT" | pbcopy
osascript -e 'tell application "System Events" to keystroke "v" using {command down}'
```

フィールドにフォーカスが当たっているか(カーソルが点滅しているか)を
スクリーンショットで確認してからペーストする——クリック座標がずれて
フォーカスが外れたままだと、ペーストしても何も入力されない。

## 5. ネイティブのファイル選択ダイアログでパスを直接指定する

`openDialog({ directory: true })` が開くネイティブダイアログは、
`Cmd+Shift+G` (Go to Folder) でパスを直接入力できる。テキスト入力は
上記のclipboard経由で。1回で反映されないことがあるので、入力後は
スクリーンショットでダイアログのタイトルバー(現在のフォルダ名)と
「Open」ボタンが有効化されているかを確認し、反映されていなければ
`Cmd+Shift+G` からやり直す。

## 6. 独自コンテキストメニュー/キーボードショートカットが`cliclick`で反応しないとき

アプリ独自の右クリックメニュー(New Slide/Delete/Change Layoutなど)の
項目に対して`cliclick c:x,y`でクリックしても、メニューが閉じるだけで
アクションが実行されないことがある。矢印キー+Enterでの選択、
`Delete`/`Fn+Delete`キーの直接送信も同様に効かないことがあった
(挙動としては、キー入力が最前面のメニューではなく背後のドキュメントに
届いてしまい、スライドの選択を動かすだけだった)。

切り分け・確認手順:

1. `tauri.conf.json`の`"devtools": false`を一時的に`true`に変更し、
   `tauri dev`を再起動する(CLAUDE.mdの「開発ビルドではdevtools=trueだと
   ネイティブの要素検証メニューが優先される」を逆用する)。
2. 空白領域を右クリック → 「Inspect Element」を選ぶとWeb Inspectorが
   開く。ただし選択した要素がスライドプレビューの`<iframe>`内なら、
   Consoleパネル右下のコンテキスト表示(`about:srcdoc`)を
   `localhost`に切り替えないと、メインドキュメントのグローバル
   (`document`/`window`)を参照できない。
3. Console欄に直接JSを打ち込み、`dispatchEvent`でmousedown/mousemoveを
   合成してロジック自体が動くか確認する(実装のバグか、自動操作の限界か
   を切り分けられる)。`pbcopy`経由で複数行のコードを貼ると改行が
   スペースに変換され構文エラーになるので、`;`区切りの1行にまとめる。
   例:
   ```js
   (() => { const row = document.querySelectorAll('[data-slide-row]')[0]; const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, button: 0 })); return document.body.style.cursor; })()
   ```
4. **重要な発見**: `dispatchEvent`では正しく動くのに`cliclick`の物理
   クリックでは無反応、という場合、原因はロジックではなく
   **Web Inspectorの「Inspect Element」選択モードが有効なままになって
   いること**だった。DevToolsパネル左上の閉じるボタン(×)でパネルを
   閉じてから同じ`cliclick`操作を再試行したところ、正常に動作した
   (物理マウスイベントが要素選択モードに奪われ、アプリ本体の
   `mousedown`ハンドラに届いていなかったとみられる)。DevToolsで検証し
   終えたら、次の`cliclick`操作の前に必ずパネルを閉じること。
5. 検証が終わったら`tauri.conf.json`の`"devtools"`を`false`に戻す
   ——独自の右クリックメニュー自体が機能しなくなるため、`true`のまま
   コミットしない。

## 7. 後片付け

自分が起動した `tauri dev` とその子プロセス(`concurrently`,
`vite build --watch`, `unocss --watch`, `tsx watch server.ts`,
`target/debug/app`)は確認が終わったら明示的に `kill` する。
`ps aux` で起動時刻を突き合わせ、ユーザーが元々動かしていたプロセスを
誤って殺さないこと。テスト用に作ったデッキフォルダも削除する。

```bash
lsof -i :3003 -sTCP:LISTEN   # ポートが解放されたか最終確認
```
