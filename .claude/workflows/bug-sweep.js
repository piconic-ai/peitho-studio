export const meta = {
  name: 'bug-sweep',
  description: 'Fix a reported Studio bug only after sweeping the same kind of operation across every layout, element and input variant against the real engine',
  whenToUse: 'A user reports one failing operation (an error banner, lost text, an edit that stops working). Pass the report verbatim as args.report.',
  phases: [
    { title: 'Reproduce', detail: 'fresh worktree, real engine built, reported error reproduced, root cause named' },
    { title: 'Sweep', detail: 'the reported operation as a matrix: standard layouts × elements × input variants, real-engine e2e' },
    { title: 'Triage', detail: 'group failures by cause, then try to refute each in turn: app bug / test artifact / design question / pre-existing flake' },
    { title: 'Fix', detail: 'one commit per confirmed cause, each with unit + e2e regressions that fail without it' },
    { title: 'Verify', detail: 'rerun everything; a completeness critic names uncovered variants, swept once more if any' },
    { title: 'PR', detail: 'only with args.pr, all green and nothing left uncovered: open the PR and loop until Pullfrog has no unresolved finding on the latest head' },
  ],
}

if (typeof args?.report !== 'string' || args.report.trim() === '') {
  throw new Error('args.report is required — the user\'s bug report verbatim, e.g. { report: "タイトルを編集したら slot \'body\' got 2 item(s) が出た", deck: "~/Desktop/hoge", pr: true }')
}
const report = args.report
const deck = args.deck ?? null
const openPr = args.pr === true

// Every agent that may run e2e runs alone (they share one worktree's build
// and server), but other worktrees may be running theirs: keep clear of 3013
// (default) and 3014-3019 (by hand).
const E2E_PORT = 3021

const CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    worktree: { type: 'string', description: 'Absolute path of the worktree all later stages work in.' },
    branch: { type: 'string' },
    reproduced: { type: 'boolean' },
    operation: { type: 'string', description: 'The user-level operation that failed, generalized (e.g. "clear a canvas text element, then write into it again").' },
    rootCause: { type: 'string', description: 'The cause in code terms, with file:line. "" if not reproduced.' },
    reproSteps: { type: 'string', description: 'How it was reproduced: the draft Markdown, the e2e steps, the exact error text.' },
    axes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Matrix axes the sweep should cover for this operation (layouts, element kinds, input variants such as same-edit/emptied-slot/line breaks/IME/delete-as-object/Undo/Markdown-editor interplay).',
    },
  },
  required: ['worktree', 'branch', 'reproduced', 'operation', 'rootCause', 'reproSteps', 'axes'],
}

const FAILURES_SCHEMA = {
  type: 'object',
  properties: {
    specPath: { type: 'string' },
    total: { type: 'number', description: 'How many cases the sweep ran.' },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          caseName: { type: 'string' },
          symptom: { type: 'string', description: 'What went wrong: the error banner text, or the text/slot that ended up wrong.' },
          markdown: { type: 'string', description: 'The draft Markdown at the moment of failure.' },
        },
        required: ['caseName', 'symptom', 'markdown'],
      },
    },
  },
  required: ['specPath', 'total', 'failures'],
}

const CLUSTERS_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cause: { type: 'string', description: 'The suspected single cause, with file:line.' },
          caseNames: { type: 'array', items: { type: 'string' } },
        },
        required: ['cause', 'caseNames'],
      },
    },
  },
  required: ['clusters'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['app-bug', 'test-artifact', 'design-question', 'pre-existing-flake'] },
    evidence: { type: 'string', description: 'What was run or read to decide, e.g. the same case on origin/main, a stress run, the code path.' },
    fix: { type: 'string', description: 'For app-bug: the fix to make. For test-artifact/flake: how the test should change. For design-question: the question to put to the user.' },
  },
  required: ['kind', 'evidence', 'fix'],
}

const FIXED_SCHEMA = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' }, description: '"<sha> <subject>" per commit.' },
    skipped: { type: 'array', items: { type: 'string' }, description: 'Confirmed causes left unfixed, each with the reason.' },
  },
  required: ['commits', 'skipped'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    green: { type: 'boolean', description: 'bun test, typecheck, cargo test (if Rust changed), the full e2e suite and the sweep all pass.' },
    results: { type: 'string', description: 'Pass/fail counts per suite.' },
    uncovered: {
      type: 'array',
      items: { type: 'string' },
      description: 'Variants of the operation the sweep still does not exercise and that could plausibly fail (empty when nothing worthwhile is left).',
    },
  },
  required: ['green', 'results', 'uncovered'],
}

