// Every message the Studio UI shows, in each `Language`. Both tables are
// typed as `Messages`, so a message missing from either (or one table
// holding a key the other lacks) is a type error, not a blank label found
// on a real device.
//
// Out of scope, shown as they arrive: a deck's own content, and the error
// messages peitho-core and the Rust side return. The native menu bar's
// labels live Rust-side (`src-tauri/src/i18n.rs`).
import type { Language } from './language'

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

  // Status bar
  copyError: string
  errorCopied: string

  // Slide editor
  speakerNotes: string
  speakerNotesPlaceholder: string
  selectSlideToEdit: string
  loadingDeck: string

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
  moveSlideUp: string
  moveSlideDown: string
  layoutChecking: string
  layoutMismatch: (layout: string, reason: string) => string

  // Slide preview
  previewAsPhone: string
  previewPc: string
  previewPhone: string
  phoneCanvasShape: string
  phoneShapeTall: string
  phoneShapeTallDetail: string
  phoneShapeDeck: string
  phoneShapeDeckDetail: string
  selectSlideToPreview: string
  openDeckToPreview: string

  // Settings panel
  settings: string
  closeSettings: string
  language: string

  // Status messages and prompts
  openedDeck: (deckPath: string) => string
  saved: string
  undone: string
  redone: string
  historyCleared: string
  mergedExternalChange: string
  reloadedExternalChange: string
  presenting: string
  presentingRehearsal: string
  externalChangeConfirm: string
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
  cancel: 'Cancel',
  create: 'Create',
  creating: 'Creating…',

  switchDeckVariant: 'Switch deck variant',
  present: 'Present',
  presentPending: 'Presenting…',
  presentOptions: 'Present options',
  presentRehearsal: 'Present (Rehearsal)',
  presentRehearsalDetail: 'Time each section as you go and save it for comparison against the plan.',

  copyError: 'Copy',
  errorCopied: 'Copied',

  speakerNotes: 'Speaker Notes',
  speakerNotesPlaceholder: 'Notes for the presenter — not shown to the audience.',
  selectSlideToEdit: 'Select a slide to edit it.',
  loadingDeck: 'Loading deck…',

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
  sectionStart: 'Section Start',
  moveSlideUp: 'Move Slide Up',
  moveSlideDown: 'Move Slide Down',
  layoutChecking: 'Still checking which layouts fit this slide — try again in a moment.',
  layoutMismatch: (layout, reason) => `"${layout}" doesn't fit this slide: ${reason}`,

  previewAsPhone: 'Preview as phone',
  previewPc: 'PC',
  previewPhone: 'Phone',
  phoneCanvasShape: 'Phone canvas shape',
  phoneShapeTall: 'Tall',
  phoneShapeTallDetail: 'A tall canvas shaped like a portrait phone',
  phoneShapeDeck: 'Same ratio as PC',
  phoneShapeDeckDetail: 'Keeps the deck\'s own ratio (16:9 / 4:3)',
  selectSlideToPreview: 'Select a slide to preview it.',
  openDeckToPreview: 'Open a deck to preview it.',

  settings: 'Settings',
  closeSettings: 'Close settings',
  language: 'Language',

  openedDeck: deckPath => `Opened ${deckPath}`,
  saved: 'Saved',
  undone: 'Undone',
  redone: 'Redone',
  historyCleared: 'Undo history cleared — the deck changed since.',
  mergedExternalChange: 'Deck changed on disk elsewhere — merged around your unsaved edit.',
  reloadedExternalChange: 'Reloaded — the deck changed on disk.',
  presenting: 'Presenting…',
  presentingRehearsal: 'Presenting (rehearsal)…',
  externalChangeConfirm: 'This deck changed outside Peitho Studio (e.g. another editor). Reload it and discard your unsaved edits here?',
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
  cancel: 'キャンセル',
  create: '作成',
  creating: '作成しています…',

  switchDeckVariant: 'デッキのバリアントを切り替える',
  present: '発表',
  presentPending: '発表を準備しています…',
  presentOptions: '発表のオプション',
  presentRehearsal: '発表(リハーサル)',
  presentRehearsalDetail: 'セクションごとの所要時間を計って保存し、予定と比べられるようにします。',

  copyError: 'コピー',
  errorCopied: 'コピーしました',

  speakerNotes: 'スピーカーノート',
  speakerNotesPlaceholder: '発表者用のメモ — 聴衆には表示されません。',
  selectSlideToEdit: '編集するスライドを選んでください。',
  loadingDeck: 'デッキを読み込んでいます…',

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
  sectionStart: 'セクションの開始',
  moveSlideUp: 'スライドを上へ移動',
  moveSlideDown: 'スライドを下へ移動',
  layoutChecking: 'このスライドに合うレイアウトを確認しています。少し待ってからもう一度選んでください。',
  layoutMismatch: (layout, reason) => `「${layout}」はこのスライドに合いません: ${reason}`,

  previewAsPhone: 'スマートフォン表示でプレビュー',
  previewPc: 'PC',
  previewPhone: 'スマートフォン',
  phoneCanvasShape: 'スマートフォン表示のキャンバスの形',
  phoneShapeTall: '縦長',
  phoneShapeTallDetail: '縦向きのスマートフォンに合わせた縦長のキャンバス',
  phoneShapeDeck: 'PCと同じ比率',
  phoneShapeDeckDetail: 'デッキ本来の比率(16:9 / 4:3)のまま',
  selectSlideToPreview: 'プレビューするスライドを選んでください。',
  openDeckToPreview: 'デッキを開くとプレビューが表示されます。',

  settings: '設定',
  closeSettings: '設定を閉じる',
  language: '言語',

  openedDeck: deckPath => `${deckPath} を開きました`,
  saved: '保存しました',
  undone: '元に戻しました',
  redone: 'やり直しました',
  historyCleared: 'デッキが変更されたため、取り消し履歴を消去しました。',
  mergedExternalChange: 'デッキがほかの場所で変更されました — 未保存の編集はそのまま残し、それ以外を反映しました。',
  reloadedExternalChange: 'デッキがほかの場所で変更されたため、読み込み直しました。',
  presenting: '発表中…',
  presentingRehearsal: '発表中(リハーサル)…',
  externalChangeConfirm: 'このデッキはPeitho Studioの外(ほかのエディタなど)で変更されました。読み込み直して、ここでの未保存の編集を破棄しますか?',
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
