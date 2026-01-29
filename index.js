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

  // 1. ตรวจสอบสิทธิ์ (Check Permissions)
  // ดึงข้อมูลจากทั้ง 2 ตารางพร้อมกัน
  const [isSuper, isOwner] = await Promise.all([
    supabase.from('super_admins').select('*').eq('line_user_id', userId).single(),
    supabase.from('system_admins').select('*').eq('line_user_id', userId).single()
  ]);

  const hasSuperPrivilege = isSuper.data !== null;
  const hasOwnerPrivilege = isOwner.data !== null;

  // ถ้าไม่ใช่ทั้ง Super และ Owner ไม่ต้องตอบสนอง
  if (!hasSuperPrivilege && !hasOwnerPrivilege) return null;

  // ---------------------------------------------------------
  // ส่วนที่ 1: เมนูหลัก (ปรับตามสิทธิ์)
  // ---------------------------------------------------------
  if (userText.toLowerCase() === 'admin') {
    const quickReplyItems = [];
    
    // ถ้าเป็น Super Admin ให้เห็นเมนู "สร้าง" และ "Super Admin"
    if (hasSuperPrivilege) {
      quickReplyItems.push({ type: 'action', action: { type: 'message', label: '➕ สร้าง', text: 'เมนู Create' } });
      quickReplyItems.push({ type: 'action', action: { type: 'message', label: '👑 Super Admin', text: 'เมนู Super Admin' } });
    }
    
    // ทุกคน (รวม Owner) เห็นเมนู "จัดการ" และ "ยอดขาย"
    quickReplyItems.push({ type: 'action', action: { type: 'message', label: '⚙️ จัดการ', text: 'เมนู Manage' } });
    quickReplyItems.push({ type: 'action', action: { type: 'message', label: '📊 ยอดเมื่อวาน', text: 'สรุปยอดเมื่อวาน' } });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `สวัสดีค่ะคุณ ${hasSuperPrivilege ? 'Super Admin' : 'Owner'}! เลือกหมวดหมู่ที่ต้องการ:`,
      quickReply: { items: quickReplyItems }
    });
  }

  // ---------------------------------------------------------
  // ส่วนที่ 2: ขั้นตอนการจับคู่ (Pairing) - เฉพาะ Super Admin
  // ---------------------------------------------------------
  if (hasSuperPrivilege) {
    if (userText === 'เมนู Create') {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '🏠 เลือกการจัดการพื้นฐาน:',
        quickReply: {
          items: [
            { type: 'action', action: { type: 'message', label: 'สร้างสาขา', text: 'สร้างสาขา' } },
            { type: 'action', action: { type: 'message', label: 'เพิ่ม Owner', text: 'เพิ่ม Owner' } },
            { type: 'action', action: { type: 'message', label: '🔗 เริ่มการจับคู่', text: 'เริ่มการจับคู่' } }
          ]
        }
      });
    }

    if (userText === 'เริ่มการจับคู่') return showOwnerSelector(event);
    if (userText.startsWith('เลือก Owner:')) {
      const ownerId = userText.split('|')[1].trim();
      return showBranchSelector(event, ownerId);
    }
    if (userText.startsWith('ยืนยันจับคู่ ')) {
      const params = userText.replace('ยืนยันจับคู่ ', '').split(' ');
      const ownerId = params[0].split(':')[1];
      const branchId = params[1].split(':')[1];
      return handleFinalPairing(event, ownerId, branchId);
    }
    
    // เพิ่ม Owner ใหม่
    if (userText.startsWith('U') && userText.includes(' ')) {
      const [targetId, displayName] = userText.split(' ');
      if (targetId.length >= 10) return handleAddOwner(event, targetId, displayName);
    }
  }

  // ---------------------------------------------------------
  // ส่วนที่ 3: ระบบจัดการยอดขาย (ทุกคนที่มีสิทธิ์เห็นได้)
  // ---------------------------------------------------------
  if (userText === 'สรุปยอดเมื่อวาน') return handleDailySummary(event, userId, hasSuperPrivilege);

  // คำสั่งจัดการสิทธิ์ Super Admin (เฉพาะ Super Admin เดิมเป็นคนเพิ่ม)
  if (hasSuperPrivilege && userText === 'เมนู Super Admin') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '👑 การจัดการสิทธิ์สูงสุด:\n1. เพิ่มสิทธิ์ Super: พิมพ์ "ADD_SUPER [ID] [ชื่อ]"\n2. ดูรายชื่อ Super: พิมพ์ "LIST_SUPER"'
    });
  }
}

