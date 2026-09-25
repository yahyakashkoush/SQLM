import { Keyboard, InlineKeyboard } from 'grammy';

/** Persistent bottom menu — spec §5's "Main Bot Menu". Every button either
 * replies with a quick text summary or opens the Mini App, which is where
 * the actual shopping experience lives (spec §5, §2). */
export const MAIN_MENU_LABELS = {
  HOME: '🏠 Home',
  PRODUCTS: '🛍️ Products',
  OFFERS: '🔥 Offers',
  SEARCH: '🔎 Search',
  ORDERS: '📦 My Orders',
  PAYMENT: '💳 Payment',
  SUPPORT: '🎫 Support',
  ACCOUNT: '👤 My Account',
} as const;

export function buildMainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(MAIN_MENU_LABELS.HOME)
    .text(MAIN_MENU_LABELS.PRODUCTS)
    .row()
    .text(MAIN_MENU_LABELS.OFFERS)
    .text(MAIN_MENU_LABELS.SEARCH)
    .row()
    .text(MAIN_MENU_LABELS.ORDERS)
    .text(MAIN_MENU_LABELS.PAYMENT)
    .row()
    .text(MAIN_MENU_LABELS.SUPPORT)
    .text(MAIN_MENU_LABELS.ACCOUNT)
    .resized();
}

export function buildWebAppButton(text: string, url: string): InlineKeyboard {
  return new InlineKeyboard().webApp(text, url);
}
