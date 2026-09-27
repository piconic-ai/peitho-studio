---
status: inbox
description: Studio内でfrontmatter(やデッキ全体のテキスト)を直接編集できるUIを検討する
tags: [editor, frontmatter, deck-settings]
---

# frontmatterを直接編集するUI

進捗管理用の作業台帳 — **完了したら削除ないし`todo/archive/`へ移動する**。

発端: デッキ設定の配置を検討した壁打ち(2026-09-28)で、ユーザーから
「(frontmatterは)ファイルを直接開けばできる。Studio内にテキストを直接
編集できるUIがあっても良いかもしれない」。`css`/`layouts`/`fonts`/
`syntaxes`/`code_images`など、専用UIを作らないキーの編集手段になる。

## 分かっていること

- Studioのエディタはスライド単位の本文とノートだけを扱い、frontmatterは
  表示も編集もしない(`components/SlideEditor.tsx`)。frontmatterは
  `rebuildSource`(`Studio.tsx:828-834`)が`prefix`としてそのまま保持して
  いる。
- 外部エディタでの変更はファイル監視(`handleExternalChange`)で
  取り込まれる。
