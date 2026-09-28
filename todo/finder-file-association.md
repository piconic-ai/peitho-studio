---
status: wip
description: FinderでMarkdownファイルの「このアプリケーションで開く」候補にPeitho Studioを出し、実際に開けるようにする
tags: [tauri-config, macos]
---

# FinderのMarkdownファイル関連付け

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: ユーザーがFinderで`.md`ファイルを右クリック→「このアプリケーションで開く」を
開いたところ、候補にPeitho Studioが出ない(Xcode/Bear/Chromium等は出る)。
候補に出るようにしてほしいとの要望。`todo/archive/release-app-metadata.md`の
「先送り事項」に「`.md`のファイル関連付け(`bundle.fileAssociations`)と、
Finderからダブルクリックで開くための`RunEvent::Opened`処理」がリリース後の
別タスクとして既に記録されており、その継続。

## スコープ

- **目的**: Finderの「このアプリケーションで開く」候補にPeitho Studioを表示し、
  `.md`ファイルをダブルクリック(または右クリック→このアプリケーションで開く)
  した際に、そのファイルをデッキとして実際に開けるようにする。
- **やらないこと**:
  - `.md`をPeitho Studio専用の「デフォルトアプリ」に切り替える操作(ユーザーが
    Finderの情報パネルで行うOS側の設定であり、コード側で強制しない)。
  - Windows/Linuxのファイル関連付け(プロジェクトの`bundle.targets`は
    `["app", "dmg"]`でmacOS専用)。
  - アプリ内へのドラッグ&ドロップ(`todo/image-drop-paste.md`が別途担当)。
  - `peitho`CLIの検出(`todo/peitho-cli-discovery.md`)とは無関係。
- **受け入れ条件**:
  - `bunx tauri build`で作った`.app`をFinderで右クリック→「このアプリケーション
    で開く」→「その他...」から一度選ぶ(またはLaunchServices再登録後)、`.md`
    ファイルの候補リストにPeitho Studioが出る。
  - Peitho Studioが起動していない状態で`.md`ファイルをダブルクリックすると、
    そのファイルをデッキとして開いたウィンドウが立ち上がる。
  - Peitho Studioが既に起動している状態で別の`.md`ファイルをダブルクリックする
    と、新規ウィンドウでそのデッキが開く(既に開いているデッキなら既存ウィンドウ
    にフォーカスするだけ、という`open_deck_window_impl`の既存挙動を踏襲)。
  - 開こうとしたファイルが存在しない/読み込めない場合、無反応やクラッシュでは
    なく何らかのエラー表示になる。

## 背景・要調査

実際に読んで分かったこと:

- `src-tauri/tauri.conf.json` / `tauri.macos.conf.json` に`bundle.fileAssociations`
  が未設定。Tauri v2の`FileAssociation`型(`node_modules/@tauri-apps/cli/
  config.schema.json`の`FileAssociation`/`ExportedFileAssociation`定義)は
  `ext`, `name`, `role`(既定`Editor`), `mimeType`, `exportedType`
  (`UTExportedTypeDeclarations`)などを持ち、ビルド時にInfo.plistへ
  `CFBundleDocumentTypes`を書き込む。
- `.md`にはmacOS標準のUTIが存在せず、多くのアプリ(Bearなど、このスクリーン
  ショットにも実際に写っている)が慣習的に`net.daringfireball.markdown`を使う。
  新規に`exportedType`で独自UTIを宣言するか、この慣習的な識別子に相乗りするか
  の選択が要る(下記「方針」参照)。
- `src-tauri/src/lib.rs`の`.run(|app_handle, event| ...)`(lib.rs:349-355)は
  現状`tauri::RunEvent::Exit`しか処理していない。Tauri v2の
  `RunEvent::Opened { urls }`がmacOSの`application:openURLs:`(Finderからの
  ダブルクリック/ドラッグ、「このアプリケーションで開く」)に対応する。
- デッキを開く中心的な処理は`open_deck_window_impl(app, pending, session,
  path: String)`(`src-tauri/src/peitho.rs:510`)。既存の「Open Deck…」メニュー
  ・「Open Recent」・デッキ言語バリアント切り替えが全部ここを通る。`path`は
  ファイル・フォルダどちらでも受け付ける — 実際の解決は`resolve_deck_path`
  (`peitho.rs:302`)がフォルダなら`deck.md`を補い、直接ファイルパスならそのまま
  使う(spec: `resolve_deck_path_spec_accepts_a_direct_file_path`)。既に開いて
  いるデッキなら新規ウィンドウを作らずそのウィンドウにフォーカスする
  (`peitho.rs:511-517`)。
