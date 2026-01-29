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

  // 1. ตรวจสอบสิทธิ์ Super Admin
  const { data: superAdmin } = await supabase.from('super_admins').select('*').eq('line_user_id', userId).single();
  if (!superAdmin) return null;

  // ---------------------------------------------------------
  // ส่วนที่ 1: เมนูหลัก & เมนูสร้าง (Create Menu)
  // ---------------------------------------------------------
  if (userText.toLowerCase() === 'admin') {
    return sendMainMenu(event);
  }

  if (userText === 'เมนู Create') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🏠 เลือกสิ่งที่ต้องการทำ:',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: 'สร้างสาขา', text: 'สร้างสาขา' } },
          { type: 'action', action: { type: 'message', label: 'เพิ่ม Owner', text: 'เพิ่ม Owner' } },
          { type: 'action', action: { type: 'message', label: '🔗 จับคู่ (Pairing)', text: 'เริ่มการจับคู่' } }
        ]
      }
    });
  }

  // ---------------------------------------------------------
  // ส่วนที่ 2: ขั้นตอนการจับคู่ (Pairing Flow) ปรับปรุงใหม่
  // ---------------------------------------------------------

  // ขั้นตอนที่ 1: เลือก Owner (จิ้มจาก List)
  if (userText === 'เริ่มการจับคู่') {
    return showOwnerSelector(event);
  }

  // ขั้นตอนที่ 2: รับค่า Owner แล้วเลือกสาขา
  if (userText.startsWith('เลือก Owner ID:')) {
    const ownerId = userText.split('ID:')[1];
    return showBranchSelector(event, ownerId);
  }

  // ขั้นตอนที่ 3: ยืนยันการจับคู่ (บันทึกลง owner_line_id)
  if (userText.startsWith('ยืนยันจับคู่ ')) {
    const params = userText.replace('ยืนยันจับคู่ ', '').split(' ');
    const ownerId = params[0].split(':')[1];
    const branchId = params[1].split(':')[1];
    return handleFinalPairing(event, ownerId, branchId);
  }

  // ---------------------------------------------------------
  // ส่วนที่ 3: ระบบจัดการและสรุปยอด
  // ---------------------------------------------------------
  if (userText === 'เมนู Manage') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '⚙️ เลือกสิ่งที่ต้องการจัดการ:',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: 'จัดการสาขา', text: 'Manage Branches' } },
          { type: 'action', action: { type: 'message', label: 'จัดการ Owner', text: 'Manage Owners' } },
          { type: 'action', action: { type: 'message', label: '📊 ยอดเมื่อวาน', text: 'สรุปยอดเมื่อวาน' } }
        ]
      }
    });
  }

  // คำสั่งสรุปยอดเมื่อวาน
  if (userText === 'สรุปยอดเมื่อวาน') return handleDailySummary(event);
  
  // คำสั่งสร้างสาขา (Branch [ชื่อ])
  if (userText.startsWith('Branch ')) return handleCreateBranch(event, userText.replace('Branch ', '').trim());

  // คำสั่งเพิ่ม Owner (U[ID] [ชื่อ])
  if (userText.startsWith('U') && userText.includes(' ')) {
    const [targetId, displayName] = userText.split(' ');
    if (targetId.length >= 10) return handleAddOwner(event, targetId, displayName);
  }
}

// ---------------------------------------------------------
// ฟังก์ชัน UI & Database
// ---------------------------------------------------------

async function showOwnerSelector(event) {
  const { data: owners } = await supabase.from('system_admins').select('*');
  if (!owners?.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มี Owner ในระบบค่ะ' });

  const bubbles = owners.map(o => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: o.display_name, weight: "bold", size: "sm", wrap: true },
        { type: "button", style: "primary", color: "#00b900", height: "sm",
          action: { type: "message", label: "เลือกคนนี้", text: `เลือก Owner ID:${o.line_user_id}` }
        }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือก Owner", contents: { type: "carousel", contents: bubbles } });
}

async function showBranchSelector(event, ownerId) {
  const { data: branches } = await supabase.from('branches').select('*');
  const bubbles = branches.map(b => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: b.branch_name, weight: "bold", size: "sm" },
        { type: "button", style: "secondary", height: "sm",
          action: { type: "message", label: "เลือกสาขานี้", text: `ยืนยันจับคู่ O:${ownerId} B:${b.id}` }
        }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: { type: "carousel", contents: bubbles } });
}

async function handleFinalPairing(event, ownerId, branchId) {
  // บันทึกลงฟิลด์ owner_line_id ตามที่เปรมต้องการ
  const { error } = await supabase.from('branch_owners').insert([{ branch_id: branchId, owner_line_id: ownerId }]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ ผิดพลาด: ${error.message}` : `✅ จับคู่ Owner กับสาขาเรียบร้อยแล้วค่ะ!`
  });
}

// ฟังก์ชันเพิ่ม Owner (บันทึกลง system_admins)
async function handleAddOwner(event, targetId, displayName) {
  const { error } = await supabase.from('system_admins').insert([{ line_user_id: targetId, display_name: displayName }]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ Error: ${error.message}` : `✅ เพิ่ม Owner: ${displayName} เรียบร้อย!`
  });
}

// (ฟังก์ชันอื่นๆ เช่น sendMainMenu, handleCreateBranch, handleDailySummary ใส่ต่อท้ายได้เลยค่ะ)

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
