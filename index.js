const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const app = express();

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;

  const userId = event.source.userId;
  const userText = event.message.text.trim();

  // 1. เช็คสิทธิ์ Super Admin ก่อนเลย
  const { data: superAdmin } = await supabase
    .from('super_admins')
    .select('*')
    .eq('line_user_id', userId)
    .single();

  if (!superAdmin) return null; // ถ้าไม่ใช่ Super Admin ไม่ต้องตอบโต้

  // 2. Logic เมื่อพิมพ์คำว่า "admin"
  if (userText.toLowerCase() === 'admin') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'สวัสดีค่ะ Super Admin! เลือกเมนูที่ต้องการจัดการได้เลยค่ะ',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: 'Create', text: 'เมนู Create' } },
          { type: 'action', action: { type: 'message', label: 'Manage', text: 'เมนู Manage' } },
          { type: 'action', action: { type: 'message', label: 'Super Admin', text: 'เมนู Super Admin' } }
        ]
      }
    });
  }

  // 3. Logic การเพิ่ม Admin (Add Admin: Uxxxxx ชื่อเรียก)
  if (userText.startsWith('U') && userText.includes(' ')) {
    const [targetId, displayName] = userText.split(' ');
    if (targetId.length >= 8) {
      return handleAddAdmin(event, targetId, displayName);
    }
  }
}

async function handleAddAdmin(event, targetId, displayName) {
  // เช็คว่ามี Admin นี้หรือยัง
  const { data: existing } = await supabase
    .from('system_admins')
    .select('display_name')
    .eq('line_user_id', targetId)
    .single();

  if (existing) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `❌ มี ID นี้ในระบบแล้วในชื่อ "${existing.display_name}"`
    });
  }

  // บันทึกลงตาราง
  const { error } = await supabase
    .from('system_admins')
    .insert([{ line_user_id: targetId, display_name: displayName }]);

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? 'เกิดข้อผิดพลาดในการบันทึก' : `✅ เพิ่ม Admin: ${displayName} เรียบร้อยแล้วค่ะ`
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Admin Server is running on port ${PORT}`));
