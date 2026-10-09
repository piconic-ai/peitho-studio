// Every message the Studio UI shows, in each `Language`. Both tables are
// typed as `Messages`, so a message missing from either (or one table
// holding a key the other lacks) is a type error, not a blank label found
// on a real device.
//
// Out of scope, shown as they arrive: a deck's own content, and the error
// messages peitho-core and the Rust side return. The native menu bar's
// labels live Rust-side (`src-tauri/src/i18n.rs`).
import type { Language } from './language'
import type { DevicePresetId } from './viewport'

export interface Messages {
  // Welcome screen
  openDeck: string
  newDeck: string
  opening: string
  recentDecks: string
  openDeckDialogTitle: string
  newDeckLocationDialogTitle: string

  // New Deck modal
  newDeckTitle: string
  deckNamePlaceholder: string
  /** The New Deck dialog's aspect ratio and language pickers, named as in
   * the Edit menu's deck settings. */
  newDeckAspectRatio: string
  newDeckLanguage: string
  cancel: string
  create: string
  creating: string

  // Deck header
  switchDeckVariant: string
  present: string
  presentPending: string
  presentOptions: string
  presentRehearsal: string
  presentRehearsalDetail: string

  // Script trust banner
  scriptsDisabled: string
  trustAndRun: string
  trustingDeck: string

  // Status bar
  copyError: string
  errorCopied: string
  /** The error bar's button on a build error: it goes to the AI in crit,
   * written to disk first when it is the editor's own typing
   * (todo/send-build-error-from-error-bar.md). */
  sendErrorToAi: string
  /** In the button's place once the error was sent and the AI is at
   * work on it (`domain/errorBar.ts`). */
  aiFixingError: string

  // Slide editor
  speakerNotes: string
  speakerNotesPlaceholder: string
  selectSlideToEdit: string
  loadingDeck: string
  /** The whole-deck repair editor offered while the deck doesn't build
   * (`domain/sourceEditing.ts`): why it exists, and its toggle's two
   * labels. */
  deckSourceHint: string
  editDeckSource: string
  backToSlide: string

  // Slide list
  openDeckToSeeSlides: string
  expandSection: string
  collapseSection: string
  sectionName: string
  sectionMinutes: string
  sectionSeconds: string
  minutesUnit: string
  secondsUnit: string
  editSection: string
  slideFallbackTitle: (position: number) => string
  draftBadge: string
  skipBadge: string
  /** The badge of a slide isolated from the render for not building
   * (`domain/brokenSlides.ts`). */
  errorBadge: string
  /** The error bar while slides are isolated: how many, then the first
   * one's own error (peitho-core's headline). */
  slidesDoNotBuild: (count: number, headline: string) => string

  // Slide context menu
  newSlide: string
  cut: string
  copy: string
  paste: string
  delete: string
  changeLayout: string
  loading: string
  noLayouts: string
  markAsDraft: string
  skipInPresent: string
  sectionStart: string
  hidePageNumber: string
  moveSlideUp: string
  moveSlideDown: string
  layoutChecking: string
  layoutMismatch: (layout: string, reason: string) => string

  // Layout screen (the header's Slides / Layouts switch)
  studioModeSlides: string
  studioModeLayouts: string
  newLayout: string
  newLayoutName: string
  newLayoutFrom: string
  blankLayout: string
  layoutNameEmpty: string
  layoutNameTooLong: string
  layoutNameInvalid: string
  layoutNameStart: string
  layoutNameTaken: string
  applyLayoutToSlide: string
  /** Why Apply is off: no slide is selected in the slides screen. */
  applyLayoutNeedsSlide: string
  editLayout: string
  duplicateLayout: string
  deleteLayout: string
  /** The comment item every right-click menu opens with
   * (`domain/menuComment.ts`): the same label whatever it's on — the
   * comment box's header says what. */
  comment: string
  layoutUsage: (count: number) => string
  /** Why Delete is off for the deck's only layout. */
  onlyLayoutCannotBeDeleted: string
  deleteLayoutConfirm: (layout: string) => string
  deleteLayoutMoveSlides: (layout: string, count: number) => string
  deleteLayoutMoveTo: string
  deleting: string
  savingLayout: string
  layoutUnsaved: string
  /** The close button on editor tab `name`. */
  closeTab: (name: string) => string
  /** No file open in the layout editor. */
  noFileOpen: string
  /** An open file deleted on disk while it held unsaved edits. */
  fileGone: string
  /** Why the editor's file shown can't be left yet (its tab closed, the
   * slides, a new layout): its edits couldn't be saved. Any file — a
   * layout's, or one no layout owns (`css/base.css`). */
  layoutSaveFirst: string
  /** The files changed on disk while the editor held unsaved edits. */
  layoutConflict: string
  layoutConflictLoad: string
  layoutConflictKeep: string
  /** Why the editor's file shown can't be left yet: that change is
   * undecided. */
  layoutConflictFirst: string
  /** The window was closed, but the file's edits couldn't be saved. */
  layoutCloseUnsaved: string
  layoutCloseConflict: string
  sourceCloseUnsaved: (reason: string) => string
  layoutActionFailed: (error: string) => string
  deckChangeFailed: string
  layoutDeckUnsaved: string

