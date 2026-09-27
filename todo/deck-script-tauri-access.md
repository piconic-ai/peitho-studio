---
status: wip
description: デッキのレイアウト`<script>`がStudioの文書内で実行されるため、Tauriコマンドに到達できるかを確認し、CSP/隔離の方針を決める(リリース前に判断)
tags: [release, security, csp]
---

# デッキ内スクリプトからTauriコマンドへの到達可能性(要判断)

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: デッキのレイアウト`<script>`はStudio本体と同じ文書内で実行される
ので、他人が作ったデッキを開いただけでTauriコマンド(ファイル書き込み
など)に到達できるのではないか、という懸念。

## スコープ

- **目的**: 到達可能性をコードで確定させ、選択肢を比較して、kfly8が
  方針を決められる材料をこのファイルに揃える。
- **やらないこと**: 対策の実装(方針が決まってから別タスク)。デッキの
  スクリプトから実際にファイルを書き換える実機検証(無害な読み取り
  コマンドでの確認にとどめる)。upstream(`mizzy/peitho`)への提案。
- **受け入れ条件**: 「確かめること」1〜3の答えがこのファイルにあり、
  kfly8が選択肢を決めて`status`を`todo`か`rejected`にしている。

## 背景・要調査

着手時点で分かっていたこと(元の記述):

- レイアウトの`<script>`はStudio内で実際に実行される(`todo/archive/
  layout-js-console-log.md`)。スライドはShadow DOM(`dom/slideCanvas.ts`)
  に入れており、`<iframe>`ではないので**Studio本体と同じ文書・同じJS
  コンテキスト**で動く。
- `tauri.conf.json`の`security.csp`は`null`。`withGlobalTauri`は未設定。
- capabilitiesはコマンド単位では絞られていない。

確かめること(元の記述、要約):
1. 他人のデッキのレイアウト`<script>`が`window.__TAURI_INTERNALS__.invoke`
   でファイルを書けるか。
2. できる場合どこまで受け入れるか((a)〜(d)、下の「方針」)。
3. `peitho present`/`peitho build`側(upstream)の信頼モデル。

### 調査結果1: 到達できる(コードで確認、2026-09-27)

`src-tauri/Cargo.lock`のtauri 2.11.5のソースを読んで確認した。

- **`__TAURI_INTERNALS__`は常に注入される。** `src/manager/webview.rs`
  (172行目付近)が`withGlobalTauri`と無関係に`Object.defineProperty(window,
  '__TAURI_INTERNALS__', …)`を初期化スクリプトとしてメインフレームに
  入れる。`withGlobalTauri`が制御するのは`window.__TAURI__`(公開API)
  の方だけ。
- **アプリ独自コマンドはACLを通らない。** `src/webview/mod.rs`(1818行目
  付近)の判定は「pluginコマンド、またはアプリがACLマニフェストを定義
  している、またはリモートoriginからの呼び出し」のときだけACLを見る。
  `src-tauri/build.rs`は`tauri_build::Attributes::app_manifest`を設定して
  いないので、ローカルoriginからの`peitho::*`/`settings::*`の呼び出しは
  すべて通る。
- **レイアウトのスクリプトは「ローカルorigin」の呼び出しになる。**
  `dom/slideCanvas.ts`の`executeInlineScripts`がスクリプトを
  `document.createElement('script')`で作り直すので、Studio本体の
  window(`tauri://localhost`、dev時は`devUrl`)で実行される。
  `<script src>`がアセットサーバーや外部URLを指していても、実行される
  文書は同じ。
- **ユーザー操作は不要。** サムネイル(`SlideList.tsx`)・レイアウト
  ピッカー(`SlideContextMenu.tsx`)・プレビュー(`SlidePreview.tsx`)の
  すべてが`mountSlideCanvas`を通るので、デッキを開いた時点で全スライドの
  スクリプトが走る(upstreamの`peitho preview`はサムネイルでは走らせない
  が、Studioは走らせる)。
- **CSPが`null`なので外部への送信も止まらない**(`fetch`、`<img src>`
  など)。

到達できるコマンドと、スクリプトからできること(`lib.rs`の
`generate_handler!`と`capabilities/default.json`から):

