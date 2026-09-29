import { InlineKeyboard, Keyboard } from 'grammy';
import type { KeyboardButton } from 'grammy/types';
import { MAIN_MENU_LABELS, buildMainMenuKeyboard, buildWebAppButton } from './main-menu.keyboard';

function buttonText(button: KeyboardButton): string {
  return typeof button === 'string' ? button : button.text;
}

describe('main-menu.keyboard', () => {
  it('builds a resized reply keyboard containing every menu label exactly once', () => {
    const keyboard = buildMainMenuKeyboard();
    expect(keyboard).toBeInstanceOf(Keyboard);

    const texts = keyboard.keyboard.flat().map(buttonText);
    const expectedLabels = Object.values(MAIN_MENU_LABELS);

    expect(texts).toHaveLength(expectedLabels.length);
    for (const label of expectedLabels) {
      expect(texts).toContain(label);
    }
    // No duplicates.
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('arranges the menu in 2-column rows', () => {
    const keyboard = buildMainMenuKeyboard();
    for (const row of keyboard.keyboard) {
      expect(row.length).toBeLessThanOrEqual(2);
    }
  });

  it('builds a single web_app inline button pointing at the given URL', () => {
    const url = 'https://miniapp.example.com/shop';
    const keyboard = buildWebAppButton('Open Shop', url);
    expect(keyboard).toBeInstanceOf(InlineKeyboard);

    const buttons = keyboard.inline_keyboard.flat();
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    if (!button) throw new Error('expected a button');
    expect(button.text).toBe('Open Shop');
    expect('web_app' in button && button.web_app?.url).toBe(url);
  });
});
