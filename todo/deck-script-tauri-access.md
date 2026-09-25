---
status: inbox
description: デッキのレイアウト`<script>`がStudioの文書内で実行されるため、Tauriコマンドに到達できるかを確認し、CSP/隔離の方針を決める(リリース前に判断)
tags: [release, security, csp]
---

# デッキ内スクリプトからTauriコマンドへの到達可能性(要判断)

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: デッキのレイアウト`<script>`はStudio本体と同じ文書内で実行される
ので、他人が作ったデッキを開いただけでTauriコマンド(ファイル書き込み
など)に到達できるのではないか、という懸念。まだ調査していない推測を
含むので`inbox`。

分かっていること:

- レイアウトの`<script>`はStudio内で実際に実行される(`todo/archive/
  layout-js-console-log.md`)。スライドはShadow DOM(`dom/slideCanvas.ts`)
  に入れており、`<iframe>`ではないので**Studio本体と同じ文書・同じJS
  コンテキスト**で動く(CLAUDE.mdの「Shadow DOMに変えたことで失った隔離」
  の項と同じ理由)。
- `tauri.conf.json`の`security.csp`は`null`。`withGlobalTauri`は未設定
  (=false)だが、`@tauri-apps/api`が使う`window.__TAURI_INTERNALS__`は
  ページに存在するはず(推測)。
- 登録済みコマンド(`lib.rs:271-289`)には`save_deck_source`(開いている
  デッキのパスにしか書かない)、`create_deck`(指定ディレクトリにscaffold
  を書く)、`read_deck_source`などがある。capabilitiesはコマンド単位では
  絞られていない。

確かめること:

1. 他人が作ったデッキを開いたとき、そのレイアウトの`<script>`が
   `window.__TAURI_INTERNALS__.invoke('create_deck', …)`のような呼び出し
   でファイルを書けるか(実機で、無害なコマンドで試す)。
2. できる場合、どこまでを受け入れるか。「デッキを開く=そのデッキの
   スクリプトを信頼する」はエディタ一般(VS Codeのワークスペース信頼など)
   と同じ話でもある。選択肢: (a) READMEで明記して受け入れる、(b) Tauri
   のisolation patternかCSPで`__TAURI_INTERNALS__`への到達を塞ぐ、
   (c) レイアウトJSの実行を設定でオフにできるようにする、(d) 描画を
   `<iframe>`(sandbox)に戻す — ただし右クリック/ドラッグの既知問題が
   再燃する(CLAUDE.md)。
3. `peitho present`/`peitho build`のビューアでも同じスクリプトが動くので、
   upstream側の扱い(信頼モデル)がどうなっているかを`mizzy/peitho`の
   docsで確認する。

これは機能追加ではなく判断事項なので、調査結果と決定をこのファイルに
書いてから`todo`か`rejected`にする。