| 呼び出し | できること |
|---|---|
| `open_deck(path)` → `read_deck_source()` | **ユーザー権限で読める任意のUTF-8ファイルを読む。** `resolve_deck_path`は「ファイルが存在する」ことしか見ない。ただし`open_deck`は先に`pipeline::render_source`でデッキとして描画し、失敗すればセッションを差し替えない(Markdownとして描画できないファイルが実際にどれだけあるかは未確認) |
| `open_deck(path)` → `save_deck_source(content)` | **上と同じ条件で、既存の任意のファイルを任意の内容で上書きする**(`~/.zshrc`など)。`save_deck_source`は「開いているデッキのパスにしか書かない」が、そのパス自体をスクリプトが`open_deck`で差し替えられる。スクリプトが`save_deck_source`を呼ばなくても、差し替えた後にユーザーが編集すれば、エディタの通常の保存が開いていたデッキの本文をそのファイルへ確認なしに書く(コードから辿った推論) |
| `create_deck(parent_dir, name)` | 任意のディレクトリに固定内容のscaffoldを作る(内容は選べない) |
| `open_deck_window(path)` | 別のデッキを新しいウィンドウで開き、そのデッキのスクリプトも走らせる |
| `update_settings(patch)` | Studioの設定を書き換える(`vim_mode`/`ui_language`のみ、`settings.rs:44-50`) |
| `present_deck(rehearsal)` | 開いているデッキで`peitho`サブプロセスを起動する(引数は固定) |
| `plugin:clipboard-manager\|read_text` | クリップボードの内容を読む(外部へ送信できる) |
| `plugin:dialog\|*` | ネイティブダイアログを出す(ユーザーにパスを選ばせる誘導にも使える) |
| `plugin:event\|emit`/`emit_to` | `deck-file-changed`などアプリ内イベントを偽装する |
| `plugin:menu\|*`(`core:menu:default`) | メニューを作ってアプリメニューに差し替える(UI偽装) |

`tauri-plugin-fs`/`shell`は入っていないので、任意のコマンド実行の経路は
見当たらない。ただし`~/.zshrc`などの上書きができれば、次にシェルを開いた
ときに実行される。

**本質は「開いているウィンドウのセッションを差し替えられる」こと。**
`open_deck`は既存のセッションを無条件に外して差し替える
(`peitho.rs:529-540`)が、アプリ自身は一つのウィンドウで`open_deck`を
二度呼ばない(`domain/deckLifecycle.ts:102-108`: 開いている状態での
open要求は`spawn-window`、それ以外は`already-open`で拒否)。差し替えが
起きると次の三つが連鎖する(コードから辿った推論):

- `save_deck_source`がセッションの`deck_path`へそのまま書く
  (`peitho.rs:580-585`)ので、編集のたびの`commitChange`→
  `saveDeckSource`(`Studio.tsx:722-724`)が差し替え先へ書く。
- watcher(`peitho.rs:520`)→`onDeckFileChanged`(`Studio.tsx:1435`)が
  差し替え先の中身をエディタに読み込むので、ユーザーの編集も確認なしで
  差し替え先に保存される。
- `remember_recent_deck`(`peitho.rs:542`)でRecent/メニューも汚れる。

**JS側で`invoke`を塞ぐ手はない。** `__TAURI_INTERNALS__`は非writableの
`defineProperty`で、`postMessage`も同様(tauri `scripts/ipc-protocol.js:88`)。
応答も`__TAURI_INTERNALS__.runCallback`経由(`:52`)なので、消すと本体の
IPCも壊れる。

**未確認**: 実機での動作(下の「完了条件」)。上の結論はtauriのソースと
Studioのコードから辿ったもので、実機では試していない。

### 調査結果2: どこまで受け入れるか

判断事項なので、選択肢の比較は下の「方針」に置いた。

### 調査結果3: upstreamの信頼モデル

`mizzy/peitho`の`docs/plans/2026-09-23-layout-scripts.md`の
「Deliberately not in scope」に明記されている:

> **No sandboxing.** Layout HTML is already trusted author-controlled code
> ... Note `lint` and `export pdf` do run that code under headless Chrome.

つまりupstreamは「レイアウトHTMLは作者が書いた信頼済みコード」と
しており、隔離はしない。ただし前提が違う:

