import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { encryptSecret } from '@sqlm/shared/crypto';

const prisma = new PrismaClient();

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@sqlm.local';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe123!';
const ENCRYPTION_KEY = process.env.INVENTORY_ENCRYPTION_KEY;
const IMG_BASE = `https://${process.env.WEB_DOMAIN || 'subsc.tech'}/products`;

async function seedOwner() {
  const passwordHash = await argon2.hash(OWNER_PASSWORD);
  const owner = await prisma.staff.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      passwordHash,
      name: 'Platform Owner',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  console.warn(`[seed] owner staff account ready: ${owner.email}`);
  if (!process.env.SEED_OWNER_PASSWORD) {
    console.warn(`[seed]   dev-only default password: ${OWNER_PASSWORD} — change before any shared use.`);
  }
}

async function seedPaymentMethods() {
  const methods = [
    {
      name: 'Bank Transfer',
      description: 'Transfer to our bank account and upload your receipt.',
      accountNumber: 'IBAN-EXAMPLE-0000-0000-0000',
      instructions: 'Include your order number in the transfer reference.',
      currency: 'USD',
      displayOrder: 1,
    },
    {
      name: 'Vodafone Cash',
      description: 'Send to our Vodafone Cash wallet.',
      accountNumber: '01000000000',
      instructions: 'Send the exact order total, then upload the confirmation screenshot.',
      currency: 'EGP',
      displayOrder: 2,
    },
    {
      name: 'InstaPay',
      description: 'Pay instantly via InstaPay.',
      accountNumber: 'sqlm@instapay',
      instructions: 'Use the order number as the payment note.',
      currency: 'EGP',
      displayOrder: 3,
    },
  ];

  for (const method of methods) {
    const existing = await prisma.paymentMethod.findFirst({ where: { name: method.name } });
    if (existing) continue;
    await prisma.paymentMethod.create({ data: method });
  }
  console.warn(`[seed] payment methods ready (${methods.length})`);
}

async function seedPlatformSettings() {
  const settings: Array<{ key: string; value: unknown }> = [
    { key: 'store.name', value: 'SQLM Store' },
    { key: 'store.supportContact', value: '@sqlm_support' },
    { key: 'store.defaultCurrency', value: 'USD' },
  ];

  for (const setting of settings) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value as never },
    });
  }
  console.warn(`[seed] platform settings ready (${settings.length})`);
}