const PR_SCHEMA = {
  type: 'object',
  properties: {
    prUrl: { type: 'string' },
    pullfrogClean: { type: 'boolean' },
    checks: { type: 'string' },
  },
  required: ['prUrl', 'pullfrogClean', 'checks'],
}

const HARNESS = `## 実エンジンでの検証環境
- e2e は \`e2e/helpers/realEngine.ts\` の \`startRealEngine()\` を \`mockTauri\` の
  \`realEngine\` に渡し、peitho-core の実際の出力（slot の arity・routing 判定）で
  描画する。既存の \`e2e/real-engine-clear-retype.e2e.ts\` を手本にする
  （デッキは \`engine.newDeck()\` で新規デッキと同じ標準 layout を作る）。
- バイナリは worktree の \`src-tauri/\` で \`cargo build --example e2e_engine\`。
  build.rs が crit sidecar を要求するので、無ければ本体リポジトリの
  \`src-tauri/binaries/crit-*\` を worktree の \`src-tauri/binaries/\` にコピーする。
- e2e の実行は必ず \`E2E_PORT=${E2E_PORT}\` を付ける。
- テストで再現できない限り、原因を推測で断定しない。`

function where(context) {
  return `作業ディレクトリは worktree \`${context.worktree}\`（ブランチ \`${context.branch}\`）。
本体の作業ツリーはユーザーの \`tauri dev\` が使っているので触らない。`
}

function caseList(failures) {
  return failures.map(f => `- ${f.caseName}: ${f.symptom}\n  Markdown: ${JSON.stringify(f.markdown)}`).join('\n')
}

function reproducePrompt() {
  return `peitho-studio の不具合報告を受けました。修正の前に、確実に再現して原因を特定してください。

## 報告（ユーザーの原文）
${report}
${deck ? `\n対象デッキ: \`${deck}\`（読むだけ。書き換えない）\n` : ''}
## やること
1. \`origin/main\` を起点に新しい worktree とブランチを作る
   （\`git worktree add -b <branch> ../peitho-studio-<短い名前> origin/main\`）。
2. 実エンジンの検証環境を用意する（下記）。
3. 報告の操作を real-engine e2e で再現する。peitho のエラーなら、そのときの下書き
   Markdown を \`peitho build\` や e2e_engine の render_draft にかけて、同じエラー文が
   出ることも確かめる。
4. 原因をコードの位置（file:line）で特定する。まだ直さない。
5. この操作を一般化し（例: 「キャンバスの要素の中身を消して書き直す」）、
   網羅すべき軸を挙げる: 標準 layout、要素の種類（見出し・段落・リスト・fence 付き
   slot・footnotes など）、入力の仕方（同じ編集中に続けて入力 / 確定後に空の slot へ
   入力 / 改行 / IME の composition / オブジェクトとして削除 / Undo / Markdown エディタ
   との行き来）。

${HARNESS}`
}

function sweepPrompt(context, extraAxes) {
  return `${where(context)}

報告された不具合「${context.operation}」と同じ種類の操作で、ほかにも壊れる組み合わせが
ないかを網羅的に洗い出してください。まだ直さないでください。

## 再現済みの原因
${context.rootCause}

## 網羅する軸
${[...context.axes, ...extraAxes].map(a => `- ${a}`).join('\n')}

## やること
- real-engine e2e の spec（\`e2e/real-engine-<操作名>.e2e.ts\`、既存があれば追記）で、
  軸の組み合わせをデータ駆動で生成する。期待値は「エラーバナーが出ない」かつ
  「入力した文字が操作した要素と同じ slot に入る」を基本とし、操作に合わせて足す。
- 実行し、失敗したケースごとに症状と、その時点の下書き Markdown を記録する
  （\`editorText\` で取得）。
- 失敗を減らすためにテストの期待値をゆるめない。仕様かどうかの判断は後工程が行う。

${HARNESS}`
}