- upstreamのスクリプトが動く場所(`peitho present`のブラウザ、`peitho
  build`の静的ページ、headless Chrome)は**普通のWebページの権限**しか
  持たない。ファイルシステムへは届かない。
- Studioでは同じスクリプトが**特権IPCを持つ文書**で動く。upstreamの
  「信頼する」をそのまま持ち込むと、信頼の範囲が「そのページの中で
  何をしてもよい」から「ユーザーのホームディレクトリを書き換えてよい」
  に広がる。

## 方針

未決定 — kfly8の判断待ち。選択肢と評価:

| 案 | 塞げるもの | 失うもの・コスト |
|---|---|---|
| (a) READMEで明記して受け入れる | なし | 実装コストなし。他人のデッキを開く=任意ファイルの読み書きを許す、をユーザーに理解してもらう必要がある |
| (b1) Tauriのisolation pattern / ACLマニフェスト | **塞げない**。isolationは呼び出し元がStudio本体かレイアウトのスクリプトかを区別できない(全invokeが同じフレームを通る、tauri `scripts/ipc.js:136`)。ACLマニフェストを有効にしても同じorigin・同じwindowなので効かない | — |
| (b2) CSP | 外部送信を止めるには`connect-src`だけでは足りない(`<img src>`/`@import`/`<video>`はimg-src/style-src/media-srcの管轄)。全面に張ると`default-src`へのフォールバックでデッキのインラインscriptが止まるので`'unsafe-inline'`が要る。これはindex.htmlにインラインscriptが増えるとtauriのhash注入(`manager/mod.rs:126-153`)で無効化される脆い構成。外部フォント・画像を使うデッキも壊れる(upstreamのpresent/buildは無制限)。ローカルのファイル読み書きは塞げない | ファイルの問題とは独立した製品判断 |
| (c) レイアウトJSの実行を設定でオフにできる | オフのとき全部 | 既定値をどうするかが本題として残る。既定オン=(a)と同じ、既定オフ=`layout-js-console-log`で作った「JSも動く」を既定で捨てる |
| (d) 描画を`<iframe sandbox="allow-scripts">`に戻す | 全部。IPCは`fetch('ipc://localhost/<cmd>')`で起動ごとにランダムな`Tauri-Invoke-Key`ヘッダが要り(tauri `src/ipc/protocol.rs:480-486`)、`Origin`がURLとして解析できる必要がある(`:488-496`、opaque originの`null`は拒否) | 右クリック・ドラッグの既知問題が戻る(CLAUDE.md)。サムネイル全部がiframeになる。`peitho:shadow-mounted`の契約も作り直し |
| (d') プレビューペインだけ`<iframe sandbox="allow-scripts">`、サムネイル・ピッカーではscriptを実行しない | (d)と同じ。upstreamの`peitho preview`もサムネイルでは走らせない | iframeの既知問題は主にサムネイル・ドラッグ由来なので、プレビュー1枚なら影響は限られる見込み(推論) |
| (e) コマンド側を狭める(当初案) | `open_deck`/`open_deck_window`/`create_deck`が許可済みのパスしか受け付けないようにする | **許可リストを「ダイアログが返したパス」で作ると崩れる**: `dialog:default`がJSに付与済み(`capabilities/default.json`)なので、scriptが`plugin:dialog\|open`を出してユーザーに選ばせれば許可される。Recentを許可に含めると、scriptが別の最近のデッキへ現ウィンドウを差し替えて読み書きできる |
| (e') セッションの差し替えを禁止し、パスを受け取るコマンドを分ける | 任意ファイルの読み書き、autosaveによる差し替え先への上書き、Recentの汚染 | 下の「推奨」。残るもの: 自デッキ`deck.md`の書き換え、`present_deck`(自デッキで`peitho present`を起動。peitho側で何が実行されるかは未確認)、`update_settings`、クリップボードの読み取りと外部送信、ダイアログでの誘導 |

実装者(Claude)の推奨: **(e')**(Fableによる検証レビューを経て(e)から
組み替え)。

- **`open_deck`は、そのウィンドウにセッションがないときだけ受け付ける**
  (`peitho.rs:529-540`の`remove`+差し替えを拒否に変える)。scriptは
  最初のopenが成功した後にしか走らず、失敗時はセッションを入れる前に
  `?`で抜ける(`peitho.rs:506-521`)ので再試行も壊れない。welcome画面の
  JSダイアログ(`Studio.tsx:663,669`)→`open_deck(path)`はそのままでよい。
  数行の変更で、任意ファイルの読み書き・autosave事故・Recent汚染が
  全部消える。
- **`open_deck_window`はJSから生のパスを受け取らない。**
  `open_recent_deck(index)`と`open_deck_variant(file_name)`(呼び出し元
  セッションのデッキと同じディレクトリに限る)に分ける。新規作成は
  `create_deck`が自分でウィンドウを開く(パスをJSに返さない)か、作成
  したパスをpendingに登録する。許可はRust発の経路(`lib.rs:243-256`の
  `pick_folder`、Recentメニュー、pending)からしか登録しない。
- **`core:default`を明示的に列挙して絞る**(menu/eventの不要な権限を
  落とす)。安価。
- **CSPは別タスク**(製品判断)。クリップボード読み取り・自デッキの
  書き換え・ダイアログでの誘導はREADMEに書いて受け入れる((a)相当)。
- 「他人のデッキを警告なしに開いても安全」を目指すなら(d')が上位互換
  だが、当面は(e')で十分と判断。

決めること:
- (e')でよいか(組み合わせ・(d')への拡張の要否を含む)。
- リリース前に必須か、リリース後でよいか。
- クリップボード読み取り(`clipboard-manager:allow-read-text`、vimの
  `p`で使う)を受け入れるか。

## レイヤー配置

方針決定後に確定させる。(e')なら:
- `src-tauri/src/peitho.rs`: `open_deck`の差し替え拒否、
  `open_recent_deck`/`open_deck_variant`の追加、`create_deck`の
  ウィンドウ起動またはpending登録(状態は`Mutex`で持つのでここ)。
  「差し替えを許すか」「variantが兄弟パスか」の判定は`AppHandle`/`State`
  から切り出した純粋関数にしてテストする。
- `src-tauri/src/lib.rs`: 配線の付け替えのみ。
- `src-tauri/capabilities/default.json`: `core:default`の明示列挙。
- `ipc/`と`domain/deckLifecycle.ts`の呼び出し側。

## テスト

方針決定後に書く。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] 調査結果1(到達できるか)をtauriのソースとStudioのコードで確認して記録した
- [x] 調査結果3(upstreamの信頼モデル)を記録した
- [x] `bun test` / `bun run typecheck` グリーン(このタスクではコード変更なし)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で確認する: Studioの「New Deck」で作ったデッキの
  `layouts/title-body-code.html`の`</section>`直前に下の`<script>`を
  足して開き直し、DevToolsのConsoleに`get_recent_decks`の結果(Recentの
  一覧)と`read_deck_source`の結果(そのデッキ自身の本文)が出ることを
  見る(読み取りだけの無害なコマンド。ファイルを書くコマンドは試さない):

  ```html
    <script>
      window.__TAURI_INTERNALS__.invoke('get_recent_decks')
        .then((r) => console.log('[probe] recent', r), (e) => console.log('[probe] error', e))
      window.__TAURI_INTERNALS__.invoke('read_deck_source')
        .then((r) => console.log('[probe] source', r.slice(0, 80)), (e) => console.log('[probe] error', e))
    </script>
  ```
  (`devtools: false`なのでInspect Elementは使えない。`tauri.conf.json`
  の`devtools`を一時的に`true`にして`bunx tauri dev`で確認する)
- [ ] 「方針」の案を決め、`status`を`todo`(対策を実装する)か
  `rejected`(受け入れる、理由を書いてarchiveへ)にする

## 先送り事項

- `open_deck`の`resolve_deck_path`が拡張子もデッキらしさも見ないことは、
  スクリプトの件とは別に、どの呼び出し元から来ても任意のファイルを
  デッキとして開いてしまう点で気になる((e')で差し替えを禁止すれば
  scriptからは届かなくなる)。
- `create_deck(parent_dir, name)`は任意のディレクトリにscaffoldを作れる
  (既存は上書きしない、`peitho.rs:326`)。影響は小さいので(e')の範囲外。
- CSP(上の(b2))は、外部フォント・画像を使うデッキとの兼ね合いを含めて
  別タスクで判断する。
