-- Starter delivery templates for the store's common product shapes.
-- Data only, and idempotent: a template the owner already has under the
-- same name (or renamed and re-created) is never duplicated or overwritten.
INSERT INTO "delivery_templates" ("id", "name", "content", "message", "updatedAt")
SELECT gen_random_uuid()::text, v.name, v.content, v.message, CURRENT_TIMESTAMP
FROM (VALUES
  (
    'حساب مشترك (ممنوع تغيير البيانات)',
    E'الإيميل: \nالباسورد: ',
    E'✅ طلبك #{order_number} جاهز!\n\n📦 {product_name}\n⏳ المدة: {duration}\n🛡️ الضمان: {warranty}\n\n🔐 بيانات الدخول:\n{content}\n\n⚠️ الحساب ده مشترك:\n• ممنوع تغيير الإيميل أو الباسورد أو اسم البروفايل.\n• ماتسجّلش خروج من الأجهزة التانية وماتفعّلش التحقق بخطوتين.\n• أي تغيير بيلغي الضمان فوراً.\n\n{instructions}\n\nأي مشكلة كلّمنا: {support_contact}\nشكراً لثقتك في {store_name} 💙'
  ),
  (
    'حساب خاص بيك (غيّر الباسورد)',
    E'الإيميل: \nالباسورد: ',
    E'✅ طلبك #{order_number} جاهز!\n\n📦 {product_name}\n⏳ المدة: {duration}\n🛡️ الضمان: {warranty}\n\n🔐 بيانات حسابك:\n{content}\n\n🔒 الحساب ده خاص بيك:\n1️⃣ غيّر الباسورد فوراً.\n2️⃣ فعّل التحقق بخطوتين من إعدادات الأمان.\n3️⃣ احتفظ بالبيانات في مكان آمن.\n\n{instructions}\n\nأي مشكلة كلّمنا: {support_contact} 💙'
  ),
  (
    'دعوة على فريق / Workspace',
    E'لينك الدعوة: \nالإيميل المدعو: ',
    E'✅ طلبك #{order_number} جاهز!\n\n📦 {product_name}\n\n📩 بعتنالك دعوة:\n{content}\n\nخطوات التفعيل:\n1️⃣ افتح الإيميل اللي بعتّه لنا (بص في الـ Spam لو مش لاقيها).\n2️⃣ اضغط Accept / قبول الدعوة.\n3️⃣ ادخل بحسابك العادي وهتلاقي الاشتراك مفعّل.\n\n⏳ المدة: {duration}\n🛡️ الضمان: {warranty}\n\n{instructions}\n\nأي مشكلة كلّمنا: {support_contact} 💙'
  ),
  (
    'VPN',
    E'الإيميل: \nالباسورد: \nعدد الأجهزة المسموح: ',
    E'✅ طلبك #{order_number} جاهز!\n\n🛡️ {product_name}\n⏳ المدة: {duration}\n\n🔐 بيانات الدخول:\n{content}\n\n📲 نزّل التطبيق الرسمي، سجّل دخول بالبيانات دي واختار أقرب سيرفر.\n⚠️ ماتزوّدش عدد الأجهزة عن المسموح ولا تغيّر الباسورد — ده بيلغي الضمان.\n\n{instructions}\n\nأي مشكلة كلّمنا: {support_contact} 💙'
  )
) AS v(name, content, message)
WHERE NOT EXISTS (SELECT 1 FROM "delivery_templates" t WHERE t.name = v.name);
