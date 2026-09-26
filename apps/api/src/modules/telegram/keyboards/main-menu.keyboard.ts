import { Keyboard, InlineKeyboard } from 'grammy';

/** Persistent bottom menu. Every button either replies with a short summary or opens the Mini App. */
export const MAIN_MENU_LABELS = {
  HOME: '🏠 المتجر',
  PRODUCTS: '🛍️ المنتجات',
  OFFERS: '🔥 العروض',
  SEARCH: '🔎 بحث',
  ORDERS: '📦 طلباتي',
  PAYMENT: '💳 الدفع',
  SUPPORT: '🎫 الدعم',
  ACCOUNT: '👤 حسابي',
} as const;

export type MainMenuAction = keyof typeof MAIN_MENU_LABELS;

/** Customers who opened the bot before the Arabic menu still have these buttons on screen. */
const LEGACY_LABELS: Record<string, MainMenuAction> = {
  '🏠 Home': 'HOME',
  '🛍️ Products': 'PRODUCTS',
  '🔥 Offers': 'OFFERS',
  '🔎 Search': 'SEARCH',
  '📦 My Orders': 'ORDERS',
  '💳 Payment': 'PAYMENT',
  '🎫 Support': 'SUPPORT',
  '👤 My Account': 'ACCOUNT',
};

export const MENU_ACTION_BY_LABEL: Record<string, MainMenuAction> = {
  ...LEGACY_LABELS,
  ...Object.fromEntries(
    Object.entries(MAIN_MENU_LABELS).map(([action, label]) => [label, action as MainMenuAction]),
  ),
};

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
    .resized()
    .persistent();
}

export function buildWebAppButton(text: string, url: string): InlineKeyboard {
  return new InlineKeyboard().webApp(text, url);
}