  // Slide preview
  previewAsPhone: string
  previewPc: string
  previewPhone: string
  phoneCanvasShape: string
  /** Each device preset's name in the phone shape menu; the model and its
   * size follow it as the option's detail. */
  deviceNames: Record<DevicePresetId, string>
  phoneShapeDeck: string
  phoneShapeDeckDetail: string
  /** The preview's label when a device didn't fit the panel at real size
   * and was shrunk to `percent` of it (`scaledDownPercent`), and its
   * tooltip. */
  previewScaledDown: (percent: number) => string
  previewScaledDownDetail: string
  selectSlideToPreview: string
  openDeckToPreview: string
  /** Shown in the preview pane, above peitho-core's own error text, while
   * the deck on disk doesn't build — and the way out, below it. */
  deckDoesNotBuild: string
  fixSourceToPreview: string
  /** The same pair for one slide isolated from the render, shown while it
   * is the selected slide. */
  slideDoesNotBuild: string
  fixSlideToPreview: string

  // Review comments to the Coding Agent (the preview's pins, the comment
  // box and the comments panel under the preview)
  reviewComments: string
  // The comments column's "Connect your Coding Agent" card (domain/agentConnect.ts)
  connectAgentTitle: string
  connectAgentLead: string
  connectAgentStepOpen: string
  connectAgentStepPaste: string
  connectAgentStepWait: string
  connectAgentWaiting: string
  connectAgentTerminal: string
  copyPrompt: string
  copyCommand: string
  copiedToClipboard: string
  commentHint: string
  commentPlaceholder: string
  addComment: string
  discardComment: string
  editComment: string
  saveEdit: string
  unsentComment: string
  commentCount: (count: number) => string
  sendToAgent: string
  agentThinking: string
  reconnectAgent: string
  reconnectHint: string
  sendingToAgent: string
  startingReview: string
  showResolved: (count: number) => string
  hideResolved: string
  nothingToSend: string
  sendNeedsSession: string
  /** `command`: what to ask the agent to run in the deck's folder. */
  sendNeedsAgent: string
  sendNeedsOneSession: string
  reviewFailed: (error: string) => string
  reply: string
  resolveComment: string
  resolvedComment: string

  // Settings panel
  settings: string
  closeSettings: string
  language: string
  vimMode: string
  vimModeDescription: string
  vimModeSaveFailed: (error: string) => string

  // Status messages and prompts
  openedDeck: (deckPath: string) => string
  saved: string
  undone: string
  redone: string
  historyCleared: string
  mergedExternalChange: string
  reloadedExternalChange: string
  /** The deck on disk doesn't build and its errors went to the agent
   * waiting in crit, with nothing for the user to do
   * (`domain/buildErrorReport.ts`). */
  buildErrorReported: string
  /** The user asked for the build error to go to the agent, and none
   * waits in crit yet: it goes when one does. */
  buildErrorWaitingForAgent: string
  presenting: string
  presentingRehearsal: string
  externalChangeConfirm: string

  // Images dropped or pasted into the slide body
  importingImages: (count: number) => string
  importedImages: (count: number) => string
  /** `names`: the refused files' names, already joined. */
  unsupportedImageFiles: (names: string) => string
  imageImportFailed: (error: string) => string
  // The error bar's way out of "no slot accepts image" (domain/imageSlot.ts)
  imageSlotPickLayout: string
  imageSlotAddLayout: string
  imageSlotAddingLayout: string
  imageLayoutAdded: string
  layoutCreated: (layout: string) => string
  layoutDeleted: (layout: string) => string
  layoutDeletedHistoryCleared: (layout: string) => string
  layoutSaved: (layout: string) => string
  /** A file no single layout owns (`css/base.css`) saved. */
  fileSaved: (path: string) => string
  layoutApplied: (layout: string) => string
  layoutAlreadyApplied: (layout: string) => string
  imageLayoutAddFailed: (error: string) => string