- `tauri.conf.json`の`app.windows`にラベル省略の初期ウィンドウが1つ定義されて
  おり(既定ラベル`main`)、起動直後はこのウィンドウがウェルカム画面を表示する。
  `open_deck_window_impl`は常に新規ウィンドウ(`deck-N`)を作る作りなので、
  「起動直後にFinderからファイルを開いた」場合そのままこの関数を呼ぶと、
  ウェルカム画面のままの`main`ウィンドウとデッキが開いた新規ウィンドウの2枚が
  同時に立ち上がる形になる(下記「方針」の案Bで回避する)。
- Trust: `open_deck`は`is_deck_dir_trusted`で信頼済みディレクトリかを判定し、
  フロント側に信頼ダイアログの仕組みがある(直近のコミット履歴にも「Save trust
  for a deck opened by a bare file name」がある)。Finder越しに未信頼のデッキを
  開くケースも、この既存フローに乗るだけで良いはず(要確認: 新規ウィンドウ作成
  後、`take_pending_deck`を消費するタイミングで信頼ダイアログが正しく出るか)。

要調査:

1. `RunEvent::Opened`が実機でどのタイミングで発火するか — 未起動からのダブル
   クリック時、`setup()`より後に飛んでくるか(Tauri v2のドキュメント/実機で
   要確認)。
2. `net.daringfireball.markdown`のUTIを宣言することで実際にFinderの候補
   リストに出るか(このスクリーンショットと同じ環境で確認)。

## 方針

起動時ウィンドウの扱いは案Bで決定(ユーザーと相談の上で選択): `RunEvent::
Opened`の時点でまだどのウィンドウもデッキを開いていない(`PeithoSession`が
空)なら、新規ウィンドウを作らず`main`ウィンドウに対して直接`pending`へ登録
する。既にどこかでデッキが開いている場合は、従来通り`open_deck_window_impl`
で新規ウィンドウを開く(複数URLも同様、1件ごとにこの判定を行う — 2件目以降は
1件目で`PeithoSession`が埋まるので新規ウィンドウ行きになる)。

案Aだった「常に`open_deck_window_impl`を呼ぶ」は不採用 — 起動直後に開くと
ウェルカム画面の`main`ウィンドウとデッキが開いた新規ウィンドウの2枚が並んで
しまい、UXとして不自然なため。

UTI宣言は、Bearなど先行アプリと同じ`net.daringfireball.markdown`を
`contentTypes`として書くか、独自に`exportedType`を新規宣言するかの2択。
同じ識別子を使う方が「他のMarkdownエディタと同じ扱いになる」ので望ましい
(先行例に合わせる)。

複数ファイル同時オープン(`urls`が複数)は、各URLについて`open_deck_window_impl`
をループで呼ぶ(各ファイルごとに1ウィンドウ)。

## レイヤー配置

- `src-tauri/tauri.conf.json`または`tauri.macos.conf.json`: `bundle.
  fileAssociations`設定のみ。
- `src-tauri/src/lib.rs`: `.run()`内の`RunEvent::Opened`ハンドリング(配線
  のみ)。URLをファイルパスへの変換は`url.to_file_path()`(std)。
- `src-tauri/src/peitho.rs`: 案Bを取る場合、「開いているセッションが1つも
  ない」判定など新規ロジックが必要なら、既存の`PeithoSession`に生やす。状態
  管理はここに閉じる。

## テスト

- Rust: URLをファイルパスへ変換する部分に、変換できないURL(http URLなど)を
  渡した場合にpanicせず無視する、というadversarialケースを想定(純粋関数として
  切り出せるなら`peitho.rs`のテストに追加)。
- 既存の`resolve_deck_path`のテストは変更不要(ファイルパス直渡しは既に
  spec: `resolve_deck_path_spec_accepts_a_direct_file_path`でカバー済み)。
- e2e: `RunEvent::Opened`はTauriランタイムの起動イベントであり、mockTauriの
  対象範囲外(IPCコマンドではない)なので自動テストでは検証できない。実機確認
  に委ねる。

## 完了条件

自動で確認できる項目(ループが自分で判定してよい):
- [x] `cargo test` グリーン(257 passed)
- [x] `bunx tauri build`が成功し、生成された`.app`のInfo.plistに
  `CFBundleDocumentTypes`が入っている(`plutil -p`等で確認できる) —
  実際に確認: `role: Editor`, `LSItemContentTypes: net.daringfireball.markdown`