// ---------------------------------------------------------
// ฟังก์ชันเสริม (Helper Functions)
// ---------------------------------------------------------

async function handleAddOwner(event, targetId, displayName) {
  const { error } = await supabase.from('system_admins').insert([{ line_user_id: targetId, display_name: displayName }]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ Error: ${error.message}` : `✅ เพิ่ม owner ${displayName} เรียบร้อยแล้วค่ะ`
  });
}

// ฟังก์ชันสรุปยอดขาย (ปรับให้ดูได้เฉพาะตู้ที่ตัวเองคุม ถ้าไม่ใช่ Super)
async function handleDailySummary(event, userId, isSuper) {
  // ... (Logic ดึงข้อมูล machine_hourly_sales) ...
  // หากไม่ใช่ Super ให้เช็คจากตาราง branch_owners ก่อนว่า userId นี้คุมตู้ไหนบ้าง
}

// ... (Copy ฟังก์ชัน showOwnerSelector, showBranchSelector จากไฟล์เดิมมาใส่ต่อได้เลยค่ะ) ...
async function showOwnerSelector(event) {
  const { data: owners } = await supabase.from('system_admins').select('*');
  if (!owners?.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มี Owner ในระบบค่ะ' });

  const bubbles = owners.map(o => ({
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: o.display_name, weight: "bold", size: "sm", align: "start", gravity: "center", flex: 3 },
            { 
              type: "button", 
              style: "primary", 
              color: "#00b900", 
              height: "sm",
              flex: 2,
              action: { type: "message", label: "เลือก", text: `เลือก Owner: ${o.display_name} | ${o.line_user_id}` } 
            }
          ]
        }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือก Owner", contents: { type: "carousel", contents: bubbles } });
}

// 2. เลือกสาขา: ปรับปุ่มอยู่บรรทัดเดียวกับชื่อ
async function showBranchSelector(event, ownerId) {
  const { data: branches } = await supabase.from('branches').select('*');
  const bubbles = branches.map(b => ({
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: b.branch_name, weight: "bold", size: "sm", align: "start", gravity: "center", flex: 3 },
            { 
              type: "button", 
              style: "secondary", 
              height: "sm",
              flex: 2,
              action: { type: "message", label: "เลือก", text: `ยืนยันจับคู่ O:${ownerId} B:${b.id}` } 
            }
          ]
        }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: { type: "carousel", contents: bubbles } });
}

// 3. เพิ่ม Owner และตอบกลับด้วยชื่อเรียก
async function handleAddOwner(event, targetId, displayName) {
  const { error } = await supabase.from('system_admins').insert([{ line_user_id: targetId, display_name: displayName }]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ Error: ${error.message}` : `✅ เพิ่ม owner ${displayName} เรียบร้อยแล้วค่ะ`
  });
}

// 4. บันทึกการจับคู่ลง owner_line_id
async function handleFinalPairing(event, ownerId, branchId) {
  const { error } = await supabase.from('branch_owners').insert([{ branch_id: branchId, owner_line_id: ownerId }]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ ผิดพลาด: ${error.message}` : `✅ จับคู่สำเร็จแล้วค่ะ!`
  });
}

// (ฟังก์ชันเสริมอื่นๆ คงไว้ตามเดิม)
function sendMainMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'สวัสดีค่ะ Super Admin! เลือกหมวดหมู่ที่ต้องการจัดการ:',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '➕ สร้าง', text: 'เมนู Create' } },
        { type: 'action', action: { type: 'message', label: '⚙️ จัดการ', text: 'เมนู Manage' } }
      ]
    }
  });
}

async function handleCreateBranch(event, branchName) {
  const { error } = await supabase.from('branches').insert([{ branch_name: branchName }]);
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ Error: ${error.message}` : `✅ สร้างสาขา "${branchName}" เรียบร้อย!`
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
