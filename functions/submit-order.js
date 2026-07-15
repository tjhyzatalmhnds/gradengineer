// ذاكرة مؤقتة بسيطة لحفظ الدفعات النشطة مؤقتاً خلال فترة تشغيل السيرفر
const activeBatches = {};

export async function onRequest(context) {
  const { request, env } = context;

  // إعدادات الـ CORS الكاملة لتفادي حظر جدار حماية المتصفح
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json"
  };

  // 1. التعامل مع طلبات الفحص المسبق (Preflight) بأمان
  if (request.method === "OPTIONS") {
    return new Response(JSON.stringify({ message: "Successful preflight" }), { status: 200, headers });
  }

  // 2. منع أي طلب غير POST
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method Not Allowed" }), { status: 405, headers });
  }

  try {
    const bodyText = await request.text();
    if (!bodyText) {
      throw new Error("طلب فارغ أو غير مكتمل");
    }

    const data = JSON.parse(bodyText);
    
    // استدعاء المتغيرات السرية المعرفة في لوحة تحكم Cloudflare Pages
    const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID;             
    const TELEGRAM_BATCH_CHAT_ID = env.TELEGRAM_BATCH_CHAT_ID; 
    const GOOGLE_SCRIPT_URL = env.GOOGLE_SCRIPT_URL;

    // =========================================================
    // 🛠️ دوال المساعدة الخاصة بالاتصال بـ API التليجرام
    // =========================================================

    // دالة لإنشاء موضوع (Topic) جديد في المجموعة المشتركة
    const createTelegramTopic = async (topicName, chatId) => {
      if (!TELEGRAM_BOT_TOKEN || !chatId) return null;
      try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            name: topicName
          })
        });
        const result = await response.json();
        if (result.ok) {
          // إرجاع الـ thread_id الخاص بالتوبيك الجديد المفتوح
          return result.result.message_thread_id; 
        } else {
          console.error("فشل إنشاء التوبيك في تليجرام:", result.description);
          return null;
        }
      } catch (err) {
        console.error("خطأ أثناء إنشاء التوبيك:", err);
        return null;
      }
    };

    // دالة إرسال الرسالة النصية للتليجرام (تدعم الـ Thread ID للتوجيه داخل التوبيك)
    const sendTelegramMessage = async (text, chatId, threadId = null) => {
      if (!TELEGRAM_BOT_TOKEN || !chatId) {
        console.warn("بيانات تليجرام غير مكتملة (البوت توكن أو الشات آيدي ناقص)");
        return;
      }
      try {
        const payload = { chat_id: chatId, text: text, parse_mode: "Markdown" };
        if (threadId) {
          payload.message_thread_id = threadId; // توجيه الرسالة للتوبيك المخصص
        }

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.error("خطأ في إرسال نص تليجرام:", err);
      }
    };

    // دالة إرسال الصور متوافقة مع Cloudflare Workers (تدعم الـ Thread ID وتحويل Base64)
    const sendPhoto = async (imgObj, caption, chatId, threadId = null) => {
      if (!imgObj || !imgObj.base64 || !TELEGRAM_BOT_TOKEN || !chatId) return;
      try {
        // تحويل Base64 إلى مصفوفة بايت ثنائية متوافقة مع محرك V8 الخاص بكلاود فلير
        const binaryString = atob(imgObj.base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const formData = new FormData();
        formData.append("chat_id", chatId);
        formData.append("caption", caption);
        if (threadId) {
          formData.append("message_thread_id", threadId); // توجيه الصورة داخل التوبيك المحدد
        }
        
        const blob = new Blob([bytes], { type: imgObj.mimeType || 'image/png' });
        formData.append("photo", blob, imgObj.filename || 'photo.png');

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          body: formData
        });
      } catch (e) {
        console.error("Error sending photo:", e);
      }
    };

    // ==========================================
    // 🟡 معالجة إنشاء دفعة جديدة (CREATE_BATCH)
    // ==========================================
    if (data.actionType === "CREATE_BATCH") {
      
      // 1. إنشاء توبيك (Topic) مخصص باسم هذه الدفعة الجديدة داخل تليجرام تلقائياً
      const topicName = `دفعة: ${data.batchCode} - ${data.uniName}`;
      const createdThreadId = await createTelegramTopic(topicName, TELEGRAM_BATCH_CHAT_ID);

      // 2. تخزين معلومات الدفعة والـ Thread ID المرتبط بها محلياً لربط الطلاب المنضمين لاحقاً
      activeBatches[data.batchCode] = {
        batchCode: data.batchCode,
        uniName: data.uniName,
        collName: data.collName,
        deptName: data.deptName,
        batchModel: data.batchModel,
        batchFabric: data.batchFabric,
        threadId: createdThreadId // ربط كود الدفعة بـ Topic ID التليجرام
      };

      const createMsg = `👑 **تأسيس دفعة جديدة - تجهيزات المهندس**\n\n` +
        `🔑 **كود الدفعة:** \`${data.batchCode}\`\n` +
        `👤 **الممثل:** ${data.repName} | 📞 **هاتف:** ${data.repPhone}\n` +
        `🏫 **الجامعة:** ${data.uniName} - ${data.collName}\n` +
        `📂 **القسم والدراسة:** ${data.deptName}\n` +
        `👥 **العدد المتوقع:** ${data.studentCount} طالب\n` +
        `🎓 **الموديل الموحد:** ${data.batchModel} | 🧵 **القماش:** ${data.batchFabric}`;

      // 3. إرسال بيانات التأسيس والصورة داخل التوبيك المنشأ حديثاً
      await sendTelegramMessage(createMsg, TELEGRAM_BATCH_CHAT_ID, createdThreadId);
      
      if (data.uniLogo && data.uniLogo.base64) {
        await sendPhoto(data.uniLogo, `شعار جامعة الدفعة (${data.batchCode}) - ${data.uniName}`, TELEGRAM_BATCH_CHAT_ID, createdThreadId);
      }
    }

    // ==========================================
    // 🟡 التحقق من كود الدفعة (VERIFY_BATCH)
    // ==========================================
    else if (data.actionType === "VERIFY_BATCH") {
      const localBatch = activeBatches[data.batchCode];

      const batchData = {
        batchCode: data.batchCode,
        uniName: localBatch ? localBatch.uniName : "جامعة مسجلة للدفعة " + data.batchCode,
        collName: localBatch ? localBatch.collName : "الكلية المعتمدة",
        deptName: localBatch ? localBatch.deptName : "قسم التخرج الموحد",
        batchModel: localBatch ? localBatch.batchModel : "ملكي",
        batchFabric: localBatch ? localBatch.batchFabric : "كوبرا"
      };

      return new Response(JSON.stringify({ success: true, batchData: batchData }), { status: 200, headers });
    }

    // ==========================================
    // 🟡 معالجة انضمام طالب لدفعة (JOIN_BATCH)
    // ==========================================
    else if (data.actionType === "JOIN_BATCH") {
      // محاولة سحب الـ Thread ID الخاص بالدفعة لتوجيه طلب الطالب داخله
      const localBatch = activeBatches[data.batchCode];
      const targetThreadId = localBatch ? localBatch.threadId : null;

      const joinMsg = `🤝 **انضمام طالب لدفعة (${data.batchCode})**\n\n` +
        `👤 **الطالب:** ${data.studentName} | 📞 **هاتف:** ${data.phone || '-'}\n` +
        `🏫 **الجهة:** ${data.uniName || '-'} - ${data.collName || '-'}\n` +
        `✍️ **تطريز الوشاح:** ${data.sashText || '-'}\n` +
        `📝 **ظهر الوشاح:** ${data.sashBackText || '-'}\n` +
        `🎩 **فوق القبعة:** ${data.capTopText || '-'} | جانب القبعة: ${data.capSideText || '-'}\n` +
        `📐 **القياسات:** طول: ${data.lengthGown || '-'} | ردن: ${data.lengthSleeve || '-'} | كتف: ${data.shoulder || '-'} | صدر: ${data.chest || '-'} | رأس: ${data.head || '-'}\n` +
        `➕ **الإضافات:** ${data.additions || 'لا يوجد'}`;

      // إرسال تفاصيل الطالب وصور قياساته وتصميمه داخل التوبيك المخصص لهذه الدفعة
      await sendTelegramMessage(joinMsg, TELEGRAM_BATCH_CHAT_ID, targetThreadId);

      if (data.images) {
        if (data.images.sashBackImg) await sendPhoto(data.images.sashBackImg, `ظهر الوشاح (دفعة ${data.batchCode}) - ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID, targetThreadId);
        if (data.images.capTopImg) await sendPhoto(data.images.capTopImg, `فوق القبعة (دفعة ${data.batchCode}) - ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID, targetThreadId);
        if (data.images.capSideImg) await sendPhoto(data.images.capSideImg, `جانب القبعة (دفعة ${data.batchCode}) - ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID, targetThreadId);
      }
    }

    // ==========================================
    // 🟡 معالجة الطلب الفردي (SINGLE_ORDER)
    // ==========================================
    else {
      const singleMsg = `📋 **طلب فردي جديد - تجهيزات المهندس**\n\n` +
        `👤 **الاسم:** ${data.studentName}\n` +
        `📞 **الهاتف:** ${data.phone}\n` +
        `🎓 **الموديل والقماش:** ${data.batchModel || '-'} (${data.batchFabric || '-'}) | وشاح: ${data.sashSelected || '-'}\n` +
        `✍️ **تطريز الوشاح:** ${data.sashText || '-'}\n` +
        `📍 **الطرف الثابت:** ${data.sashFixedText || '-'}\n` +
        `📝 **ظهر الوشاح:** ${data.sashBackText || '-'}\n` +
        `🎩 **فوق القبعة:** ${data.capTopText || '-'} | جانب القبعة: ${data.capSideText || '-'}\n` +
        `📐 **القياسات:** طول: ${data.lengthGown || '-'} | ردن: ${data.lengthSleeve || '-'} | كتف: ${data.shoulder || '-'} | صدر: ${data.chest || '-'} | رأس: ${data.head || '-'}\n` +
        `➕ **الإضافات:** ${data.additions || 'لا يوجد'}`;

      // الطلبات الفردية ترسل إلى الشات الأساسي (دون الحاجة لتوبيك)
      await sendTelegramMessage(singleMsg, TELEGRAM_CHAT_ID);

      if (data.images) {
        if (data.images.sashFixedImg) await sendPhoto(data.images.sashFixedImg, `الطرف الثابت للوشاح - ${data.studentName}`, TELEGRAM_CHAT_ID);
        if (data.images.sashBackImg) await sendPhoto(data.images.sashBackImg, `ظهر الوشاح - ${data.studentName}`, TELEGRAM_CHAT_ID);
        if (data.images.capTopImg) await sendPhoto(data.images.capTopImg, `فوق القبعة - ${data.studentName}`, TELEGRAM_CHAT_ID);
        if (data.images.capSideImg) await sendPhoto(data.images.capSideImg, `جانب القبعة - ${data.studentName}`, TELEGRAM_CHAT_ID);
      }
    }

    // ==========================================
    // 🟢 إرسال البيانات إلى Google Sheets (Apps Script)
    // ==========================================
    if (GOOGLE_SCRIPT_URL) {
      try {
        await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
      } catch (e) {
        console.error("Google Sheets Error:", e);
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });

  } catch (error) {
    console.error("خطأ معالجة الطلب:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
  }
}
