export const meta = {
  name: 'implement-todo',
  description: 'Implement peitho-studio todo/*.md plans end-to-end: PR, Pullfrog review, code-review/simplify, GWT tests, stacked if multiple',
  phases: [
    { title: 'Implement', detail: 'plan → implement → test → PR → review loop, per todo' },
  ],
}

if (!args?.todoPaths?.length) {
  throw new Error('args.todoPaths is required — pass one or more todo/*.md paths, e.g. { todoPaths: ["todo/action-click-feedback.md"] }')
}
const todoPaths = args.todoPaths

function taskPrompt(todoPath, index, total) {
  return `peitho-studio(このリポジトリ)の改善タスク計画 \`${todoPath}\` を、
企画の理解からPRレビュー完了まで一貫して担当してください。

## 1. 実装
- \`${todoPath}\` を全文読む。CLAUDE.md と docs/architecture.md のレイヤー
  分離ルール(domain/state/ipc/dom/components、engine/peitho.rs/lib.rs)に
  従って実装する。
- 計画の「スコープ」の「やらないこと」には手を出さない。
- 「完了条件」の「人間の判断が必要な項目」(実機確認など)には手を出さず、
  未チェックのまま残す。
- BarefootJSコンポーネント(.tsx)を編集するとき、またはシグナルの依存関係
  やリアクティブな更新の挙動が疑わしいときは \`barefootjs\` skillを使う。
  IRTest(\`@barefootjs/test\`)やbf CLI(\`bf debug graph\`等)から得られる
  情報はデバッグに役立つ。

## 2. テスト
- 機能要件は Given-When-Then 形式で書き、非エンジニアがテストを読むだけで
  「何を保証しているか」分かるようにする。
- 非機能要件(性能・堅牢性・エラー時の挙動など該当するものがあれば)は
  別のテストとして書く。
- 新規/変更した純粋関数には spec(典型入力)+ adversarial(境界値・不正
  入力・空文字)の両方を用意する。
- \`bun test\` / \`bun run typecheck\`(Rust変更があれば \`cargo test\`)を
  実行し、グリーンであることを確認する。
- 自分で書いたテストが通ることは「そのテストの呼び出し順・前提が実際の
  本番経路(Tauri commandの実際の呼び出し元、peitho-coreへの実データ、
  実機WKWebViewでのレンダリング)でも成り立つ」ことを保証しない。修正が
  実際に通る本番のエントリポイント(呼び出し元のTauri command名/UIの
  どの操作から発火するか)を名指しし、順序・タイミング・キャッシュ・
  クロスファイル状態への依存がないか、そのエントリポイントの実コードに
  対してトレースする。トレースし切れない場合(実機WKWebView依存など)は
  ごまかさず、「完了条件」の「人間の判断が必要な項目」として明示的に
  残す(1節のルールと同じ)。

## 3. コミットとPR
- このリポジトリのコミット粒度ルール(意味単位でコミットを分ける)に従って
  コミットする。
${total > 1 ? `- 今回は複数タスクの同時実行(${total}件中${index + 1}件目)です。
  \`gh-stack\` skillで、${index > 0 ? 'このタスクのブランチを直前のタスクの' : 'このタスクを'}
  ${index > 0 ? 'ブランチの上に積んでください(スタック済みPRにする)。' : 'スタックの起点となるPRにしてください。'}` : ''}
- \`gh pr create\` でPRを作成する。

## 4. セルフレビュー
- \`code-review\` skill、続けて \`simplify\` skill を自分の変更に対して
  実行し、指摘があれば対応する。

## 5. Pullfrogレビュー対応
- PRを作成したら、Pullfrogによる自動レビュー(PR作成/pushをトリガーに
  非同期で走る)が実際に投稿されるまで待つ。指摘があれば対応してプッシュ
  し、Pullfrogが最新のpush後のheadに対して改めてレビューし、未解決の
  指摘がなくなるまで繰り返す。
- 「自分では対応し終えた/問題ないはず」という自己判断だけでは「レビュー
  が通った」と見なさない。あくまでPullfrogが最新headに対して実際に
  レビューし、未解決の指摘がないことを確認する。

## 6. 仕上げ
- \`${todoPath}\` のfrontmatterの \`status\` を \`wip\` に更新する(まだ
  kfly8の最終確認が残っているため \`done\` にはしない)。
- レビュアーの割り当ては行わない(GitHubはPR作成者自身をレビュアーに
  指定できない仕様上の制約があるため)。代わりに \`gh pr comment\` で
  「@kfly8 Pullfrogレビュー完了、マージ準備ができました」という趣旨の
  コメントを投稿する(GitHub通知をトリガーするため)。
  - ただし、この通知は次の4条件をすべて満たした時点で一度だけ投稿する
    こと: (a) Pullfrogが最新headに対してレビュー済みで未解決の指摘が
    ない、(b) CIが通っている、(c) マージコンフリクトがない、(d) 自分
    自身であらためて最終差分(\`gh pr diff\`)を読み直し、見落としが
    ないことを確認した。5節の自己判断と同様、「Pullfrogのレビューが
    走る前」や「pushした直後でまだ結果を確認していない」タイミングで
    このコメントを投稿しない。

## 7. 報告
最後に、PRのURL・実装内容の要約・残っている「人間の判断が必要な項目」を
簡潔に報告してください。`
}

const results = await pipeline(
  todoPaths,
  (todoPath, _item, index) => agent(
    taskPrompt(todoPath, index, todoPaths.length),
    { label: `implement:${todoPath}`, phase: 'Implement', isolation: 'worktree' }
  )
)

return results.map((r, i) => ({ todoPath: todoPaths[i], report: r }))