- [x] `bun test` / `bun run typecheck` グリーン
- [x] `bun run test:e2e` グリーン(追加分含む、245 passed)

人間の判断が必要な項目(ここに到達したら一旦止めて委ねる):
- [ ] 実機で、Finderの「このアプリケーションで開く」候補にPeitho Studioが
  表示されること
- [ ] 実機で、未起動状態から`.md`ファイルをダブルクリックして実際にデッキが
  開くこと
- [ ] 実機で、起動済み状態から別の`.md`ファイルをダブルクリックした場合、
  新規ウィンドウでそのデッキが開くこと
- [ ] 未信頼のデッキをFinder越しに開いた場合、信頼ダイアログが正しく機能する
  こと

## 実装メモ(PR #125)

- `tauri.conf.json`の`bundle.fileAssociations`に`ext: ["md"]` +
  `contentTypes: ["net.daringfireball.markdown"]`(方針どおり、独自
  `exportedType`は宣言せず先行アプリのUTIに相乗り)。`bunx tauri build`後の
  Info.plistで`CFBundleDocumentTypes`に反映されることを確認済み。
- `lib.rs`の`.run()`に`RunEvent::Opened { urls }`を追加(配線のみ)。実際の
  判断ロジックは`peitho.rs`の`open_finder_urls`/`finder_open_target`
  (純粋関数、テストあり)に切り出した。`main_claimed`という呼び出しループ
  内のローカルフラグで「同一バッチ内で`main`を使い切ったか」を追跡している
  — `PeithoSession`自体は フロント側の非同期`open_deck`往復が終わるまで
  更新されないため、複数URL一括オープン時に2件目以降が`PeithoSession`の
  状態だけからは`main`が埋まったと判定できない(方針の「2件目以降は
  新規ウィンドウ行きになる」を、この意味で実現している)。
- 本番経路のトレース(1節参照)で見つけた実バグ: `components/Studio.tsx`の
  `onMount`は「`take_pending_deck`で何か受け取ったウィンドウは、その
  デッキを見せる専用に生成された使い捨てウィンドウ(`open_deck_window_impl`
  が作る`deck-N`)である」という前提で、開けなかったら
  `getCurrentWindow().close()`していた。この前提は今回`main`ウィンドウにも
  `pending`を積むことで崩れる — `main`(たいてい唯一のウィンドウ)が
  存在しないファイルを渡された場合、そのままだとウィンドウごと閉じてしまい、
  受け入れ条件の「無反応やクラッシュではなくエラー表示になる」に反する。
  `getCurrentWindow().label !== 'main'`を条件に追加して修正し、
  `e2e/finder-open-pending-deck.e2e.ts`にこの回帰を再現する
  テストを追加した(修正を一時的に戻して実際に落ちることを確認済み)。
  `e2e/helpers/mockTauri.ts`の`take_pending_deck`は常に`null`を返していた
  ため、`MockDeck.pendingDeck`を追加してこのケースを再現できるようにした。
- Rust側のURL→パス変換(`finder_url_to_path`)は`http(s)://`等の非file
  URLを無視するアドバーサリアルテストを追加。`PeithoSession::is_empty`は
  他の状態アクセサ(`has_session`など)と同様、既存の慣習に合わせて
  直接のユニットテストは書いていない(呼び出し元の`finder_open_target`側で
  決定ロジックをテスト済み)。
- 実機WKWebView依存の項目(上の「人間の判断が必要な項目」)に加え、
  `RunEvent::Opened`が実機でいつ発火するか(`setup()`より前か後か)は
  静的なコードトレースだけでは確定できない — `main`ウィンドウの
  フロントエンドが`take_pending_deck()`を(`onMount`で)呼んだ**後**に
  `RunEvent::Opened`が届いた場合、`pending`への書き込みは誰にも
  消費されないまま残る可能性がある。方針どおり`PendingDecks`を使う実装に
  留め、新規IPCイベントの追加はしていない(レイヤー配置の指示どおり
  フロント側の新規プラミングは避けた)ため、この一点は実機確認に委ねる。

## 先送り事項

- Windows/Linuxのファイル関連付け(プロジェクトが現状macOS専用のため対象外)。
- Dockアイコンへのドラッグ&ドロップでの起動(同じ`RunEvent::Opened`で拾える
  はずだが、この完了条件では検証しない)。
