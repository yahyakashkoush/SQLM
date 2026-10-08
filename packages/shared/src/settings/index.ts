/**
 * Every admin-editable platform setting, with its default. The API falls
 * back to `default` when no row exists, so a fresh database behaves
 * sensibly before anyone opens the Settings page.
 *
 * Message templates accept `{placeholder}` tokens; see `renderTemplate`.
 */
export type SettingType = 'text' | 'textarea' | 'boolean' | 'number';
export type SettingGroup =
  | 'store'
  | 'site'
  | 'pricing'
  | 'customers'
  | 'wholesale'
  | 'security'
  | 'bot'
  | 'delivery'
  | 'orders';

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  label: string;
  help?: string;
  type: SettingType;
  default: string | number | boolean;
  placeholders?: readonly string[];
  /** Bounds for `number` settings, enforced by the API on save. */
  min?: number;
  max?: number;
}

/** Values every customer-facing template can use; filled by SettingsService.storeValues(). */
const STORE_PLACEHOLDERS = ['store_name', 'support_contact', 'delivery_time'] as const;

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
  'delivery_time',
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
    key: 'store.deliveryTime',
    group: 'store',
    label: 'Delivery time promise',
    help: 'Shown in the welcome, payment and approval messages as {delivery_time}.',
    type: 'text',
    default: 'من 15 دقيقة لحد ساعتين',
  },
  {
    key: 'store.rules',
    group: 'store',
    label: 'Warranty & rules (📜 button in the bot)',
    help: 'What the customer reads before buying: warranty, what voids it, and the fake-transfer policy.',
    type: 'textarea',
    default:
      '📜 الضمان وشروط الاستخدام — {store_name}\n\n' +
      '✅ كل حساب عليه ضمان طول المدة المكتوبة في صفحة المنتج.\n' +
      '🔁 لو حصلت مشكلة خلال الضمان بنصلّحها أو نبدّل الحساب مجاناً.\n' +
      '⏱️ التسليم {delivery_time} بعد تأكيد الدفع.\n\n' +
      '⚠️ عشان الضمان يفضل ساري:\n' +
      '• ماتغيّرش الإيميل أو الباسورد إلا لو المنتج مكتوب إنه حساب خاص بيك.\n' +
      '• ماتشاركش الحساب مع حد، وماتسجّلش خروج باقي الأجهزة.\n' +
      '• ماتفعّلش التحقق بخطوتين على حساب مشترك.\n\n' +
      '🚫 أي تحويل مزيف أو إيصال معدّل أو مكرر = إلغاء الطلب وحظر نهائي.\n\n' +
      'للاستفسار: {support_contact}',
    placeholders: STORE_PLACEHOLDERS,
  },
  {
    key: 'site.tagline',
    group: 'site',
    label: 'Website headline',
    help: 'The big line at the top of the public website.',
    type: 'text',
    default: 'اشتراكاتك الرقمية الأصلية — بسعر أقل، وتسليم في دقايق.',
  },
  {
    key: 'site.about',
    group: 'site',
    label: 'About the store (website)',
    type: 'textarea',
    default:
      '{store_name} متجر متخصص في الاشتراكات والأدوات الرقمية الأصلية: أدوات الذكاء الاصطناعي، التصميم، المونتاج، البرمجة، الـ VPN والمزيد.\n\n' +
      'بنشتغل بالكامل من خلال تيليجرام: بتختار المنتج، بتدفع بالطريقة اللي تناسبك، وبتستلم في الشات. كل منتج عليه ضمان طول مدته، ودعم حقيقي بيرد عليك بنفسه.',
    placeholders: STORE_PLACEHOLDERS,
  },
  {
    key: 'site.botUrl',
    group: 'site',
    label: 'Telegram bot link',
    help: 'Every "start" button on the website opens this link.',
    type: 'text',
    default: 'https://t.me/subsctech_bot',
  },
  {
    key: 'site.terms',
    group: 'site',
    label: 'Terms & conditions',
    help: 'Shown on the website, in the Mini App, and by /terms in the bot.',
    type: 'textarea',
    default:
      'شروط وأحكام {store_name}\n\n' +
      'باستخدامك للبوت أو المتجر أو الموقع فأنت توافق على الشروط دي بالكامل.\n\n' +
      '١) المنتجات\n' +
      '• كل المنتجات اشتراكات وأكواد وحسابات رقمية، بتتسلّم إلكترونياً داخل تيليجرام أو التطبيق.\n' +
      '• مدة كل اشتراك ونوعه (حساب مشترك / حساب خاص / كود تفعيل) مكتوبين في صفحة المنتج، وهي اللي بتحكم الضمان.\n\n' +
      '٢) الطلب والدفع\n' +
      '• الطلب مش بيتأكد إلا بعد ما المبلغ يوصل كامل لحسابنا ونراجعه على كشف الحساب.\n' +
      '• لازم تحوّل المبلغ بالظبط المكتوب في الطلب، وتكتب الرقم أو الحساب اللي حوّلت منه.\n' +
      '• الأسعار ممكن تتغير في أي وقت، لكن الطلب اللي اتعمل بيفضل بالسعر اللي اتعمل بيه.\n\n' +
      '٣) التسليم\n' +
      '• التسليم {delivery_time} بعد تأكيد الدفع، وأحياناً أسرع.\n' +
      '• بيانات المنتج بتوصلك على حسابك في تيليجرام بس، ومش هنطلب منك أي باسورد خاص بيك.\n\n' +
      '٤) الضمان والاسترجاع\n' +
      '• الضمان ساري طول المدة المكتوبة في صفحة المنتج.\n' +
      '• لو حصلت مشكلة خلال الضمان بنصلّحها أو نبدّل المنتج. لو مقدرناش، بنرجّع قيمة المدة المتبقية.\n' +
      '• الضمان بيسقط لو غيّرت بيانات حساب مشترك، أو شاركته، أو فعّلت عليه تحقق بخطوتين، أو استخدمته بطريقة تخالف شروط الخدمة الأصلية.\n' +
      '• المنتجات الرقمية اللي اتسلّمت واشتغلت مش بتترجّع.\n\n' +
      '٥) الأمان ومنع الاحتيال\n' +
      '• أي إيصال مزيف أو معدّل أو مستخدم قبل كده = إلغاء الطلب وحظر نهائي.\n' +
      '• المحاولات المريبة في الدفع أو الطلبات الوهمية المتكررة بتوقف الحساب مؤقتاً، والتكرار في نفس اليوم بيخلّي الإيقاف أطول أو نهائي.\n' +
      '• لو حسابك اتوقف بالغلط تقدر تقدّم التماس من البوت وبنراجعه بأنفسنا.\n\n' +
      '٦) الخصوصية\n' +
      '• بنحتفظ بالاسم والرقم اللي بتكتبهم في أول طلب علشان نتواصل معاك بخصوص طلباتك بس، ومش بنشاركهم مع أي حد.\n\n' +
      '٧) التواصل\n' +
      '• أي استفسار أو مشكلة: {support_contact}',
    placeholders: STORE_PLACEHOLDERS,
  },
  {
    key: 'wholesale.enabled',
    group: 'wholesale',
    label: 'Accept wholesale applications',
    type: 'boolean',
    default: true,
  },
  {
    key: 'wholesale.terms',
    group: 'wholesale',
    label: 'Wholesale membership terms',
    help: 'The applicant must accept these before applying.',
    type: 'textarea',
    default:
      'شروط عضوية تجار الجملة — {store_name}\n\n' +
      '• العضوية للتجار والموزعين اللي بيشتروا بكميات، وبتتراجع يدوياً قبل الموافقة.\n' +
      '• أسعار الجملة متاحة على الباقات (الكميات) بس، مش على القطعة الواحدة.\n' +
      '• ممنوع نشر أسعار الجملة أو بيعها بأقل من سعر المتجر.\n' +
      '• الضمان على منتجات الجملة نفس ضمان المتجر، وبيتقدّم من حساب التاجر بس مش من عملاؤه.\n' +
      '• أي تحايل أو إعادة بيع لبيانات منتجات مسروقة أو استخدام إيصالات مزيفة = إلغاء العضوية وحظر نهائي.\n' +
      '• المتجر من حقه يوقف العضوية أو يعدّل الأسعار والشروط في أي وقت.',
    placeholders: STORE_PLACEHOLDERS,
  },
  {
    key: 'security.strikeWindowHours',
    group: 'security',
    label: 'Strike window (hours)',
    help: 'Suspicious events inside this window count together. Default 24 = "the same day".',
    type: 'number',
    default: 24,
    min: 1,
    max: 720,
  },
  {
    key: 'security.firstSuspendMinutes',
    group: 'security',
    label: '1st strike — suspension (minutes)',
    type: 'number',
    default: 60,
    min: 1,
    max: 10080,
  },
  {
    key: 'security.secondSuspendHours',
    group: 'security',
    label: '2nd strike — suspension (hours)',
    type: 'number',
    default: 24,
    min: 1,
    max: 720,
  },
  {
    key: 'security.banAfterStrikes',
    group: 'security',
    label: 'Permanent ban at strike number',
    help: 'This many strikes inside the window bans the account for good (it can still appeal).',
    type: 'number',
    default: 3,
    min: 2,
    max: 20,
  },
  {
    key: 'security.maxUnpaidOrdersPerHour',
    group: 'security',
    label: 'Unpaid orders allowed per hour',
    help: 'Opening more unpaid orders than this in an hour is refused and counts as a strike.',
    type: 'number',
    default: 4,
    min: 1,
    max: 100,
  },
  {
    key: 'bot.suspendedMessage',
    group: 'bot',
    label: 'Message to a temporarily suspended customer',
    type: 'textarea',
    default:
      '⏸️ حسابك موقوف مؤقتاً لحد {until}.\nالسبب: {reason}\n\nلو شايف إن ده غلط اضغط «📝 تقديم التماس» واكتب اللي حصل.',
    placeholders: ['until', 'reason', ...STORE_PLACEHOLDERS],
  },
  {
    key: 'pricing.egpPerUsd',
    group: 'pricing',
    label: 'EGP per 1 USD',
    help:
      'Prices are set in USD. When a customer pays with an EGP method (Vodafone Cash, InstaPay, bank) they are told the EGP amount at this rate, rounded up to a whole pound. Each order keeps the rate it was placed at.',
    type: 'number',
    default: 50,
    min: 1,
    max: 100000,
  },
  {
    key: 'customers.verifiedDiscountPercent',
    group: 'customers',
    label: 'Verified customer discount (%)',
    help:
      'A customer becomes verified (مميز وموثّق) automatically after their first paid order, and gets this discount on every order after that. 0 = no discount (the default — this is your margin, so it starts off until you choose a number).',
    type: 'number',
    default: 0,
    min: 0,
    max: 90,
  },
  {
    key: 'customers.welcomeGiftPercent',
    group: 'customers',
    label: 'Welcome gift — first order discount (%)',
    help:
      'The gift for regular customers who have not bought yet: applied automatically to their first order, no code needed. 0 = no gift (the default until you choose a number).',
    type: 'number',
    default: 0,
    min: 0,
    max: 90,
  },
  {
    key: 'customers.welcomeGiftMessage',
    group: 'customers',
    label: 'Welcome gift text (shown in the Mini App)',
    type: 'textarea',
    default: '🎁 هدية ليك: خصم {percent}% على أول طلب — بيتطبّق تلقائي من غير كود.',
    placeholders: ['percent', 'store_name'],
  },
  {
    key: 'customers.verifiedMessage',
    group: 'customers',
    label: 'Telegram message when a customer becomes verified',
    type: 'textarea',
    default:
      '⭐ مبروك! بقيت عميل مميز وموثّق في {store_name}.\nمن دلوقتي ليك خصم {percent}% على كل طلباتك، بيتطبّق تلقائي.',
    placeholders: ['percent', 'store_name', 'customer_name'],
  },
  {
    key: 'customers.legacyDiscountPercent',
    group: 'customers',
    label: 'Old customers discount (%)',
    help:
      'For customers you had before this store: add their phone numbers on the Old Customers page. When one of them shares that number from their own Telegram (🎁 button in the bot) they get this discount on every order. A number can carry its own percentage instead. 0 = the offer is hidden.',
    type: 'number',
    default: 0,
    min: 0,
    max: 90,
  },
  {
    key: 'customers.legacyOfferMessage',
    group: 'customers',
    label: 'Old customer offer (bot, before sharing the number)',
    type: 'textarea',
    default:
      '🎁 كنت عميل عندنا قبل كده؟\n\nاضغط «📱 شارك رقمي» تحت — لو رقمك في قائمة عملائنا القدام هيتفعّل ليك خصم {percent}% على كل طلباتك تلقائي.\n\n🔒 الرقم بيتستخدم للتحقق بس ومش بيظهر لحد.',
    placeholders: ['percent', 'store_name', 'customer_name'],
  },
  {
    key: 'customers.legacyWelcomeMessage',
    group: 'customers',
    label: 'Old customer matched (bot)',
    type: 'textarea',
    default:
      '🎉 أهلاً بيك تاني يا {customer_name}!\nاتعرّفنا عليك كعميل قديم، واتفعّل ليك خصم {percent}% على كل طلباتك — بيتطبّق لوحده من غير كود.',
    placeholders: ['percent', 'store_name', 'customer_name'],
  },
  {
    key: 'bot.welcomeMessage',
    group: 'bot',
    label: 'Welcome message (/start)',
    type: 'textarea',
    default:
      'أهلاً بيك يا {customer_name} في {store_name} 👋\n\n' +
      'اشتراكات وأدوات رقمية أصلية بأسعار أقل بكتير — ChatGPT · Canva · Adobe · CapCut · Figma · VPN وأكتر.\n\n' +
      '⚡ تسليم {delivery_time}\n' +
      '🛡️ ضمان على كل حساب طول المدة\n' +
      '💳 فودافون كاش · إنستاباي · USDT\n' +
      '💬 دعم حقيقي هنا في الشات\n\n' +
      'اضغط «🛍️ افتح المتجر» واختار اللي محتاجه 👇',
    placeholders: ['store_name', 'customer_name', 'support_contact', 'delivery_time'],
  },
  {
    key: 'bot.supportMessage',
    group: 'bot',
    label: 'Support button reply',
    type: 'textarea',
    default:
      '🎫 محتاج مساعدة؟\nاكتب مشكلتك في رسالة واحدة هنا — ولو عن طلب اكتب رقمه — وفريق الدعم هيرد عليك في نفس الشات.\nأو كلّمنا مباشرة: {support_contact}',
    placeholders: STORE_PLACEHOLDERS,
  },
  {
    key: 'bot.paymentMessage',
    group: 'bot',
    label: 'Payment button reply',
    type: 'textarea',
    default:
      '💳 إزاي تدفع؟\n\n' +
      '1️⃣ اختار المنتج من المتجر واضغط «اطلب».\n' +
      '2️⃣ اختار طريقة الدفع — هيظهرلك الرقم والمبلغ بالظبط (بالجنيه لو الطريقة مصرية).\n' +
      '3️⃣ حوّل المبلغ بالظبط وابعت صورة الإيصال هنا في الشات أو من صفحة الطلب.\n' +
      '4️⃣ بنراجع التحويل ونسلّمك {delivery_time}.\n\n' +
      '💎 بالـ USDT؟ الطلب بيتأكد تلقائي أول ما التحويل يوصل — من غير إيصال.\n\n' +
      '{proof_warning}',
    placeholders: [...STORE_PLACEHOLDERS, 'proof_warning'],
  },
  {
    key: 'bot.bannedMessage',
    group: 'bot',
    label: 'Message to a banned customer',
    help: 'Sent at most twice a day; everything else a banned customer sends is ignored.',
    type: 'textarea',
    default:
      '🚫 حسابك في {store_name} موقوف بسبب مخالفة شروط الاستخدام.\nلو شايف إن ده حصل بالغلط اضغط «📝 تقديم التماس» واكتب اللي حصل، أو تواصل مع {support_contact}.',
    placeholders: STORE_PLACEHOLDERS,
  },
  {
    key: 'delivery.message',
    group: 'delivery',
    label: 'Delivery message sent to the customer',
    help: 'Sent on Telegram when an order item is delivered. A delivery template can override it.',
    type: 'textarea',
    default:
      '✅ طلبك #{order_number} جاهز!\n\n📦 {product_name}\n\n🔐 بيانات الدخول:\n{content}\n\n{instructions}\n\n' +
      '⚠️ ماتغيّرش بيانات الحساب إلا لو مكتوب إنه حساب خاص بيك — ده بيلغي الضمان.\n' +
      'أي مشكلة كلّمنا فوراً: {support_contact}\nشكراً لثقتك في {store_name} 💙',
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
    default: '✅ تم تأكيد الدفع لطلبك #{order_number}.\nجاري تجهيز طلبك وهيوصلك هنا {delivery_time} 🚀',
    placeholders: ['order_number', ...STORE_PLACEHOLDERS],
  },
  {
    key: 'orders.paymentRejectedMessage',
    group: 'orders',
    label: 'Payment rejected message',
    type: 'textarea',
    default:
      '❌ تم رفض إثبات الدفع لطلبك #{order_number}.\nالسبب: {reason}\n\nلو حوّلت فعلاً ابعت صورة الإيصال الصحيحة من صفحة الطلب أو هنا في الشات.',
    placeholders: ['order_number', 'reason', ...STORE_PLACEHOLDERS],
  },
  {
    key: 'orders.proofWarning',
    group: 'orders',
    label: 'Fake-transfer warning',
    help: 'Shown on the payment step in the Mini App and at the end of the bot payment guide.',
    type: 'textarea',
    default:
      '⚠️ كل تحويل بيتراجع يدوياً على كشف الحساب. أي إيصال مزيف أو معدّل أو مستخدم قبل كده = إلغاء الطلب وحظر نهائي.',
    placeholders: STORE_PLACEHOLDERS,
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

/**
 * Customer audiences for broadcasts and the customers list. Defined once
 * here so the dashboard's picker and the API's filter can never disagree
 * about what a segment means; the API owns the actual query.
 */
export const CUSTOMER_SEGMENTS = [
  'ALL',
  'VERIFIED',
  'REGULAR',
  'BUYERS',
  'NON_BUYERS',
  'DORMANT',
  'WHOLESALE',
] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/** Days without a paid order before a past buyer counts as dormant. */
export const DORMANT_AFTER_DAYS = 30;

export const CUSTOMER_SEGMENT_LABELS: Record<CustomerSegment, { label: string; description: string }> = {
  ALL: { label: 'Everyone', description: 'Every active customer.' },
  VERIFIED: { label: 'Verified', description: 'Verified (مميز) customers — completed at least one paid order.' },
  REGULAR: { label: 'Regular', description: 'Not verified yet — the ones the welcome gift is for.' },
  BUYERS: { label: 'Buyers', description: 'Have paid for at least one order.' },
  NON_BUYERS: { label: 'Never bought', description: 'Opened the bot but never completed a paid order.' },
  DORMANT: {
    label: `Dormant (${DORMANT_AFTER_DAYS}d)`,
    description: `Bought before, but nothing paid in the last ${DORMANT_AFTER_DAYS} days.`,
  },
  WHOLESALE: { label: 'Wholesale merchants', description: 'Approved wholesale members (تجار الجملة).' },
};
