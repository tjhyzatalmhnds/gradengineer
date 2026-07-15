export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // استقبال الطلبات من الفورم
    if (url.pathname === "/submit-order") {
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Content-Type": "application/json"
      };

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 200, headers });
      }

      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers });
      }

      try {
        // 🔒 استدعاء المتغيرات السرية بأمان من السيرفر مباشرة
        const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
        const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID; 
        const TELEGRAM_BATCH_CHAT_ID = env.TELEGRAM_BATCH_CHAT_ID; 
        const GOOGLE_SCRIPT_URL = env.GOOGLE_SCRIPT_URL;

        const data = await request.json();
        let { actionType } = data;

        // 1️⃣ دالة لإنشاء موضوع بالتليجرام
        const createTelegramTopic = async (topicName) => {
          try {
            const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: TELEGRAM_BATCH_CHAT_ID, name: topicName })
            });
            const resJson = await response.json();
            if (resJson.ok) return resJson.result.message_thread_id;
          } catch (err) { console.error("خطأ تليجرام:", err); }
          return null;
        };

        // 2️⃣ دالة إرسال الصور
        const sendBase64PhotoToTelegram = async (imageData, caption, targetChatId, threadId = null) => {
          if (!imageData || !imageData.base64) return;
          try {
            const formData = new FormData();
            formData.append("chat_id", targetChatId);
            formData.append("caption", caption);
            if (threadId) formData.append("message_thread_id", threadId);

            const binaryString = atob(imageData.base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: imageData.mimeType || 'image/jpeg' });
            formData.append("photo", blob, imageData.filename || 'photo.jpg');

            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
          } catch (err) { console.error("خطأ إرسال الصورة:", err); }
        };

        // 3️⃣ دالة إرسال الرسائل النصية
        const sendTelegramMessage = async (text, targetChatId, threadId = null) => {
          try {
            const payload = { chat_id: targetChatId, text, parse_mode: "Markdown" };
            if (threadId) payload.message_thread_id = threadId;
            await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
          } catch (err) { console.error("خطأ إرسال الرسالة:", err); }
        };

        // 4️⃣ دالة جوجل شيت
        const sendToGoogleSheet = async (payload) => {
          if (!GOOGLE_SCRIPT_URL) return null;
          try {
            await fetch(GOOGLE_SCRIPT_URL, {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: JSON.stringify(payload)
            });
          } catch (err) { console.error("خطأ جوجل شيت:", err); }
        };

        if (!actionType) actionType = "SINGLE_ORDER";

        // تأسيس دفعة
        if (actionType === "CREATE_BATCH") {
          const topicName = `دفعة_${data.batchCode}`;
          const threadId = await createTelegramTopic(topicName);
          const text = `👑 **تأسيس دفعة جديدة** 👑\n🔢 كود الدفعة: \`${data.batchCode}\`\n👤 الممثل: ${data.repName}\n🏫 الجامعة: ${data.uniName}`;
          await sendTelegramMessage(text, TELEGRAM_BATCH_CHAT_ID, threadId);
          if (data.uniLogo) await sendBase64PhotoToTelegram(data.uniLogo, `شعار الجامعة`, TELEGRAM_BATCH_CHAT_ID, threadId);
          await sendToGoogleSheet({ ...data, telegramThreadId: threadId });
          return new Response(JSON.stringify({ success: true }), { status: 200, headers });
        }

        // انضمام لدفعة
        if (actionType === "JOIN_BATCH") {
          const verify = await fetch(`${GOOGLE_SCRIPT_URL}?actionType=VERIFY_BATCH&batchCode=${data.batchCode}`);
          const vData = await verify.json();
          const threadId = vData.success ? vData.batchData.telegramThreadId : null;

          const text = `🤝 **انضمام طالب جديد للدفعة (${data.batchCode})** 🤝\n👤 الطالب: ${data.studentName}\n✍️ الوشاح: ${data.sashText}`;
          await sendTelegramMessage(text, TELEGRAM_BATCH_CHAT_ID, threadId);
          if (data.images) {
            await sendBase64PhotoToTelegram(data.images.sashBackImg, `الظهر`, TELEGRAM_BATCH_CHAT_ID, threadId);
            await sendBase64PhotoToTelegram(data.images.capTopImg, `القبعة`, TELEGRAM_BATCH_CHAT_ID, threadId);
          }
          await sendToGoogleSheet(data);
          return new Response(JSON.stringify({ success: true }), { status: 200, headers });
        }

        // طلب فردي
        if (actionType === "SINGLE_ORDER") {
          const text = `✨ **طلب فردي جديد** ✨\n👤 الاسم: ${data.studentName}\n📞 الهاتف: ${data.phone}\n📐 القياسات: طول ${data.lengthGown} | ردن ${data.lengthSleeve}`;
          await sendTelegramMessage(text, TELEGRAM_CHAT_ID);
          if (data.images) {
            await sendBase64PhotoToTelegram(data.images.sashBackImg, `الظهر`, TELEGRAM_CHAT_ID);
            await sendBase64PhotoToTelegram(data.images.capTopImg, `القبعة`, TELEGRAM_CHAT_ID);
          }
          await sendToGoogleSheet(data);
          return new Response(JSON.stringify({ success: true }), { status: 200, headers });
        }

      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers });
      }
    }

    // عرض صفحات الـ HTML الثابتة تلقائياً
    return env.ASSETS.fetch(request);
  }
}
