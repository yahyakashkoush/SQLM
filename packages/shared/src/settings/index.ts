/**
 * Every admin-editable platform setting, with its default. The API falls
 * back to `default` when no row exists, so a fresh database behaves
 * sensibly before anyone opens the Settings page.
 *
 * Message templates accept `{placeholder}` tokens; see `renderTemplate`.
 */
export type SettingType = 'text' | 'textarea' | 'boolean' | 'number';
export type SettingGroup = 'store' | 'bot' | 'delivery' | 'orders';

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  label: string;
  help?: string;
  type: SettingType;
  default: string | number | boolean;
  placeholders?: readonly string[];
}

const DELIVERY_PLACEHOLDERS = [
  'order_number',
  'product_name',
  'quantity',
  'content',
  'instructions',
  'warranty',
  'duration',
  'customer_name',
  'store_name',
  'support_contact',
] as const;

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { key: 'store.name', group: 'store', label: 'Store name', type: 'text', default: 'SQLM Store' },
  {
    key: 'store.supportContact',
    group: 'store',
    label: 'Support contact',
    help: 'Telegram username or phone shown to customers.',
    type: 'text',
    default: '@sqlm_support',
  },
  {
    key: 'store.defaultCurrency',
    group: 'store',
    label: 'Default currency',
    help: 'Pre-selected when creating new products (3-letter code, e.g. EGP or USD).',
    type: 'text',
    default: 'USD',
  },
  {
    key: 'bot.welcomeMessage',
    group: 'bot',
    label: 'Welcome message (/start)',
    type: 'textarea',
    default:
      'أهلاً بيك في {store_name} 👋\n\nهنا تقدر تشتري الاشتراكات والمنتجات الرقمية، تتابع طلباتك، وتكلم الدعم — كله من القائمة تحت 👇',
    placeholders: ['store_name', 'customer_name', 'support_contact'],
  },
  {
    key: 'bot.supportMessage',
    group: 'bot',
    label: 'Support button reply',
    type: 'textarea',
    default: '🎫 محتاج مساعدة؟ اكتب رسالتك هنا مباشرة وفريق الدعم هيرد عليك، أو افتح تذكرة من التطبيق.\nللتواصل: {support_contact}',
    placeholders: ['store_name', 'support_contact'],
  },
  {
    key: 'bot.paymentMessage',
    group: 'bot',
    label: 'Payment button reply',
    type: 'textarea',
    default:
      '💳 طرق الدفع بتظهر عند إتمام الطلب. بعد التحويل ابعت صورة الإيصال هنا في الشات أو ارفعها من صفحة الطلب في التطبيق.',
    placeholders: ['store_name', 'support_contact'],
  },
  {
    key: 'delivery.message',
    group: 'delivery',
    label: 'Delivery message sent to the customer',
    help: 'Sent on Telegram when an order item is delivered. A delivery template can override it.',
    type: 'textarea',
    default:
      '✅ تم تسليم طلبك #{order_number}\n\n📦 المنتج: {product_name}\n\n🔐 بيانات الطلب:\n{content}\n\n{instructions}\n\nلو في أي مشكلة تواصل مع الدعم: {support_contact}\nشكراً لتعاملك مع {store_name} 💙',
    placeholders: DELIVERY_PLACEHOLDERS,
  },
  {
    key: 'delivery.sendContentInTelegram',
    group: 'delivery',
    label: 'Send delivered details in the Telegram chat',
    help: 'When off, the customer only gets a notice and views the details inside the Mini App.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'orders.paymentApprovedMessage',
    group: 'orders',
    label: 'Payment approved message',
    type: 'textarea',
    default: '✅ تم تأكيد الدفع لطلبك #{order_number}. جاري تجهيز طلبك الآن.',
    placeholders: ['order_number', 'store_name'],
  },
  {
    key: 'orders.paymentRejectedMessage',
    group: 'orders',
    label: 'Payment rejected message',
    type: 'textarea',
    default: '❌ تم رفض إثبات الدفع لطلبك #{order_number}.\nالسبب: {reason}\n\nتقدر ترفع إثبات جديد من صفحة الطلب.',
    placeholders: ['order_number', 'reason', 'store_name'],
  },
];

export const SETTING_DEFAULTS: Record<string, string | number | boolean> = Object.fromEntries(
  SETTING_DEFINITIONS.map((d) => [d.key, d.default]),
);

/** Replaces `{name}` tokens; unknown tokens are left as-is so typos stay visible. */
export function renderTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template
    .replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = values[name];
      return value === undefined ? match : value === null ? '' : String(value);
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
