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
| `open_deck(path)` → `save_deck_source(content)` | **上と同じ条件で、既存の任意のファイルを任意の内容で上書きする**(`~/.zshrc`など)。`save_deck_source`は「開いているデッキのパスにしか書かない」が、そのパス自体をスクリプトが`open_deck`で差し替えられる |
| `create_deck(parent_dir, name)` | 任意のディレクトリに固定内容のscaffoldを作る(内容は選べない) |
| `open_deck_window(path)` | 別のデッキを新しいウィンドウで開き、そのデッキのスクリプトも走らせる |
| `update_settings(patch)` | Studioの設定を書き換える |
| `present_deck(rehearsal)` | 開いているデッキで`peitho`サブプロセスを起動する(引数は固定) |
| `plugin:clipboard-manager\|read_text` | クリップボードの内容を読む(外部へ送信できる) |
| `plugin:dialog\|*` | ネイティブダイアログを出す |

`tauri-plugin-fs`/`shell`は入っていないので、任意のコマンド実行の経路は
見当たらない。ただし`~/.zshrc`などの上書きができれば、次にシェルを開いた
ときに実行される。

**未確認**: 実機での動作(下の「完了条件」)。上の結論はtauriのソースと
Studioのコードから辿ったもので、実機では試していない。

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
| (b1) Tauriのisolation pattern | **塞げない**。isolationはIPCメッセージを検査するフックで、呼び出し元がStudio本体かレイアウトのスクリプトかを区別できない(同じwindowの同じ`invoke`) | — |
| (b2) CSP | `connect-src`などで外部への送信は塞げる。`script-src`でnonceのないスクリプトを止めれば実行自体が止まるが、それは(c)と同じ結果 | レイアウトの`<script src>`はアセットサーバー(`http://127.0.0.1:<port>`)を許可する必要がある。ローカルのファイル読み書きは塞げない |
| (c) レイアウトJSの実行を設定でオフにできる | オフのとき全部 | 既定値をどうするかが本題として残る。既定オン=(a)と同じ、既定オフ=`layout-js-console-log`で作った「JSも動く」を既定で捨てる |
| (d) 描画を`<iframe sandbox="allow-scripts">`に戻す | 全部(opaque originなので親の`__TAURI_INTERNALS__`に届かない。tauriの初期化スクリプトはメインフレームにだけ入る) | 右クリック・ドラッグの既知問題が戻る(CLAUDE.md)。サムネイル全部がiframeになる。`peitho:shadow-mounted`の契約も作り直し |
| (e) コマンド側を狭める | `open_deck`/`open_deck_window`/`create_deck`がネイティブ側で選ばれたパス(ダイアログ・Recent・メニュー・pending)しか受け付けないようにすれば、ファイルの読み書きは「開いているデッキ自身」までに縮む | パスを受け取るコマンドの呼び出し元をすべて付け替える。クリップボード読み取り・設定変更・外部送信は残る((b2)と組み合わせれば送信は塞げる) |

実装者(Claude)の推奨: **(e)+(b2)の`connect-src`**。レイアウトJSは
これまで通り動き、iframeの既知問題も戻らず、スクリプトが届く範囲が
「そのデッキ自身の`deck.md`・Studioの設定・クリップボードの読み取り」
まで縮む。残るものは(a)としてREADMEに書く。

決めること:
- どの案にするか(組み合わせ可)。
- リリース前に必須か、リリース後でよいか。
- クリップボード読み取り(`clipboard-manager:allow-read-text`、vimの
  `p`で使う)をどう扱うか。

## レイヤー配置

方針決定後に書く。(e)なら`src-tauri/src/peitho.rs`(どのパスを許可
済みとするかの状態は`Mutex`で持つのでここ)と`src-tauri/src/lib.rs`
(メニュー経由で開くパスの受け渡し)、`ipc/`の呼び出し側。

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
  デッキとして開いてしまう点で気になる(今のところ呼び出し元はダイアログ
  等に限られるので実害はない)。(e)を選ばない場合に別タスクにするか検討。