async function seedCatalog() {
  // --- Categories ---
  const categories = [
    { slug: 'ai-tools', name: 'AI Tools', description: 'أدوات الذكاء الاصطناعي — محادثة، بحث، كتابة، برمجة وتحليل', displayOrder: 1 },
    { slug: 'design-creative', name: 'Design & Creative', description: 'أدوات التصميم والإبداع — جرافيك، فيديو، عروض تقديمية ومونتاج', displayOrder: 2 },
    { slug: 'development', name: 'Development & Automation', description: 'أدوات التطوير والأتمتة — برمجة، بناء مواقع، أتمتة وربط خدمات', displayOrder: 3 },
    { slug: 'cloud-infrastructure', name: 'Cloud & Infrastructure', description: 'خدمات سحابية — سيرفرات، استضافة، قواعد بيانات وتخزين', displayOrder: 4 },
    { slug: 'vpn-security', name: 'VPN & Security', description: 'حماية وأمان — VPN، مفاتيح تفعيل وحماية الخصوصية', displayOrder: 5 },
    { slug: 'productivity-learning', name: 'Productivity & Learning', description: 'إنتاجية وتعلم — تنظيم، ملاحظات، تعلم لغات ودورات أونلاين', displayOrder: 6 },
  ];

  const categoryMap: Record<string, string> = {};
  for (const cat of categories) {
    const record = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, description: cat.description, displayOrder: cat.displayOrder },
      create: cat,
    });
    categoryMap[cat.slug] = record.id;
  }
  console.warn(`[seed] categories ready (${categories.length})`);

  // --- Products ---
  const products = [
    // ── AI Tools ──
    {
      slug: 'gpt-plus-1m',
      name: 'GPT Plus 1M',
      shortDescription: 'حساب ChatGPT Plus جاهز لمدة شهر',
      description: 'حساب ChatGPT Plus جاهز. مناسب للمحادثة، الكتابة، البرمجة، تحليل الملفات والصور، البحث وإنشاء المحتوى.',
      categorySlug: 'ai-tools',
      price: 16.50,
      compareAtPrice: 20,
      duration: '1 شهر',
      warranty: 'حسب العرض',
      image: 'gpt.png',
      tags: ['ai', 'chatgpt', 'openai'],
    },
    {
      slug: 'gpt-plus-4m',
      name: 'GPT Plus 4M',
      shortDescription: 'حساب ChatGPT Plus خاص لمدة 4 أشهر',
      description: 'حساب ChatGPT Plus خاص بالعميل لمدة 4 أشهر. مناسب للبرمجة، الدراسة، البحث، الكتابة، تحليل الملفات والصور وإنشاء المحتوى.',
      categorySlug: 'ai-tools',
      price: 65,
      compareAtPrice: 80,
      duration: '4 أشهر',
      warranty: '30 يوم',
      image: 'gpt.png',
      tags: ['ai', 'chatgpt', 'openai'],
    },
    {
      slug: 'gpt-plus-12-24m',
      name: 'GPT Plus 12/24M',
      shortDescription: 'حساب ChatGPT بمدة طويلة 12-24 شهر',
      description: 'حساب ChatGPT جاهز بمدة طويلة. مناسب للبرمجة، الدراسة، البحث، كتابة المحتوى، تحليل الملفات والعصف الذهني.',
      categorySlug: 'ai-tools',
      price: 28,
      compareAtPrice: 480,
      duration: '12 / 24 شهر',
      image: 'gpt.png',
      tags: ['ai', 'chatgpt', 'openai'],
      featured: true,
    },
    {
      slug: 'gpt-pro-1m',
      name: 'GPT Pro 1M',
      shortDescription: 'حساب ChatGPT Pro جاهز لمدة شهر',
      description: 'حساب ChatGPT Pro جاهز. مناسب للاستخدام المكثف في البرمجة، البحث، تحليل الملفات، إنشاء المحتوى والمهام المعقدة.',
      categorySlug: 'ai-tools',
      price: 95,
      compareAtPrice: 100,
      duration: '1 شهر',
      image: 'gpt.png',
      tags: ['ai', 'chatgpt', 'pro'],
    },
    {
      slug: 'perplexity-12m',
      name: 'Perplexity 12M',
      shortDescription: 'حساب Perplexity Pro جاهز لمدة سنة',
      description: 'حساب Perplexity Pro جاهز. مناسب للبحث على الإنترنت، الإجابات المدعومة بالمصادر، Deep Research، نماذج AI المتعددة ورفع الملفات.',
      categorySlug: 'ai-tools',
      price: 80,
      compareAtPrice: 200,
      duration: '12 شهر',
      image: 'perplexity.jpeg',
      tags: ['ai', 'search', 'perplexity'],
    },
    {
      slug: 'perplexity-7d',
      name: 'Perplexity 7D',
      shortDescription: 'حساب Perplexity جاهز لمدة أسبوع',
      description: 'حساب Perplexity جاهز لفترة قصيرة، مناسب للبحث بالذكاء الاصطناعي، الإجابات بالمصادر والبحث السريع.',
      categorySlug: 'ai-tools',
      price: 2,
      compareAtPrice: 5,
      duration: '7 أيام',
      image: 'perplexity.jpeg',
      tags: ['ai', 'search', 'perplexity'],
    },
    {
      slug: 'elevenlabs-3m',
      name: 'ElevenLabs 3M',
      shortDescription: 'حساب ElevenLabs Creator لمدة 3 أشهر',
      description: 'حساب ElevenLabs Creator. لتحويل النص إلى صوت، Voice Over، التعليق الصوتي للفيديوهات والبودكاست والمحتوى والإعلانات. 121 ألف رصيد شهريًا حسب العرض.',
      categorySlug: 'ai-tools',
      price: 36,
      compareAtPrice: 66,
      duration: '3 أشهر',
      image: 'elevenlabs.png',
      tags: ['ai', 'voice', 'tts'],
    },
    {
      slug: 'supergrok-plus-3m',
      name: 'SuperGrok Plus 3M',
      shortDescription: 'حساب SuperGrok Plus جاهز لمدة 3 أشهر',
      description: 'حساب SuperGrok Plus جاهز. مناسب للمحادثة، البحث، الكتابة، البرمجة وتحليل المعلومات.',
      categorySlug: 'ai-tools',
      price: 75,
      compareAtPrice: 300,
      duration: '3 أشهر',
      image: 'grok.png',
      tags: ['ai', 'grok', 'x'],
      featured: true,
    },
    {
      slug: 'supergrok-2m',
      name: 'SuperGrok 2M',
      shortDescription: 'Super Grok + X Premium Plus لمدة شهرين',
      description: 'Super Grok + X Premium Plus لمدة شهرين. للبحث والمحادثة والكتابة والبرمجة، بالإضافة إلى مزايا X Premium Plus.',
      categorySlug: 'ai-tools',
      price: 45,
      compareAtPrice: 60,
      duration: 'شهرين',
      image: 'grok.png',
      tags: ['ai', 'grok', 'x-premium'],
    },
    {
      slug: 'meshy-1m',
      name: 'Meshy 1M',
      shortDescription: 'حساب Meshy AI Pro لمدة شهر مع 1100 نقطة',
      description: 'حساب Meshy AI Pro لمدة شهر مع 1100 نقطة. لإنشاء نماذج 3D بالذكاء الاصطناعي وتحويل النصوص أو الصور إلى مجسمات.',
      categorySlug: 'ai-tools',
      price: 5,
      compareAtPrice: 10,
      duration: '1 شهر',
      warranty: '25 يوم',
      image: 'meshy.jpeg',
      tags: ['ai', '3d', 'meshy'],
    },
    {
      slug: 'wispr-pro-3m',
      name: 'Wispr Pro 3M',
      shortDescription: 'حساب Wispr Pro لتحويل الكلام إلى نص',
      description: 'حساب Wispr Pro لتحويل الكلام إلى نص، الكتابة بالصوت، الإملاء، كتابة الرسائل والمستندات والأكواد باستخدام الصوت.',
      categorySlug: 'ai-tools',
      price: 15,
      compareAtPrice: 148,
      duration: '3 أشهر',
      image: 'wispr.jpeg',
      tags: ['ai', 'voice', 'dictation'],
    },
    {
      slug: 'manus-12m',
      name: 'Manus 12M',
      shortDescription: 'Manus Pro لمدة 12 شهر — AI Agents',
      description: 'Manus Pro لمدة 12 شهرًا، 4000 رصيد شهريًا حسب العرض. مناسب لـAI Agents، البحث، تحليل المعلومات، إنشاء المحتوى والبرمجة وتنفيذ المهام متعددة الخطوات.',
      categorySlug: 'ai-tools',
      price: 75,
      compareAtPrice: 250,
      duration: '12 شهر',
      image: 'manus.png',
      tags: ['ai', 'agents', 'manus'],
    },
    {
      slug: 'kling',
      name: 'Kling AI',
      shortDescription: 'حساب Kling لإنشاء فيديوهات بالذكاء الاصطناعي',
      description: 'حساب Kling جاهز لإنشاء الفيديوهات بالذكاء الاصطناعي من النصوص والصور، وصناعة المشاهد والحركة والمؤثرات والمحتوى البصري.',
      categorySlug: 'ai-tools',
      price: 2,
      compareAtPrice: 4,
      duration: 'حسب الحساب',
      image: 'klingai.png',
      tags: ['ai', 'video', 'kling'],
    },

    // ── Design & Creative ──
    {
      slug: 'adobe-express-12m',
      name: 'Adobe Express 12M',
      shortDescription: 'حساب Adobe Express جاهز لمدة سنة',
      description: 'حساب Adobe Express جاهز. مناسب لتصميم البوستات والإعلانات والصور والفيديوهات القصيرة والعروض ومحتوى السوشيال ميديا.',
      categorySlug: 'design-creative',
      price: 35,
      compareAtPrice: 100,
      duration: '12 شهر',
      image: 'adobe-express.jpeg',
      tags: ['design', 'adobe', 'social-media'],
    },
    {
      slug: 'adobe-pro-4m',
      name: 'Adobe Pro 4M',
      shortDescription: 'Adobe Creative Cloud Pro لمدة 4 أشهر',
      description: 'Adobe Creative Cloud Pro، ويشمل تطبيقات Adobe الإبداعية مثل Photoshop وIllustrator وPremiere، بالإضافة إلى Firefly وAdobe Express. مناسب للتصميم والجرافيك والصور والفيديو والإنتاج الإبداعي.',
      categorySlug: 'design-creative',
      price: 35,
      compareAtPrice: 210,
      duration: '4 أشهر',
      warranty: '28 يوم',
      image: 'adobe-pro.jpeg',
      tags: ['design', 'adobe', 'photoshop', 'premiere'],
      featured: true,
    },
    {
      slug: 'figma-12m',
      name: 'Figma 12M',
      shortDescription: 'حساب Figma EDU Pro جاهز لمدة سنة',
      description: 'حساب Figma EDU Pro جاهز. لتصميم واجهات المواقع والتطبيقات، UI/UX، Wireframes، Prototypes وDesign Systems والعمل الجماعي. 3000 رصيد شهريًا.',
      categorySlug: 'design-creative',
      price: 48,
      compareAtPrice: 192,
      duration: '12 شهر',
      warranty: 'شهر',
      image: 'figma.png',
      tags: ['design', 'ui-ux', 'figma'],
    },
    {
      slug: 'canva-12m',
      name: 'Canva 12M',
      shortDescription: 'حساب Canva Pro جاهز لمدة سنة',
      description: 'حساب Canva Pro جاهز. لتصميم البوستات، اللوجوهات، الإعلانات، العروض، CV، محتوى السوشيال ميديا والفيديوهات.',
      categorySlug: 'design-creative',
      price: 3,
      compareAtPrice: 100,
      duration: '12 شهر',
      image: 'canva.jpeg',
      tags: ['design', 'canva', 'social-media'],
      featured: true,
    },
    {
      slug: 'capcut-6m',
      name: 'CapCut 6M',
      shortDescription: 'حساب CapCut Pro جاهز لمدة 6 أشهر',
      description: 'حساب CapCut Pro جاهز للمونتاج، فيديوهات TikTok وInstagram وYouTube، إزالة الخلفية، المؤثرات، القوالب، الترجمة وأدوات AI.',
      categorySlug: 'design-creative',
      price: 40,
      compareAtPrice: 60,
      duration: '6 أشهر',
      image: 'capcut.png',
      tags: ['video', 'editing', 'capcut'],
    },
    {
      slug: 'capcut-1m',
      name: 'CapCut 1M',
      shortDescription: 'CapCut Pro Team لمدة 30 يوم',
      description: 'CapCut Pro Team لمدة 30 يومًا، بحد أقصى جهازين. مناسب للمونتاج وصناعة محتوى السوشيال ميديا والفيديوهات القصيرة.',
      categorySlug: 'design-creative',
      price: 7.50,
      compareAtPrice: 10,
      duration: '1 شهر',
      warranty: 'كامل حسب العرض',
      image: 'capcut.png',
      tags: ['video', 'editing', 'capcut'],
    },
    {
      slug: 'beautifulai-12m',
      name: 'Beautiful.ai 12M',
      shortDescription: 'حساب Beautiful.ai لإنشاء العروض التقديمية',
      description: 'حساب Beautiful.ai لإنشاء العروض التقديمية بالذكاء الاصطناعي. مناسب للـPresentations، عروض الشركات، المشاريع، الدراسة، Pitch Decks والتقارير.',
      categorySlug: 'design-creative',
      price: 20,
      compareAtPrice: 145,
      duration: '12 شهر',
      image: 'beautifulai.png',
      tags: ['presentations', 'ai', 'slides'],
    },

    // ── Development & Automation ──
    {
      slug: 'replit-12m',
      name: 'Replit 12M',
      shortDescription: 'حساب Replit Core جاهز لمدة سنة',
      description: 'حساب Replit Core جاهز. مناسب لكتابة وتشغيل الأكواد، بناء المواقع والتطبيقات، المشاريع البرمجية وبيئة التطوير السحابية وأدوات AI للبرمجة.',
      categorySlug: 'development',
      price: 70,
      compareAtPrice: 216,
      duration: '12 شهر',
      image: 'replit.png',
      tags: ['dev', 'ide', 'replit'],
    },
    {
      slug: 'lovable-pro-1m',
      name: 'Lovable Pro 1M',
      shortDescription: 'Lovable Pro لبناء مواقع وتطبيقات بالذكاء الاصطناعي',
      description: 'Lovable Pro جاهز لبناء مواقع وتطبيقات Web بالذكاء الاصطناعي، تطوير الواجهات وربط الوظائف وقواعد البيانات.',
      categorySlug: 'development',
      price: 15,
      compareAtPrice: 25,
      duration: '1 شهر',
      warranty: '20 يوم',
      image: 'lovable.jpeg',
      tags: ['dev', 'ai', 'no-code'],
    },
    {
      slug: 'lovable-lite-12m',
      name: 'Lovable Lite 12M',
      shortDescription: 'حساب Lovable لبناء مواقع وتطبيقات لمدة سنة',
      description: 'حساب Lovable جاهز لبناء مواقع وتطبيقات Web بالذكاء الاصطناعي. مناسب لإنشاء MVPs، صفحات الويب، لوحات التحكم والتطبيقات.',
      categorySlug: 'development',
      price: 30,
      compareAtPrice: 90,
      duration: '12 شهر',
      image: 'lovable.jpeg',
      tags: ['dev', 'ai', 'no-code'],
    },
    {
      slug: 'bolt-12m',
      name: 'Bolt 12M',
      shortDescription: 'Bolt.new Pro لبناء المواقع والتطبيقات بالذكاء الاصطناعي',
      description: 'Bolt.new Pro جاهز لبناء المواقع والتطبيقات بالذكاء الاصطناعي، توليد الكود، إنشاء الواجهات وتطوير المشاريع.',
      categorySlug: 'development',
      price: 75,
      compareAtPrice: 230,
      duration: '12 شهر',
      image: 'bolt.jpeg',
      tags: ['dev', 'ai', 'bolt'],
    },
    {
      slug: 'n8n-12m',
      name: 'n8n 12M',
      shortDescription: 'n8n Starter لمدة سنة — أتمتة وربط خدمات',
      description: 'n8n Starter لمدة سنة. مناسب للأتمتة، ربط الخدمات والـAPIs، بناء Workflows، Webhooks والتكامل بين التطبيقات.',
      categorySlug: 'development',
      price: 36,
      compareAtPrice: 240,
      duration: '12 شهر',
      image: 'n8n.jpeg',
      tags: ['automation', 'workflow', 'n8n'],
    },
    {
      slug: 'make-pro-12m',
      name: 'Make Pro 12M',
      shortDescription: 'Make Pro لأتمتة وربط التطبيقات لمدة سنة',
      description: 'Make Pro لأتمتة وربط التطبيقات، بناء Workflows، ربط APIs وWebhooks ونقل البيانات بين الخدمات وإنشاء عمليات Automation.',
      categorySlug: 'development',
      price: 25,
      compareAtPrice: 192,
      duration: '12 شهر',
      image: 'make.png',
      tags: ['automation', 'workflow', 'make'],
    },
    {
      slug: 'autodesk-12m',
      name: 'Autodesk 12M',
      shortDescription: 'حساب Autodesk جاهز لمدة سنة — AutoCAD و Revit',
      description: 'حساب Autodesk جاهز. مناسب لبرامج التصميم الهندسي والمعماري مثل AutoCAD وRevit حسب الخدمات المتاحة بالحساب، والرسم الهندسي وBIM والتصميم والـ3D.',
      categorySlug: 'development',
      price: 6,
      compareAtPrice: 100,
      duration: '12 شهر',
      image: 'autodesk.jpeg',
      tags: ['engineering', 'cad', 'autodesk'],
    },
    {
      slug: 'miro-business-1m',
      name: 'Miro Business 1M',
      shortDescription: 'حساب Miro Business جاهز لمدة شهر',
      description: 'حساب Miro Business جاهز للـWhiteboards، Brainstorming، تخطيط المشاريع، User Flows، خرائط الأفكار والتعاون بين فرق العمل.',
      categorySlug: 'development',
      price: 15,
      compareAtPrice: 40,
      duration: '1 شهر',
      image: 'miro.png',
      tags: ['collaboration', 'whiteboard', 'miro'],
    },
    {
      slug: 'sentry-6m',
      name: 'Sentry 6M',
      shortDescription: 'حساب Sentry لمراقبة التطبيقات لمدة 6 أشهر',
      description: 'حساب Sentry لمراقبة التطبيقات، اكتشاف الأخطاء والاستثناءات، تتبع مشاكل الأداء ومراقبة التطبيقات أثناء التشغيل.',
      categorySlug: 'development',
      price: 25,
      compareAtPrice: 200,
      duration: '6 أشهر',
      image: 'sentry.png',
      tags: ['monitoring', 'devops', 'sentry'],
    },

    // ── Cloud & Infrastructure ──
    {
      slug: 'azure-100',
      name: 'Azure $100',
      shortDescription: 'حساب Azure برصيد $100',
      description: 'حساب/بانل Azure مفعّل يدويًا برصيد $100 حسب العرض. مناسب للسيرفرات Cloud، Virtual Machines، قواعد البيانات، التخزين والخدمات السحابية. البانل مفعلة يدويًا وليست كراك.',
      categorySlug: 'cloud-infrastructure',
      price: 50,
      compareAtPrice: 100,
      duration: 'حسب البانل',
      image: 'azure.jpeg',
      tags: ['cloud', 'azure', 'microsoft'],
    },
    {
      slug: 'amazon-200',
      name: 'Amazon $200',
      shortDescription: 'حساب Amazon جاهز برصيد $200',
      description: 'حساب Amazon جاهز حسب العرض، ويستخدم للخدمات أو الرصيد المتاح بالحساب وفق نوع الحساب والخدمة المقدمة.',
      categorySlug: 'cloud-infrastructure',
      price: 50,
      compareAtPrice: 200,
      duration: 'حسب الحساب',
      image: 'aws.jpeg',
      tags: ['cloud', 'aws', 'amazon'],
    },

    // ── VPN & Security ──
    {
      slug: 'norton-vpn-1m',
      name: 'Norton VPN 1M',
      shortDescription: 'حساب Norton VPN جاهز لمدة شهر',
      description: 'حساب Norton VPN جاهز لتأمين الاتصال بالإنترنت وتشفير حركة البيانات وتحسين الخصوصية أثناء استخدام الشبكات العامة.',
      categorySlug: 'vpn-security',
      price: 5,
      compareAtPrice: 20,
      duration: '1 شهر',
      image: 'norton-vpn.png',
      tags: ['vpn', 'security', 'norton'],
    },
    {
      slug: 'expressvpn-serial',
      name: 'ExpressVPN Serial',
      shortDescription: 'سيريال ExpressVPN لتفعيل خدمة VPN',
      description: 'سيريال ExpressVPN لتفعيل خدمة VPN على الأجهزة المدعومة. واحد من السيريالين فقط.',
      categorySlug: 'vpn-security',
      price: 15,
      compareAtPrice: 240,
      duration: 'حسب السيريال',
      image: 'express-vpn.png',
      deliveryType: 'LICENSE_KEY' as const,
      fulfillmentType: 'KEY' as const,
      tags: ['vpn', 'expressvpn', 'serial'],
    },
    {
      slug: 'windows-10-11-pro-key',
      name: 'Windows 10-11 Pro Key',
      shortDescription: 'مفتاح تفعيل Windows 10/11 Pro',
      description: 'مفتاح تفعيل Windows 10/11 Pro لتفعيل نسخة Windows Pro على الجهاز وفق شروط Microsoft. السيريال الثاني والأخير.',
      categorySlug: 'vpn-security',
      price: 5,
      compareAtPrice: 100,
      duration: 'حسب المفتاح',
      image: 'windows-key.jpeg',
      deliveryType: 'LICENSE_KEY' as const,
      fulfillmentType: 'KEY' as const,
      tags: ['windows', 'license', 'key'],
    },

    // ── Productivity & Learning ──
    {
      slug: 'notion-12m',
      name: 'Notion 12M',
      shortDescription: 'حساب Notion Plus / Education جاهز لمدة سنة',
      description: 'حساب Notion Plus / Education جاهز للاستخدام. مناسب لتنظيم المشاريع والمهام، إنشاء الصفحات وقواعد البيانات، إدارة الملاحظات، التخطيط، مشاركة الملفات والعمل الجماعي.',
      categorySlug: 'productivity-learning',
      price: 30,
      compareAtPrice: 100,
      duration: '12 شهر',
      warranty: 'حسب العرض الأصلي',
      image: 'notion.png',
      tags: ['productivity', 'notion', 'notes'],
    },
    {
      slug: 'notion-6m',
      name: 'Notion 6M',
      shortDescription: 'حساب Notion جاهز لمدة 6 أشهر',
      description: 'حساب Notion جاهز لمدة 6 أشهر. مناسب لتنظيم الملاحظات والمشاريع والمهام، قواعد البيانات، التخطيط وإدارة المحتوى والتعاون.',
      categorySlug: 'productivity-learning',
      price: 15,
      compareAtPrice: 60,
      duration: '6 أشهر',
      image: 'notion.png',
      tags: ['productivity', 'notion', 'notes'],
    },
    {
      slug: 'office-365',
      name: 'Office 365',
      shortDescription: 'حساب Microsoft 365 جاهز',
      description: 'حساب Microsoft 365 جاهز. مناسب لـWord وExcel وPowerPoint وOutlook وخدمات Microsoft 365 حسب الخطة الموجودة بالحساب.',
      categorySlug: 'productivity-learning',
      price: 6,
      compareAtPrice: 100,
      duration: 'حسب الحساب',
      image: 'office365.jpeg',
      tags: ['productivity', 'microsoft', 'office'],
    },
    {
      slug: 'duolingo-2m',
      name: 'Duolingo 2M',
      shortDescription: 'حساب Duolingo جاهز لتعلم اللغات',
      description: 'حساب Duolingo جاهز لتعلم اللغات من خلال الدروس التفاعلية، التمارين اليومية، الاستماع، القراءة والمفردات.',
      categorySlug: 'productivity-learning',
      price: 10,
      compareAtPrice: 25,
      duration: 'شهرين',
      image: 'duolingo.jpeg',
      tags: ['learning', 'languages', 'duolingo'],
    },
    {
      slug: 'skillshare-1m',
      name: 'Skillshare 1M',
      shortDescription: 'حساب Skillshare جاهز للتعلم أونلاين',
      description: 'حساب Skillshare جاهز للتعلم أونلاين في التصميم، الجرافيك، التصوير، الموشن، التسويق، الأعمال، البرمجة ومجالات الإبداع.',
      categorySlug: 'productivity-learning',
      price: 15,
      compareAtPrice: 50,
      duration: '1 شهر',
      image: 'skillshare.jpeg',
      tags: ['learning', 'courses', 'skillshare'],
    },
    {
      slug: 'aviera-2m',
      name: 'Aviera 2M',
      shortDescription: 'حساب Aviera جاهز لمدة شهرين',
      description: 'حساب Aviera جاهز حسب العرض، لاستخدام خدمات المنصة والميزات المتاحة في الاشتراك.',
      categorySlug: 'productivity-learning',
      price: 15,
      compareAtPrice: 60,
      duration: 'شهرين',
      image: 'aveiro.png',
      tags: ['productivity', 'aviera'],
    },
  ];

  let created = 0;
  for (const p of products) {
    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    if (existing) {
      console.warn(`[seed] product "${p.slug}" already exists — skipping`);
      continue;
    }

    await prisma.product.create({
      data: {
        slug: p.slug,
        name: p.name,
        shortDescription: p.shortDescription,
        description: p.description,
        categoryId: categoryMap[p.categorySlug],
        images: [`${IMG_BASE}/${p.image}`],
        price: p.price,
        compareAtPrice: p.compareAtPrice,
        currency: 'USD',
        duration: p.duration,
        warranty: p.warranty,
        stock: 50,
        inventoryMode: 'QUANTITY',
        deliveryType: p.deliveryType ?? 'MANUAL',
        fulfillmentType: p.fulfillmentType ?? 'ACCOUNT',
        activationInstructions: 'التسليم خلال 15 دقيقة إلى ساعتين. سيتم إرسال بيانات الحساب عبر الطلب.',
        status: 'ACTIVE',
        visibility: 'VISIBLE',
        featured: p.featured ?? false,
        tags: p.tags,
      },
    });
    created++;
  }

  console.warn(`[seed] catalog ready (${categories.length} categories, ${created} products created, ${products.length - created} skipped)`);
}

async function main() {
  await seedOwner();
  await seedPaymentMethods();
  await seedPlatformSettings();
  await seedCatalog();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
