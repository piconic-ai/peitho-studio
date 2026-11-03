# コード複雑度の計測

[cccc](https://github.com/moznion/cccc) v1.8.5 で、関数ごとの cognitive complexity と cyclomatic complexity を測定する。
CI は **cognitive complexity が15を超える関数が1件でもあれば失敗**する。15ちょうどは許容する。
ベースラインや関数ごとの例外は設けない。
cyclomatic complexity は参考値として計測し、10を超える件数を表示するが、CI の合否には使わない。

## ローカルでの計測

Bun と cccc v1.8.5 を用意する。
cccc は [v1.8.5 リリース](https://github.com/moznion/cccc/releases/tag/v1.8.5) から OS と CPU に合うバイナリを取得し、同梱の SHA-256 を確認して `PATH` に置く。
計測スクリプトは別バージョンの cccc を拒否する。

```sh
bun run complexity
```

`scripts/complexity.js` が計測と判定を実行し、次のファイルを出力する。

- `complexity-results/report.json` は両指標の全件の生データ。
- `complexity-results/summary.md` は cognitive 超過関数の一覧と、参考値の cyclomatic 超過件数。

関数名には親関数を含め、ファイルと行番号で場所を示す。
cognitive 超過で失敗した場合もレポートを残す。
ツールの失敗、構文解析エラー、空の計測結果、不完全な関数件数も失敗にする。

## CI

`test` ワークフローの `complexity` ジョブが、テスト CI の実行ごとに1回計測する。
手動実行と定期更新 PR からの実行も含む。
他のテストジョブと並列に実行し、その成否を待たずに計測する。
checker 自体のテストは `bun test scripts/complexity.test.js` で実行する。
計測結果をジョブサマリーと30日間の artifact に保存する。

## 計測範囲

`cccc.toml` に従い、JavaScript、TypeScript、TSX、Rust、Python、Swift を再帰的に測定する。
フロントエンド、Rust バックエンド、site、ビルド・保守スクリプトと設定を含む。
テスト専用ファイル、fixture、Rust examples、依存パッケージ、生成物は除く。
`.claude/workflows/*.js` はワークフロー DSL のため対象外。HTML 内のスクリプトと CSS も含めない。

Rust の `#[cfg(test)] mod tests` は本番コードと同一ファイルにあり、cccc の CLI では除外できないため、関数総数に含まれる。
ネストした関数は、それぞれ独立して数える。
