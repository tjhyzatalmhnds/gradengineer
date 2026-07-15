const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: "Method Not Allowed" };
  }

  try {
    const data = JSON.parse(event.body);
    let { actionType } = data;

    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // قناة الفردي
    const TELEGRAM_BATCH_CHAT_ID = process.env.TELEGRAM_BATCH_CHAT_ID; // آيدي جروب الدفعات
    const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

    // دالة لإنشاء موضوع (Topic) جديد في جروب التليجرام وترجع بالـ Thread ID
    const createTelegramTopic = async (topicName) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_BATCH_CHAT_ID,
            name: topicName
          })
        });
        const resJson = await response.json();
        if (resJson.ok) {
          return resJson.result.message_thread_id; 
        } else {
          console.error("فشل إنشاء الموضوع بالتليجرام:", resJson.description);
        }
      } catch (err) {
        console.error("خطأ أثناء إنشاء الموضوع:", err);
      }
      return null;
    };

    // دالة مرنة لإرسال الصور للتليجرام وتدعم الإرسال لموضوع محدد (Thread)
    const sendBase64PhotoToTelegram = async (imageData, caption, targetChatId, threadId = null) => {
      if (!imageData || !imageData.base64) return;
      try {
        const boundary = "----NetlifyBoundary" + Math.random().toString(16).substring(2);
        const buffer = Buffer.from(imageData.base64, 'base64');

        const parts = [
          `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${targetChatId}\r\n`,
          `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`
        ];

        if (threadId) {
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="message_thread_id"\r\n\r\n${threadId}\r\n`);
        }

        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${imageData.filename || 'photo.jpg'}"\r\nContent-Type: ${imageData.mimeType || 'image/jpeg'}\r\n\r\n`);

        const payload = Buffer.concat([
          ...parts.map(p => Buffer.from(p)),
          buffer,
          Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: payload
        });
      } catch (err) {
        console.error("خطأ أثناء إرسال الصورة لتليجرام:", err);
      }
    };

    // دالة لإرسال رسالة نصية لموضوع محدد (Thread)
    const sendTelegramMessage = async (text, targetChatId, threadId = null) => {
      try {
        const payload = {
          chat_id: targetChatId,
          text: text,
          parse_mode: "Markdown"
        };
        if (threadId) {
          payload.message_thread_id = threadId;
        }
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.error("خطأ أثناء إرسال الرسالة النصية:", err);
      }
    };

    // دالة للاتصال بجوجل شيت
    const sendToGoogleSheet = async (payload) => {
      if (!GOOGLE_SCRIPT_URL) return null;
      try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
          method: "POST",
          headers: { 
            "Content-Type": "text/plain" 
          },
          body: JSON.stringify(payload)
        });
        return await response.json();
      } catch (err) {
        console.error("خطأ أثناء الاتصال بجوجل شيت:", err);
        return null;
      }
    };

    // كشف تلقائي للطلبات الفردية
    if (!actionType) {
      actionType = "SINGLE_ORDER";
      data.actionType = "SINGLE_ORDER";
    }

    // ==========================================
    // 1️⃣ تأسيس دفعة جديدة (CREATE_BATCH)
    // ==========================================
    if (actionType === "CREATE_BATCH") {
      const topicName = `دفعة_${data.batchCode}`;
      const threadId = await createTelegramTopic(topicName);

      const telegramText = `
👑 **تأسيس دفعة فخمة جديدة** 👑
──────────────────
🔢 **كود الدفعة:** \`${data.batchCode}\`
👤 **الممثل:** ${data.repName}
• الهاتف: ${data.repPhone}
🏫 **الجامعة:** ${data.uniName}
🎓 **الكلية:** ${data.collName}
📂 **القسم:** ${data.deptName}
👥 **العدد المتوقع:** ${data.studentCount} طالب
✨ **المواصفات الموحدة:** موديل ${data.batchModel} | قماش ${data.batchFabric}
      `;

      // إرسال تفاصيل التأسيس لموضوع التليجرام الجديد
      await sendTelegramMessage(telegramText, TELEGRAM_BATCH_CHAT_ID, threadId);

      // إرسال شعار الجامعة لتطريزه
      if (data.uniLogo) {
        await sendBase64PhotoToTelegram(data.uniLogo, `شعار جامعة الدفعة: ${data.uniName}`, TELEGRAM_BATCH_CHAT_ID, threadId);
      }

      // تمرير البيانات مع معرف التوبيك (Thread ID) لحفظها بالجوجل شيت
      const payloadToSheet = { ...data, telegramThreadId: threadId };
      await sendToGoogleSheet(payloadToSheet);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "تم تأسيس الدفعة وفتح الموضوع والتبويب" }) };
    }

    // ==========================================
    // 2️⃣ التحقق من كود الدفعة (VERIFY_BATCH)
    // ==========================================
    if (actionType === "VERIFY_BATCH") {
      const response = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${data.batchCode}`);
      const resData = await response.json();
      if (resData.success) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, batchData: resData.batchData }) };
      } else {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: resData.error }) };
      }
    }

    // ==========================================
    // 3️⃣ انضمام طالب لدفعة (JOIN_BATCH)
    // ==========================================
    if (actionType === "JOIN_BATCH") {
      const verifyResponse = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${data.batchCode}`);
      const verifyData = await verifyResponse.json();

      let threadId = null;
      if (verifyData.success && verifyData.batchData.telegramThreadId) {
        threadId = verifyData.batchData.telegramThreadId;
      }

      // تهيئة حقل الإضافات والزيادات تلقائياً لطالب الدفعة
      let additionsText = "لا توجد إضافات";
      if (data.additions) {
        additionsText = data.additions;
      }

      const telegramText = `
🤝 **انضمام طالب جديد للدفعة (كود: ${data.batchCode})** 🤝
──────────────────
👤 **اسم الطالب:** ${data.studentName}
🏫 **الكلية:** ${data.uniName} - ${data.collName}
📂 **القسم:** ${data.deptName}
✨ **المواصفات المعتمدة:** موديل ${data.batchModel} | قماش ${data.batchFabric}
✍️ **تطريز الوشاح:** ${data.sashText}
📝 **ظهر الوشاح:** ${data.sashBackText || "لم يكتب شيء"}
🎩 **تطريز فوق القبعة:** ${data.capTopText || "لم يكتب شيء"}
📐 **تطريز جانب القبعة:** ${data.capSideText || "لم يكتب شيء"}
➕ **الملاحظات/الإضافات:** ${additionsText}
      `;

      // إرسال بيانات الطالب مباشرة داخل توبيك الدفعة الخاص بالتليجرام
      await sendTelegramMessage(telegramText, TELEGRAM_BATCH_CHAT_ID, threadId);

      if (data.images) {
        await sendBase64PhotoToTelegram(data.images.sashBackImg, `ظهر الوشاح لطالب: ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID, threadId);
        await sendBase64PhotoToTelegram(data.images.capTopImg, `فوق القبعة لطالب: ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID, threadId);
        await sendBase64PhotoToTelegram(data.images.capSideImg, `جانب القبعة لطالب: ${data.studentName}`, TELEGRAM_BATCH_CHAT_ID, threadId);
      }

      // إرسال البيانات لجوجل شيت ليرفع الصور للدرايف ويخزن التفاصيل
      await sendToGoogleSheet({ ...data, additions: additionsText });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "تم تسجيلك بنجاح ونشر بياناتك في موضوع الدفعة" }) };
    }

    // ==========================================
    // 4️⃣ تقديم طلب فردي (SINGLE_ORDER)
    // ==========================================
    if (actionType === "SINGLE_ORDER") {
      data.batchModel = data.modelSelected || "فردي";
      data.batchFabric = data.fabricSelected || "غير محدد";
      data.studentPhone = data.phone || "بدون هاتف";
      
      let additionsParts = [];
      if (data.sashSelected && data.sashSelected !== "لا ينطبق") {
        additionsParts.push(`نوع الوشاح: ${data.sashSelected}`);
      }
      if (data.sashFixedText && data.sashFixedText !== "لم يكتب شيء") {
        additionsParts.push(`الطرف الثابت: ${data.sashFixedText}`);
      }
      if (data.additions) {
        additionsParts.push(`ملاحظات: ${data.additions}`);
      }
      data.additions = additionsParts.length > 0 ? additionsParts.join(" | ") : "لا توجد إضافات";

      const singleOrderText = `
✨ **طلب فردي جديد فخم** ✨
──────────────────
👤 **الاسم الثنائي:** ${data.studentName}
📞 **رقم الهاتف:** ${data.studentPhone}
🏫 **الجامعة والكلية:** ${data.uniName || "غير محدد"} - ${data.collName || "غير محدد"}
📂 **القسم والدراسة:** ${data.deptName || "غير محدد"}
📐 **القياسات:** طول: ${data.lengthGown || "-"} | ردن: ${data.lengthSleeve || "-"} | كتف: ${data.shoulder || "-"} | صدر: ${data.chest || "-"} | رأس: ${data.head || "-"}
✍️ **تطريز الوشاح:** ${data.sashText || "لا يوجد"}
📝 **ظهر الوشاح:** ${data.sashBackText || "لا يوجد"}
🎩 **فوق القبعة:** ${data.capTopText || "لا يوجد"}
📐 **جانب القبعة:** ${data.capSideText || "لا يوجد"}
➕ **الإضافات والملاحظات:** ${data.additions}
      `;

      await sendTelegramMessage(singleOrderText, TELEGRAM_CHAT_ID);

      if (data.images) {
        await sendBase64PhotoToTelegram(data.images.sashBackImg, `ظهر الوشاح للزبون: ${data.studentName}`, TELEGRAM_CHAT_ID);
        await sendBase64PhotoToTelegram(data.images.capTopImg, `فوق القبعة للزبون: ${data.studentName}`, TELEGRAM_CHAT_ID);
        await sendBase64PhotoToTelegram(data.images.capSideImg, `جانب القبعة للزبون: ${data.studentName}`, TELEGRAM_CHAT_ID);
      }

      await sendToGoogleSheet(data);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "تم تسجيل طلبك الفردي بنجاح مذهل!" }) };
    }

  } catch (error) {
    console.error("حدث خطأ في السيرفر:", error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