  // About window
  aboutDescription: string
  aboutVersion: string
  aboutBuild: string
  aboutCommit: string
  aboutOpenCommit: string
  aboutWebsite: string
  aboutLicense: string
}

const en: Messages = {
  openDeck: 'Open Deck…',
  newDeck: 'New Deck…',
  opening: 'Opening…',
  recentDecks: 'Recent',
  openDeckDialogTitle: 'Open a Peitho deck folder',
  newDeckLocationDialogTitle: 'Choose a location for the new deck',

  newDeckTitle: 'New Deck',
  deckNamePlaceholder: 'Deck name',
  newDeckAspectRatio: 'Aspect Ratio',
  newDeckLanguage: 'Language',
  cancel: 'Cancel',
  create: 'Create',
  creating: 'Creating…',

  switchDeckVariant: 'Switch deck variant',
  present: 'Present',
  presentPending: 'Presenting…',
  presentOptions: 'Present options',
  presentRehearsal: 'Present (Rehearsal)',
  presentRehearsalDetail: 'Time each section as you go and save it for comparison against the plan.',

  scriptsDisabled: 'Scripts in this deck are turned off. Don\'t run them unless you trust whoever made this deck.',
  trustAndRun: 'Trust and Run',
  trustingDeck: 'Trusting…',

  copyError: 'Copy',
  errorCopied: 'Copied',
  sendErrorToAi: 'Send to AI',
  aiFixingError: 'AI is fixing…',

  speakerNotes: 'Speaker Notes',
  speakerNotesPlaceholder: 'Notes for the presenter — not shown to the audience.',
  selectSlideToEdit: 'Select a slide to edit it.',
  loadingDeck: 'Loading deck…',
  deckSourceHint: 'The error may be in text no slide shows — the frontmatter, or a slide\'s page settings comment. Edit the whole deck.md here; it saves once the deck builds.',
  editDeckSource: 'Edit deck source',
  backToSlide: 'Back to slide',

  openDeckToSeeSlides: 'Open a deck to see its slides.',
  expandSection: 'Expand section',
  collapseSection: 'Collapse section',
  sectionName: 'Section name',
  sectionMinutes: 'Section minutes',
  sectionSeconds: 'Section seconds',
  minutesUnit: 'm',
  secondsUnit: 's',
  editSection: 'Edit section name and time',
  slideFallbackTitle: position => `Slide ${String(position)}`,
  draftBadge: 'Draft',
  skipBadge: 'Skip',
  errorBadge: 'Error',
  slidesDoNotBuild: (count, headline) => `${String(count)} ${count === 1 ? 'slide doesn\'t' : 'slides don\'t'} build: ${headline}`,

  newSlide: 'New Slide',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  delete: 'Delete',
  changeLayout: 'Change Layout',
  loading: 'Loading…',
  noLayouts: 'No layouts found',
  markAsDraft: 'Mark as Draft',
  skipInPresent: 'Skip in Present',
  hidePageNumber: 'Hide Page Number',
  sectionStart: 'Section Start',
  moveSlideUp: 'Move Slide Up',
  moveSlideDown: 'Move Slide Down',
  layoutChecking: 'Still checking which layouts fit this slide — try again in a moment.',
  layoutMismatch: (layout, reason) => `"${layout}" doesn't fit this slide: ${reason}`,

  studioModeSlides: 'Slides',
  studioModeLayouts: 'Layouts',
  newLayout: 'New Layout',
  newLayoutName: 'Layout name (a-z, 0-9, -, _)',
  newLayoutFrom: 'Start from',
  blankLayout: 'Blank (title only)',
  layoutNameEmpty: 'Enter a name for the layout',
  layoutNameTooLong: 'The name is too long',
  layoutNameInvalid: 'Use only letters a-z, digits, "-" and "_"',
  layoutNameStart: 'Start the name with a letter or a digit',
  layoutNameTaken: 'The deck already has a layout with this name',
  applyLayoutToSlide: 'Apply to Slide',
  applyLayoutNeedsSlide: 'Select a slide in Slides first',
  editLayout: 'Edit Layout',
  duplicateLayout: 'Duplicate Layout',
  deleteLayout: 'Delete Layout',
  comment: 'Comment…',
  layoutUsage: count => (count === 0 ? 'Unused' : count === 1 ? '1 slide' : `${String(count)} slides`),
  onlyLayoutCannotBeDeleted: "The deck's only layout can't be deleted",
  deleteLayoutConfirm: layout => `Delete "${layout}"? Its files are removed from layouts/ and css/.`,
  deleteLayoutMoveSlides: (layout, count) => `${count === 1 ? '1 slide uses' : `${String(count)} slides use`} "${layout}". Move ${count === 1 ? 'it' : 'them'} to another layout before it is deleted.`,
  deleteLayoutMoveTo: 'Move to',
  deleting: 'Deleting…',
  savingLayout: 'Saving…',
  layoutUnsaved: 'Unsaved changes',
  closeTab: name => `Close ${name}`,
  noFileOpen: 'Open a file from the tree, or pick a layout in the list',
  fileGone: 'This file is no longer on disk, so these edits can\'t be saved. Copy them elsewhere, or close the tab to discard them',
  layoutSaveFirst: 'The changes to this file could not be saved. Fix them, or undo them, first',
  layoutConflict: 'This file changed on disk while you had unsaved edits here.',
  layoutConflictLoad: 'Load from disk',
  layoutConflictKeep: 'Keep my edits',
  layoutConflictFirst: 'This file changed on disk: load it or keep your edits first',
  layoutCloseUnsaved: 'The changes to this file could not be saved. Fix them, or close the window again to discard them',
  layoutCloseConflict: 'This file changed on disk: load it or keep your edits, or close the window again to discard your edits',
  sourceCloseUnsaved: reason => `The deck source could not be saved. Fix it, or close the window again to discard the changes\n${reason}`,
  layoutActionFailed: error => `Could not change the layouts: ${error}`,
  deckChangeFailed: 'deck.md could not be updated',
  layoutDeckUnsaved: 'the slides have changes that could not be saved to deck.md. Layouts are checked against the saved deck, so save the slides first',

  previewAsPhone: 'Preview as phone',
  previewPc: 'PC',
  previewPhone: 'Phone',
  phoneCanvasShape: 'Device to preview as',
  deviceNames: {
    'small-phone': 'Small phone',
    phone: 'Phone',
    'large-phone': 'Large phone',
    tablet: 'Tablet',
  },
  phoneShapeDeck: 'Same ratio as PC',
  phoneShapeDeckDetail: 'Keeps the deck\'s own ratio (16:9 / 4:3)',
  previewScaledDown: percent => `Scaled to ${String(percent)}%`,
  previewScaledDownDetail: 'The device doesn\'t fit this panel at real size, so it is shown smaller',
  selectSlideToPreview: 'Select a slide to preview it.',
  openDeckToPreview: 'Open a deck to preview it.',
  deckDoesNotBuild: 'This deck doesn\'t build yet, so there is nothing to preview.',
  fixSourceToPreview: 'Fix the source in the editor and save; the preview comes back once the deck builds.',
  slideDoesNotBuild: 'This slide doesn\'t build, so it was left out of the deck\'s preview.',
  fixSlideToPreview: 'Fix it in the editor and save; its preview comes back once it builds.',

  reviewComments: 'Comments for the agent',
  connectAgentTitle: 'First, connect me',
  connectAgentLead: 'To get your comments, I need to be waiting for this deck\'s review.',
  connectAgentStepOpen: 'Open me in Claude Code, Codex, or another coding agent.',
  connectAgentStepPaste: 'Copy this prompt and send it to me.',
  connectAgentStepWait: 'Once I\'m connected, this switches over on its own.',
  connectAgentWaiting: 'Waiting for me to connect…',
  connectAgentTerminal: 'Run it in a terminal yourself',
  copyPrompt: 'Copy Prompt',
  copyCommand: 'Copy Command',
  copiedToClipboard: 'Copied',
  commentHint: 'Right-click a slide or element and choose Comment to leave feedback.',
  commentPlaceholder: 'What should the agent change here?',
  addComment: 'Add Comment',
  discardComment: 'Discard',
  editComment: 'Edit',
  saveEdit: 'Save',
  unsentComment: 'Not sent yet',
  commentCount: count => (count === 1 ? '1 comment' : `${String(count)} comments`),
  sendToAgent: 'Send',
  agentThinking: 'Thinking…',
  reconnectAgent: 'Reconnect',
  reconnectHint: 'No reply?',
  sendingToAgent: 'Sending…',
  startingReview: 'Getting the review ready…',
  showResolved: count => `Show resolved (${String(count)})`,
  hideResolved: 'Hide resolved',
  nothingToSend: 'Nothing new to send.',
  sendNeedsSession: 'Add a comment and I\'ll start the review.',
  sendNeedsAgent: 'Connect me to send your comments.',
  sendNeedsOneSession: 'Several crit review sessions are open on this deck. Stop all but one (`crit stop`).',
  reviewFailed: error => `Could not reach the review session: ${error}`,
  reply: 'Reply',
  resolveComment: 'Resolve',
  resolvedComment: 'Resolved',

  settings: 'Settings',
  closeSettings: 'Close settings',
  language: 'Language',
  vimMode: 'Vim mode',
  vimModeDescription: 'Vim key bindings in the slide body and speaker notes. Yanks share the system clipboard.',
  vimModeSaveFailed: error => `Could not save the vim mode setting: ${error}`,

  openedDeck: deckPath => `Opened ${deckPath}`,
  saved: 'Saved',
  undone: 'Undone',
  redone: 'Redone',
  historyCleared: 'Undo history cleared — the deck changed since.',
  mergedExternalChange: 'Deck changed on disk elsewhere — merged around your unsaved edit.',
  reloadedExternalChange: 'Reloaded — the deck changed on disk.',
  buildErrorReported: 'Sent the build error to the agent.',
  buildErrorWaitingForAgent: 'Waiting for an agent to send the build error to.',
  presenting: 'Presenting…',
  presentingRehearsal: 'Presenting (rehearsal)…',
  externalChangeConfirm: 'This deck changed outside Peitho Studio (e.g. another editor). Reload it and discard your unsaved edits here?',

  importingImages: count => (count === 1 ? 'Importing image…' : `Importing ${String(count)} images…`),
  importedImages: count => (count === 1 ? 'Image added to img/' : `${String(count)} images added to img/`),
  unsupportedImageFiles: names => `Not added — only PNG, JPEG, GIF and WebP images can be used: ${names}`,
  imageImportFailed: error => `Could not add the image: ${error}`,
  imageSlotPickLayout: 'Choose a Layout That Fits…',
  imageSlotAddLayout: 'Add an Image Layout',
  imageSlotAddingLayout: 'Adding the Image Layout…',
  imageLayoutAdded: 'Added the title-body-image layout to layouts/',
  layoutCreated: layout => `Added the ${layout} layout`,
  layoutDeleted: layout => `Deleted the ${layout} layout`,
  layoutDeletedHistoryCleared: layout => `Deleted the ${layout} layout — undo history cleared, since it pointed slides at it`,
  layoutSaved: layout => `Saved the ${layout} layout`,
  fileSaved: path => `Saved ${path}`,
  layoutApplied: layout => `Applied the ${layout} layout to the slide`,
  layoutAlreadyApplied: layout => `The slide already uses the ${layout} layout`,
  imageLayoutAddFailed: error => `Could not add the image layout: ${error}`,

  // Same words as the site's (site/index.html).
  aboutDescription: 'Write slides with Peitho. Plain Markdown and HTML, so AI can help you.',
  aboutVersion: 'Version',
  aboutBuild: 'Build',
  aboutCommit: 'Commit',
  aboutOpenCommit: 'Open this commit on GitHub',
  aboutWebsite: 'Website',
  aboutLicense: 'License',
}

