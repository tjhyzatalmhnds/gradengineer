// ذاكرة مؤقتة بسيطة لحفظ بيانات الدفعات النشطة
const activeBatches = {};

exports.handler = async (event, context) => {
  // إعدادات الـ CORS الكاملة لتفادي حظر جدار حماية المتصفح
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400" // حفظ الإذن لمدة يوم لتسريع الطلبات
  };

  // التعامل مع طلبات الفحص المسبق (Preflight) بأمان
  if (event.httpMethod === "OPTIONS") {
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ message: "Successful preflight" }) 
    };
  }

  // منع أي طلب غير POST
  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      headers, 
      body: "Method Not Allowed" 
    };
  }

  try {
    if (!event.body) {
      throw new Error("طلب فارغ أو غير مكتمل");
    }

    const data = JSON.parse(event.body);
    
    // استدعاء المتغيرات السرية من إعدادات Netlify
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;             
    const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID; 
    const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

    // دالة إرسال الرسالة النصية للتليجرام
    const sendTelegramMessage = async (text, chatId) => {
      if (!TELEGRAM_BOT_TOKEN || !chatId) return;
      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: text })
        });
      } catch (err) {
        console.error("خطأ في إرسال نص تليجرام:", err);
      }
    };

    // دالة إرسال الصور للتليجرام (معالجة Base64)
    const sendPhoto = async (imgObj, caption, chatId) => {
      if (!imgObj || !imgObj.base64 || !TELEGRAM_BOT_TOKEN || !chatId) return;
      try {
        const buffer = Buffer.from(imgObj.base64, 'base64');
        const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
        let body = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
        body += `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
        body += `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${imgObj.filename || 'photo.png'}"\r\nContent-Type: ${imgObj.mimeType || 'image/png'}\r\n\r\n`;
        
        const payload = Buffer.concat([
          Buffer.from(body, 'utf8'),
          buffer,
          Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
        ]);

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: payload
        });
      } catch (e) {
        console.error("Error sending photo:", e);
      }
    };

    // ==========================================
    // 🟡 معالجة إنشاء دفعة جديدة (CREATE_BATCH)
    // ==========================================
    if (data.actionType === "CREATE_BATCH") {
      activeBatches[data.batchCode] = {
        batchCode: data.batchCode,
        uniName: data.uniName,
        collName: data.collName,
        deptName: data.deptName,
        batchModel: data.batchModel,
        batchFabric: data.batchFabric
      };

      const createMsg = `👑 **تأسيس دفعة جديدة - تجهيزات المهندس**\n\n` +
        `🔑 **كود الدفعة:** \`${data.batchCode}\`\n` +
        `👤 **الممثل:** ${data.repName} | 📞 **هاتف:** ${data.repPhone}\n` +
        `🏫 **الجامعة:** ${data.uniName} - ${data.collName}\n` +
        `📂 **القسم والدراسة:** ${data.deptName}\n` +
        `👥 **العدد المتوقع:** ${data.studentCount} طالب\n` +
        `🎓 **الموديل الموحد:** ${data.batchModel} | 🧵 **القماش:** ${data.batchFabric}`;

      await sendTelegramMessage(createMsg, TELEGRAM_BATCH_CHAT_ID);
      if (data.uniLogo) {
        await sendPhoto(data.uniLogo, `شعار جامعة الدفعة (${data.batchCode}) - ${data.uniName}`, TELEGRAM_BATCH_CHAT_ID);
      }
    }

    // ==========================================
    // 🟡 التحقق من كود الدفعة (VERIFY_BATCH)
    // ==========================================
    else if (data.actionType === "VERIFY_BATCH") {
      const batchData = activeBatches[data.batchCode] || {
        batchCode: data.batchCode,
        uniName: "جامعة مسجلة",
        collName: "كلية معتمدة",
        deptName: "قسم التخرج",
        batchModel: "ملكي",
        batchFabric: "كوبرا"
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, batchData: batchData })
      };
    }

    // ==========================================
    // 🟡 معالجة انضمام طالب لدفعة (JOIN_BATCH)
    // ==========================================
    else if (data.actionType === "JOIN_BATCH") {
      const joinMsg = `🤝 **انضمام طالب لدفعة (${data.batchCode})**\n\n` +
        `👤 **الطالب:** ${data.studentName} | 📞 **هاتف:** ${data.phone || '-'}\n` +
        `🏫 **الجهة:** ${data.uniName || '-'} - ${data.collName || '-'}\n` +
        `✍️ **تطريز الوشاح:** ${data.sashText || '-'}\n` +
        `📝 **ظهر الوشاح:** ${data.sashBackText || '-'}\n` +
        `🎩 **فوق القبعة:** ${data.capTopText || '-'} | جانب القبعة: ${data.capSideText || '-'}\n` +
        `📐 **القياسات:** طول: ${data.lengthGown || '-'} | ردن: ${data.lengthSleeve || '-'} | كتف: ${data.shoulder || '-'} | صدر: ${data.chest || '-'} | رأس: ${data.head || '-'}\n` +
        `➕ **الإضافات:** ${data.additions || 'لا يوجد'}`;

      await sendTelegramMessage(joinMsg, TELEGRAM_BATCH_CHAT_ID);

      if (data.images) {
        await sendPhoto(data.images.sashBackImg, `ظهر الوشاح (دفعة ${data.batchCode}) - ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID);
        await sendPhoto(data.images.capTopImg, `فوق القبعة (دفعة ${data.batchCode}) - ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID);
        await sendPhoto(data.images.capSideImg, `جانب القبعة (دفعة ${data.batchCode}) - ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID);
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

      await sendTelegramMessage(singleMsg, TELEGRAM_CHAT_ID);

      if (data.images) {
        await sendPhoto(data.images.sashFixedImg, `الطرف الثابت للوشاح - ${data.studentName}`, TELEGRAM_CHAT_ID);
        await sendPhoto(data.images.sashBackImg, `ظهر الوشاح - ${data.studentName}`, TELEGRAM_CHAT_ID);
        await sendPhoto(data.images.capTopImg, `فوق القبعة - ${data.studentName}`, TELEGRAM_CHAT_ID);
        await sendPhoto(data.images.capSideImg, `جانب القبعة - ${data.studentName}`, TELEGRAM_CHAT_ID);
      }
    }

    // ==========================================
    // 🟢 إرسال البيانات إلى Google Sheets
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
