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

  // 1. ตรวจสอบสิทธิ์สถาปัตยกรรม 2 ชั้น (Super Admin/Owner)
  const [isSuper, isOwner] = await Promise.all([
    supabase.from('super_admins').select('*').eq('line_user_id', userId).single(),
    supabase.from('system_admins').select('*').eq('line_user_id', userId).single()
  ]);

  if (!isSuper.data && !isOwner.data) return null;

  // ---------------------------------------------------------
  // ส่วนที่ 1: เมนูหลัก & การจัดการ Super Admin
  // ---------------------------------------------------------
  if (userText.toLowerCase() === 'admin') {
    return sendMainMenu(event, isSuper.data !== null);
  }

  if (userText === 'เมนู Create') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🏠 เลือกสิ่งที่ต้องการทำ:',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: 'สร้างสาขา', text: 'สร้างสาขา' } },
          { type: 'action', action: { type: 'message', label: 'เพิ่ม Owner', text: 'เพิ่ม Owner' } },
          { type: 'action', action: { type: 'message', label: '🔗 เริ่มการจับคู่', text: 'เริ่มการจับคู่' } }
        ]
      }
    });
  }

  // ---------------------------------------------------------
  // ส่วนที่ 2: ขั้นตอนการจับคู่ (Flow จิ้มเลือก)
  // ---------------------------------------------------------
  
  // ขั้นที่ 1: เลือก Owner (จิ้มจาก List)
  if (userText === 'เริ่มการจับคู่') return showOwnerSelector(event);

  // ขั้นที่ 2: รับค่า Owner แล้วเลือกสาขา (ส่ง ID และ ชื่อต่อไป)
  if (userText.startsWith('เลือก Owner:')) {
    const parts = userText.split('|');
    const ownerName = parts[0].replace('เลือก Owner:', '').trim();
    const ownerId = parts[1].trim();
    return showBranchSelector(event, ownerId, ownerName);
  }

  // ขั้นที่ 3: ยืนยันการจับคู่ (แสดงข้อความยืนยันเป็นชื่อคนและชื่อสาขา)
  if (userText.startsWith('ยืนยันจับคู่ ')) {
    const params = userText.replace('ยืนยันจับคู่ ', '').split(' ');
    const ownerId = params[0].split(':')[1];
    const branchId = params[1].split(':')[1];
    const ownerName = params[2].split(':')[1];
    const branchName = params[3]?.split(':')[1] || 'สาขานี้';
    return handleFinalPairing(event, ownerId, branchId, ownerName, branchName);
  }

  // ---------------------------------------------------------
  // ส่วนที่ 3: ระบบจัดการข้อมูล (Add/Create)
  // ---------------------------------------------------------

  // ระบบเพิ่ม Owner: U[ID] [ชื่อเรียก]
  if (userText.startsWith('U') && userText.includes(' ')) {
    const [targetId, name] = userText.split(' ');
    if (targetId.length >= 10) return handleAddOwner(event, targetId, name);
  }

  // ระบบสร้างสาขา: Branch [ชื่อ]
  if (userText.startsWith('Branch ')) return handleCreateBranch(event, userText.replace('Branch ', '').trim());

  // สรุปยอดเมื่อวาน
  if (userText === 'สรุปยอดเมื่อวาน') return handleDailySummary(event);
}

// ---------------------------------------------------------
// ฟังก์ชันจัดการ UI และฐานข้อมูล
// ---------------------------------------------------------

// UI: เลือก Owner (ชื่อและปุ่มอยู่บรรทัดเดียวกัน)
async function showOwnerSelector(event) {
  const { data: owners } = await supabase.from('system_admins').select('*');
  const { data: supers } = await supabase.from('super_admins').select('*');
  const all = [...(owners || []), ...(supers || [])];

  if (!all.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มีรายชื่อในระบบค่ะ' });

  const bubbles = all.map(o => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        {
          type: "box", layout: "horizontal", contents: [
            { type: "text", text: o.owner_name || o.display_name, weight: "bold", size: "sm", gravity: "center", flex: 3 },
            { type: "button", style: "primary", color: "#00b900", height: "sm", flex: 2,
              action: { type: "message", label: "เลือก", text: `เลือก Owner: ${o.owner_name || o.display_name} | ${o.line_user_id}` }
            }
          ]
        }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือก Owner", contents: { type: "carousel", contents: bubbles } });
}

// UI: เลือกสาขา
async function showBranchSelector(event, ownerId, ownerName) {
  const { data: branches } = await supabase.from('branches').select('*');
  const bubbles = branches.map(b => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        {
          type: "box", layout: "horizontal", contents: [
            { type: "text", text: b.branch_name, weight: "bold", size: "sm", gravity: "center", flex: 3 },
            { type: "button", style: "secondary", height: "sm", flex: 2,
              action: { type: "message", label: "เลือก", text: `ยืนยันจับคู่ O:${ownerId} B:${b.id} N:${ownerName} BN:${b.branch_name}` }
            }
          ]
        }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: { type: "carousel", contents: bubbles } });
}

// DB: บันทึกการจับคู่
async function handleFinalPairing(event, ownerId, branchId, ownerName, branchName) {
  const { error } = await supabase.from('branch_owners').insert([
    { branch_id: branchId, owner_line_id: ownerId, owner_name: ownerName }
  ]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ Error: ${error.message}` : `✅ จับคู่เจ้าของ "${ownerName}" กับสาขา "${branchName}" สำเร็จแล้วค่ะ!`
  });
}

// DB: เพิ่ม Owner ใหม่
async function handleAddOwner(event, targetId, name) {
  const { error } = await supabase.from('system_admins').insert([{ line_user_id: targetId, owner_name: name }]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ Error: ${error.message}` : `✅ เพิ่ม owner ${name} เรียบร้อยแล้วค่ะ`
  });
}

// อื่นๆ
function sendMainMenu(event, isSuper) {
  const items = [
    { type: 'action', action: { type: 'message', label: '⚙️ จัดการ', text: 'เมนู Manage' } },
    { type: 'action', action: { type: 'message', label: '📊 ยอดเมื่อวาน', text: 'สรุปยอดเมื่อวาน' } }
  ];
  if (isSuper) {
    items.unshift({ type: 'action', action: { type: 'message', label: '➕ สร้าง', text: 'เมนู Create' } });
  }
  return client.replyMessage(event.replyToken, { type: 'text', text: 'เลือกหมวดหมู่ที่ต้องการจัดการ:', quickReply: { items } });
}

async function handleCreateBranch(event, branchName) {
  const { error } = await supabase.from('branches').insert([{ branch_name: branchName }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ สร้างสาขา "${branchName}" เรียบร้อย!` });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