const ja: Messages = {
  openDeck: 'デッキを開く…',
  newDeck: '新規デッキ…',
  opening: '開いています…',
  recentDecks: '最近使ったデッキ',
  openDeckDialogTitle: 'Peithoデッキのフォルダを開く',
  newDeckLocationDialogTitle: '新しいデッキの保存場所を選択',

  newDeckTitle: '新規デッキ',
  deckNamePlaceholder: 'デッキ名',
  newDeckAspectRatio: '縦横比',
  newDeckLanguage: '言語',
  cancel: 'キャンセル',
  create: '作成',
  creating: '作成しています…',

  switchDeckVariant: 'デッキのバリアントを切り替える',
  present: '発表',
  presentPending: '発表を準備しています…',
  presentOptions: '発表のオプション',
  presentRehearsal: '発表(リハーサル)',
  presentRehearsalDetail: 'セクションごとの所要時間を計って保存し、予定と比べられるようにします。',

  scriptsDisabled: 'このデッキのスクリプトは無効になっています。信頼できる作成者のデッキでなければ実行しないでください。',
  trustAndRun: '信頼して実行',
  trustingDeck: '信頼しています…',

  copyError: 'コピー',
  errorCopied: 'コピーしました',
  sendErrorToAi: 'AIに送る',
  aiFixingError: 'AIが調整中…',

  speakerNotes: 'スピーカーノート',
  speakerNotesPlaceholder: '発表者用のメモ — 聴衆には表示されません。',
  selectSlideToEdit: '編集するスライドを選んでください。',
  loadingDeck: 'デッキを読み込んでいます…',
  deckSourceHint: 'エラーは、スライドの本文には出てこない箇所(frontmatterやページ設定コメント)にあるかもしれません。ここでは deck.md 全体を編集でき、ビルドが通った時点で保存されます。',
  editDeckSource: 'デッキのソースを編集',
  backToSlide: 'スライド編集に戻る',

  openDeckToSeeSlides: 'デッキを開くとスライドが表示されます。',
  expandSection: 'セクションを展開',
  collapseSection: 'セクションを折りたたむ',
  sectionName: 'セクション名',
  sectionMinutes: 'セクションの分',
  sectionSeconds: 'セクションの秒',
  minutesUnit: '分',
  secondsUnit: '秒',
  editSection: 'セクション名と時間を編集',
  slideFallbackTitle: position => `スライド ${String(position)}`,
  draftBadge: '下書き',
  skipBadge: 'スキップ',
  errorBadge: 'エラー',
  slidesDoNotBuild: (count, headline) => `${String(count)}枚のスライドがビルドできません: ${headline}`,

  newSlide: '新規スライド',
  cut: 'カット',
  copy: 'コピー',
  paste: 'ペースト',
  delete: '削除',
  changeLayout: 'レイアウトを変更',
  loading: '読み込んでいます…',
  noLayouts: 'レイアウトが見つかりません',
  markAsDraft: '下書きにする',
  skipInPresent: '発表でスキップ',
  hidePageNumber: 'ページ番号を隠す',
  sectionStart: 'セクションの開始',
  moveSlideUp: 'スライドを上へ移動',
  moveSlideDown: 'スライドを下へ移動',
  layoutChecking: 'このスライドに合うレイアウトを確認しています。少し待ってからもう一度選んでください。',
  layoutMismatch: (layout, reason) => `「${layout}」はこのスライドに合いません: ${reason}`,

  studioModeSlides: 'スライド',
  studioModeLayouts: 'レイアウト',
  newLayout: '新規レイアウト',
  newLayoutName: 'レイアウト名(英数字・-・_)',
  newLayoutFrom: '元にするレイアウト',
  blankLayout: '空白(タイトルのみ)',
  layoutNameEmpty: 'レイアウト名を入力してください',
  layoutNameTooLong: '名前が長すぎます',
  layoutNameInvalid: '英字(a-z)・数字・「-」「_」だけを使ってください',
  layoutNameStart: '名前は英字か数字で始めてください',
  layoutNameTaken: '同じ名前のレイアウトがすでにあります',
  applyLayoutToSlide: 'スライドに適用',
  applyLayoutNeedsSlide: '先にスライド画面でスライドを選択してください',
  editLayout: 'レイアウトを編集',
  duplicateLayout: 'レイアウトを複製',
  deleteLayout: 'レイアウトを削除',
  comment: 'コメント…',
  layoutUsage: count => (count === 0 ? '未使用' : `${String(count)}枚で使用中`),
  onlyLayoutCannotBeDeleted: 'デッキに1つしかないレイアウトは削除できません',
  deleteLayoutConfirm: layout => `「${layout}」を削除しますか? layouts/ と css/ からファイルが削除されます。`,
  deleteLayoutMoveSlides: (layout, count) => `「${layout}」は${String(count)}枚のスライドで使われています。削除する前に、別のレイアウトへ移してください。`,
  deleteLayoutMoveTo: '移動先',
  deleting: '削除中…',
  savingLayout: '保存中…',
  layoutUnsaved: '未保存の変更があります',
  closeTab: name => `${name} を閉じる`,
  noFileOpen: 'ツリーからファイルを開くか、一覧でレイアウトを選んでください',
  fileGone: 'このファイルはディスク上にもうないため、編集を保存できません。別の場所に写すか、タブを閉じて破棄してください',
  layoutSaveFirst: 'このファイルの変更を保存できませんでした。先に修正するか取り消してください',
  layoutConflict: '未保存の編集がある間に、このファイルがディスク上で変更されました。',
  layoutConflictLoad: 'ディスクの内容を読み込む',
  layoutConflictKeep: '自分の編集を残す',
  layoutConflictFirst: 'このファイルがディスク上で変更されました。先に、読み込むか自分の編集を残すかを選んでください',
  layoutCloseUnsaved: 'このファイルの変更を保存できませんでした。修正するか、もう一度ウィンドウを閉じて変更を破棄してください',
  layoutCloseConflict: 'このファイルがディスク上で変更されました。読み込むか自分の編集を残すかを選ぶか、もう一度ウィンドウを閉じて自分の編集を破棄してください',
  sourceCloseUnsaved: reason => `デッキのソースを保存できませんでした。修正するか、もう一度ウィンドウを閉じて変更を破棄してください\n${reason}`,
  layoutActionFailed: error => `レイアウトを変更できませんでした: ${error}`,
  deckChangeFailed: 'deck.md を更新できませんでした',
  layoutDeckUnsaved: 'deck.md に保存できていないスライドの変更があります。レイアウトは保存済みのデッキに対して確認するため、先にスライドを保存してください',

  previewAsPhone: 'スマートフォン表示でプレビュー',
  previewPc: 'PC',
  previewPhone: 'スマートフォン',
  phoneCanvasShape: 'プレビューする端末',
  deviceNames: {
    'small-phone': '小さめのスマホ',
    phone: '標準のスマホ',
    'large-phone': '大きめのスマホ',
    tablet: 'タブレット',
  },
  phoneShapeDeck: 'PCと同じ比率',
  phoneShapeDeckDetail: 'デッキ本来の比率(16:9 / 4:3)のまま',
  previewScaledDown: percent => `縮小表示 ${String(percent)}%`,
  previewScaledDownDetail: '実寸ではこのパネルに収まらないため、縮小して表示しています',
  selectSlideToPreview: 'プレビューするスライドを選んでください。',
  openDeckToPreview: 'デッキを開くとプレビューが表示されます。',
  deckDoesNotBuild: 'このデッキはまだビルドできないため、プレビューがありません。',
  fixSourceToPreview: 'エディタでソースを直して保存すると、ビルドが通った時点でプレビューが戻ります。',
  slideDoesNotBuild: 'このスライドはビルドできないため、デッキのプレビューから外しています。',
  fixSlideToPreview: 'エディタで直して保存すると、ビルドが通った時点でこのスライドのプレビューが戻ります。',

  reviewComments: 'エージェントへのコメント',
  connectAgentTitle: 'まず、私を接続してください',
  connectAgentLead: 'コメントを受け取るには、私がこのデッキのレビューを待っている必要があります。',
  connectAgentStepOpen: 'Claude Code や Codex などで、私を開いてください。',
  connectAgentStepPaste: 'このプロンプトをコピーして、私に送ってください。',
  connectAgentStepWait: 'つながったら、ここは自動で切り替わります。',
  connectAgentWaiting: '接続を待っています…',
  connectAgentTerminal: 'ターミナルで自分で実行する',
  copyPrompt: 'プロンプトをコピー',
  copyCommand: 'コマンドをコピー',
  copiedToClipboard: 'コピーしました',
  commentHint: 'スライドや要素を右クリックし、「コメント」を選んで教えてください。',
  commentPlaceholder: 'ここをどう直してほしいですか?',
  addComment: 'コメントを追加',
  discardComment: '取り消す',
  editComment: '編集',
  saveEdit: '保存',
  unsentComment: '未送信',
  commentCount: count => `コメント ${String(count)} 件`,
  sendToAgent: '送信',
  agentThinking: '考え中…',
  reconnectAgent: '接続し直す',
  reconnectHint: '応答がない場合は',
  sendingToAgent: '送信中…',
  startingReview: 'レビューの準備をしています…',
  showResolved: count => `解決済みも表示（${String(count)}）`,
  hideResolved: '解決済みを隠す',
  nothingToSend: '新しく送るものはありません。',
  sendNeedsSession: 'コメントを追加すると、レビューを始めます。',
  sendNeedsAgent: 'コメントを送るには、私を接続してください。',
  sendNeedsOneSession: 'このデッキにcritのレビューのセッションが複数あります。1つを残して止めてください(`crit stop`)。',
  reviewFailed: error => `レビューのセッションに接続できませんでした: ${error}`,
  reply: '返信',
  resolveComment: '解決済みにする',
  resolvedComment: '解決済み',

  settings: '設定',
  closeSettings: '設定を閉じる',
  language: '言語',
  vimMode: 'Vim モード',
  vimModeDescription: 'スライド本文と発表者ノートで Vim のキー操作を使えるようにします。ヤンクはシステムのクリップボードと共有します。',
  vimModeSaveFailed: error => `Vim モードの設定を保存できませんでした: ${error}`,

  openedDeck: deckPath => `${deckPath} を開きました`,
  saved: '保存しました',
  undone: '元に戻しました',
  redone: 'やり直しました',
  historyCleared: 'デッキが変更されたため、取り消し履歴を消去しました。',
  mergedExternalChange: 'デッキがほかの場所で変更されました — 未保存の編集はそのまま残し、それ以外を反映しました。',
  reloadedExternalChange: 'デッキがほかの場所で変更されたため、読み込み直しました。',
  buildErrorReported: 'ビルドエラーをエージェントに送りました。',
  buildErrorWaitingForAgent: 'エージェントの接続を待っています。接続したらビルドエラーを送ります。',
  presenting: '発表中…',
  presentingRehearsal: '発表中(リハーサル)…',
  externalChangeConfirm: 'このデッキはPeitho Studioの外(ほかのエディタなど)で変更されました。読み込み直して、ここでの未保存の編集を破棄しますか?',

  importingImages: count => (count === 1 ? '画像を取り込み中…' : `${String(count)} 枚の画像を取り込み中…`),
  importedImages: count => (count === 1 ? '画像を img/ に取り込みました' : `${String(count)} 枚の画像を img/ に取り込みました`),
  unsupportedImageFiles: names => `追加しませんでした — 使える画像は PNG・JPEG・GIF・WebP だけです: ${names}`,
  imageImportFailed: error => `画像を追加できませんでした: ${error}`,
  imageSlotPickLayout: '合うレイアウトを選ぶ…',
  imageSlotAddLayout: '画像用レイアウトを追加',
  imageSlotAddingLayout: '画像用レイアウトを追加しています…',
  imageLayoutAdded: '画像用レイアウト title-body-image を layouts/ に追加しました',
  layoutCreated: layout => `レイアウト ${layout} を追加しました`,
  layoutDeleted: layout => `レイアウト ${layout} を削除しました`,
  layoutDeletedHistoryCleared: layout => `レイアウト ${layout} を削除しました。このレイアウトを指していた取り消し履歴は消去しました`,
  layoutSaved: layout => `レイアウト ${layout} を保存しました`,
  fileSaved: path => `${path} を保存しました`,
  layoutApplied: layout => `スライドにレイアウト ${layout} を適用しました`,
  layoutAlreadyApplied: layout => `スライドはすでにレイアウト ${layout} を使っています`,
  imageLayoutAddFailed: error => `画像用レイアウトを追加できませんでした: ${error}`,

  aboutDescription: 'Peithoでスライドを書く。素のMarkdownとHTMLなので、AIに手伝ってもらえます。',
  aboutVersion: 'バージョン',
  aboutBuild: 'ビルド',
  aboutCommit: 'コミット',
  aboutOpenCommit: 'このコミットをGitHubで開く',
  aboutWebsite: 'Webサイト',
  aboutLicense: 'ライセンス',
}

const MESSAGES: Readonly<Record<Language, Messages>> = { en, ja }

/** Every message in `language`. English for anything that isn't one of
 * the `Language`s (only reachable past the type checker, e.g. a value read
 * off IPC unchecked), so the UI never renders blank labels. */
export function messagesFor(language: Language): Messages {
  return Object.hasOwn(MESSAGES, language) ? MESSAGES[language] : en
}

/** How a language is named in the language picker: in that language
 * itself, so someone who can't read the current UI language can still
 * find their own. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: 'English', ja: '日本語' }