function clusterPrompt(context, sweep) {
  return `${where(context)}

網羅テスト（\`${sweep.specPath}\`、${sweep.total}ケース）で次のケースが失敗しました。
原因ごとにまとめてください。同じ原因に見えるものは1つにまとめ、根拠となるコードの
位置を挙げる。必要ならケースを個別に実行して確かめる（\`E2E_PORT=${E2E_PORT}\`）。

${caseList(sweep.failures)}`
}

function refutePrompt(context, cluster, failures) {
  return `${where(context)}

網羅テストの失敗が、次の原因によるものだと疑われています。これがアプリの不具合だという
主張を、反証するつもりで検証してください。

## 疑われている原因
${cluster.cause}

## 該当ケース
${caseList(failures.filter(f => cluster.caseNames.includes(f.caseName)))}

## 判定
- **test-artifact**: テストや mock の都合で落ちている（実アプリでは起きない）。
- **pre-existing-flake**: タイミング依存。\`--repeat-each\` と多めの \`--workers\` で
  負荷をかけ、origin/main のコードでも同じように落ちるかを比べる。
- **design-question**: 意図された挙動かもしれない（コード内のコメントや、意図的な
  除外がないかを見る）。勝手に「仕様」と決めず、ユーザーへの質問として書く。
- **app-bug**: 上のどれでもなく、実アプリで起きる不具合。
迷ったら app-bug と決めず、根拠を書いたうえで design-question にする。`
}

function fixPrompt(context, confirmed) {
  return `${where(context)}

次の不具合（検証済み）を直してください。

${confirmed.map((c, i) => `### ${i + 1}. ${c.cause}\n根拠: ${c.verdict.evidence}\n方針: ${c.verdict.fix}`).join('\n\n')}

## ルール
- 原因1つにつき1コミット（このリポジトリのコミット粒度ルール）。テストやフレークの
  修正も、それぞれ別コミットにする。
- 純粋関数を足すか変えたら、spec と adversarial の両方の unit テストを書く。
- それぞれの修正に、修正なしでは落ちる e2e の回帰テストを付け、実際に落ちることを
  確かめてから修正を入れる。
- 直さなかったものは、理由とともに skipped に入れる。`
}

function verifyPrompt(context, sweepSpec) {
  return `${where(context)}

修正後の状態を検証してください。

1. \`bun test\`、\`bun run typecheck\`、Rust を変えていれば \`cargo test\`、e2e 全体
   （\`E2E_PORT=${E2E_PORT} bun run test:e2e\`）、網羅テスト \`${sweepSpec}\` を実行する。
2. 完全性の批評: 報告の操作「${context.operation}」について、網羅テストがまだ試して
   いない入力の仕方・要素・layout のうち、壊れる可能性が現実的にあるものを挙げる。
   挙げたものは実装しない（次の周回で網羅テストに足す）。理論上の可能性にすぎない
   ものは挙げない。

${HARNESS}`
}

function prPrompt(context, summary) {
  return `${where(context)}

このブランチを push し、\`main\` 向けの PR を作成してください。

## PR 本文に含めること
${summary}

## Pullfrog
- PR 作成と push をきっかけに、Pullfrog のレビューが非同期で走る。投稿されるまで待ち、
  指摘があれば対応して push する。最新の head に対して未解決の指摘がなくなるまで
  繰り返す。
- CI（e2e と e2e-real-engine を含む）も最後まで見届ける。今回の変更と無関係の
  フレークで落ちた場合は、origin/main でも再現するかを確かめて、別コミットで直す。`
}

phase('Reproduce')
const context = await agent(reproducePrompt(), { label: 'reproduce', phase: 'Reproduce', schema: CONTEXT_SCHEMA })
if (!context) throw new Error('reproduce stage returned nothing')
if (!context.reproduced) {
  log('報告の操作を再現できませんでした。網羅テストは行わずに終了します。')
  return { reproduced: false, context }
}
log(`原因: ${context.rootCause}`)

const confirmedAll = []
const designQuestions = []
const artifacts = []
let extraAxes = []
let sweepSpec = null
let critique = null

