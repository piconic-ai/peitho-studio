import { describe, expect, test } from 'bun:test'
import { COMMENT_ACTION, commentItemLabel, menuItemIcon, setApartFromComment } from './menuComment'
import { messagesFor } from './messages'
import { menuItems, openOnSlide, type ContextMenu, type MenuContext } from './contextMenu'
import { layoutMenuItems, layoutMenuLabel, openOnLayout, openOnList, openOnPreview, type LayoutMenu } from './layoutMenu'
import { commentMenuItems, commentMenuLabel, openOnEditor, type CommentMenu } from './commentMenu'

const SLIDE_CONTEXT: MenuContext = { slideCount: 3, hasClipboard: false, configOf: () => ({}), pageNumbersShown: false }
const LAYOUT_CONTEXT = { hasSlide: true, layoutCount: 2, busy: false }

describe('the comment item every right-click menu opens with', () => {
  test('spec: Given either language, Then its label is the same plain Comment…, and it alone has the speech bubble', () => {
    expect(commentItemLabel(messagesFor('en'))).toBe('Comment…')
    expect(commentItemLabel(messagesFor('ja'))).toBe('コメント…')
    expect(menuItemIcon(COMMENT_ACTION)).toBe('comment')
    for (const action of ['cut', 'copy', 'paste', 'apply', 'delete', 'new-layout', '']) expect(menuItemIcon(action)).toBeNull()
  })

  test('spec: Given every menu — slide row, slide preview, the editors, a layout row, the large preview, layout list space — Then the comment comes first, labelled the same, set apart from the rest', () => {
    const slideMenus: ContextMenu[] = [openOnSlide(1, 0, 0, 1), openOnSlide(1, 0, 0, 1, { hit: null, pin: null, at: { x: 0, y: 0 } })]
    const layoutMenus: LayoutMenu[] = [openOnLayout('quote', 0, 0, null), openOnPreview('quote', 'body', 0, 0, null), openOnList(0, 0)]
    const editorMenus: CommentMenu[] = [openOnEditor('body', 0, 0, 1, 4), openOnEditor('note', 0, 0, 2, 2), openOnEditor('layout', 0, 0, 0, 0)]
    for (const language of ['en', 'ja'] as const) {
      const messages = messagesFor(language)
      const lists: { actions: string[]; label: string }[] = [
        ...slideMenus.map(menu => ({ actions: menuItems(menu, SLIDE_CONTEXT).map(item => item.action), label: commentItemLabel(messages) })),
        ...layoutMenus.map(menu => ({ actions: layoutMenuItems(menu, LAYOUT_CONTEXT).map(item => item.action), label: layoutMenuLabel(COMMENT_ACTION, messages) })),
        ...editorMenus.map(menu => ({ actions: commentMenuItems(menu).map(item => item.action), label: commentMenuLabel(COMMENT_ACTION, menu, messages) })),
      ]
      for (const { actions, label } of lists) {
        expect(actions[0]).toBe(COMMENT_ACTION)
        expect(actions.filter(action => action === COMMENT_ACTION)).toHaveLength(1)
        expect(label).toBe(commentItemLabel(messages))
        expect(actions.length > 1 ? setApartFromComment(actions, 1) : true).toBe(true)
      }
    }
  })

  test('adversarial: Given items not right after the comment, the first item, or an index out of range, Then nothing is set apart', () => {
    const actions = ['comment', 'cut', 'copy']
    expect(setApartFromComment(actions, 0)).toBe(false)
    expect(setApartFromComment(actions, 2)).toBe(false)
    expect(setApartFromComment(actions, 9)).toBe(false)
    expect(setApartFromComment(actions, -1)).toBe(false)
    expect(setApartFromComment([], 0)).toBe(false)
  })
})