// Round 2 runs only on what the completeness critic said round 1 missed.
for (let round = 1; round <= 2; round++) {
  phase('Sweep')
  const sweep = await agent(sweepPrompt(context, extraAxes), { label: `sweep:round${round}`, phase: 'Sweep', schema: FAILURES_SCHEMA })
  if (!sweep) throw new Error(`sweep round ${round} returned nothing`)
  sweepSpec = sweep.specPath
  log(`周回${round}: ${sweep.total}ケース中 ${sweep.failures.length}件が失敗`)

  if (sweep.failures.length > 0) {
    phase('Triage')
    const { clusters } = await agent(clusterPrompt(context, sweep), { label: `cluster:round${round}`, phase: 'Triage', schema: CLUSTERS_SCHEMA })
    // One at a time: refuters run stress e2e in the same worktree, and two
    // at once would race its build and server instead of judging the bug.
    const judged = []
    for (const [i, cluster] of clusters.entries()) {
      const verdict = await agent(refutePrompt(context, cluster, sweep.failures), { label: `refute:${round}.${i + 1}`, phase: 'Triage', schema: VERDICT_SCHEMA })
      if (verdict) judged.push({ ...cluster, verdict })
    }
    const unjudged = clusters.length - judged.length
    if (unjudged > 0) log(`${unjudged}件の原因が未判定のまま残りました（検証エージェントが結果を返さなかった）`)

    const toFix = judged.filter(c => c.verdict.kind === 'app-bug' || c.verdict.kind === 'test-artifact' || c.verdict.kind === 'pre-existing-flake')
    designQuestions.push(...judged.filter(c => c.verdict.kind === 'design-question'))
    artifacts.push(...judged.filter(c => c.verdict.kind !== 'app-bug' && c.verdict.kind !== 'design-question'))
    confirmedAll.push(...judged.filter(c => c.verdict.kind === 'app-bug'))

    if (toFix.length > 0) {
      phase('Fix')
      const fixed = await agent(fixPrompt(context, toFix), { label: `fix:round${round}`, phase: 'Fix', schema: FIXED_SCHEMA })
      if (fixed?.skipped.length) log(`直さなかったもの: ${fixed.skipped.join(' / ')}`)
    }
  }

  phase('Verify')
  critique = await agent(verifyPrompt(context, sweepSpec), { label: `verify:round${round}`, phase: 'Verify', schema: CRITIC_SCHEMA })
  if (!critique) throw new Error(`verify round ${round} returned nothing`)
  log(`検証: ${critique.results}`)
  if (critique.uncovered.length === 0) break
  if (round === 2) log(`2周で打ち切り。未網羅のまま残ったもの: ${critique.uncovered.join(' / ')}`)
  extraAxes = critique.uncovered
}

const summary = [
  `報告: ${report}`,
  `原因（報告分）: ${context.rootCause}`,
  `網羅で見つけて直した不具合: ${confirmedAll.map(c => c.cause).join(' / ') || 'なし'}`,
  `テスト側・フレークとして直したもの: ${artifacts.map(c => c.cause).join(' / ') || 'なし'}`,
  `ユーザーに判断を仰ぐ点: ${designQuestions.map(c => c.verdict.fix).join(' / ') || 'なし'}`,
  `検証結果: ${critique.results}`,
  `網羅しきれなかったもの: ${critique.uncovered.join(' / ') || 'なし'}`,
  '実機の WKWebView では未確認（IME は Chrome の composition イベントでの再現のみ）。',
].join('\n')

// A sweep that still knows of uncovered variants isn't finished: leave the
// call on those to the user rather than publishing the fix as swept.
let pr = null
if (openPr && critique.green && critique.uncovered.length === 0) {
  phase('PR')
  pr = await agent(prPrompt(context, summary), { label: 'pr', phase: 'PR', schema: PR_SCHEMA })
} else if (openPr) {
  log(critique.green ? '網羅しきれなかったものが残っているため PR は作成しませんでした。' : 'テストがグリーンではないため PR は作成しませんでした。')
}

return {
  worktree: context.worktree,
  branch: context.branch,
  rootCause: context.rootCause,
  bugs: confirmedAll.map(c => ({ cause: c.cause, evidence: c.verdict.evidence })),
  artifacts: artifacts.map(c => ({ kind: c.verdict.kind, cause: c.cause })),
  designQuestions: designQuestions.map(c => c.verdict.fix),
  green: critique.green,
  results: critique.results,
  uncovered: critique.uncovered,
  summary,
  pr,
}
