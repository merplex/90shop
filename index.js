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
  // ส่วนที่ 1: เมนูหลัก & เมนูสร้าง (Create)
  // ---------------------------------------------------------
  if (userText.toLowerCase() === 'admin') return sendMainMenu(event);

  if (userText === 'เมนู Create') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🏠 เลือกสิ่งที่ต้องการทำ:',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: 'สร้างสาขา', text: 'คำแนะนำสร้างสาขา' } },
          { type: 'action', action: { type: 'message', label: 'เพิ่มแอดมิน', text: 'คำแนะนำเพิ่มแอดมิน' } },
          { type: 'action', action: { type: 'message', label: '🔗 จับคู่ (Pairing)', text: 'เริ่มการจับคู่' } }
        ]
      }
    });
  }

  if (userText === 'คำแนะนำสร้างสาขา') return client.replyMessage(event.replyToken, { type: 'text', text: '🏠 พิมพ์ "Branch [ชื่อสาขา]"\nเช่น: Branch rabbit81' });
  if (userText === 'คำแนะนำเพิ่มแอดมิน') return client.replyMessage(event.replyToken, { type: 'text', text: '👥 พิมพ์ "U[LineID] [ชื่อเรียก]"\nเช่น: U123456... สมชาย' });

  // ---------------------------------------------------------
  // ส่วนที่ 2: ขั้นตอนการจับคู่ (Pairing Flow แบบ Flex)
  // ---------------------------------------------------------
  if (userText === 'เริ่มการจับคู่') return showAdminSelector(event);

  if (userText.startsWith('เลือกแอดมิน ID:')) {
    const adminId = userText.split('ID:')[1];
    return showBranchSelector(event, adminId);
  }

  if (userText.startsWith('ยืนยันจับคู่ ')) {
    const params = userText.replace('ยืนยันจับคู่ ', '').split(' ');
    const adminId = params[0].split(':')[1];
    const branchId = params[1].split(':')[1];
    return handleFinalPairing(event, adminId, branchId);
  }

  // ---------------------------------------------------------
  // ส่วนที่ 3: ระบบจัดการ (Manage) & สรุปยอด
  // ---------------------------------------------------------
  if (userText === 'เมนู Manage') return sendManageMenu(event);
  if (userText === 'Manage Branches') return handleListBranches(event);
  if (userText === 'Manage Admins') return handleListAdmins(event);
  if (userText === 'สรุปยอดเมื่อวาน') return handleDailySummary(event);

  // ---------------------------------------------------------
  // ส่วนที่ 4: Logic การสร้างข้อมูล (Create Logic)
  // ---------------------------------------------------------
  if (userText.startsWith('Branch ')) return handleCreateBranch(event, userText.replace('Branch ', '').trim());
  if (userText.startsWith('U') && userText.includes(' ')) {
    const [targetId, displayName] = userText.split(' ');
    if (targetId.length >= 10) return handleAddAdmin(event, targetId, displayName);
  }
}

// ---------------------------------------------------------
// UI FUNCTIONS (Flex & Menus)
// ---------------------------------------------------------

function sendMainMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'สวัสดีค่ะ Super Admin! เลือกหมวดหมู่ที่ต้องการจัดการ:',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '➕ สร้าง (Create)', text: 'เมนู Create' } },
        { type: 'action', action: { type: 'message', label: '⚙️ จัดการ (Manage)', text: 'เมนู Manage' } },
        { type: 'action', action: { type: 'message', label: '👑 Super Admin', text: 'เมนู Super Admin' } }
      ]
    }
  });
}

function sendManageMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '⚙️ เลือกสิ่งที่ต้องการจัดการ:',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: 'จัดการสาขา', text: 'Manage Branches' } },
        { type: 'action', action: { type: 'message', label: 'จัดการแอดมิน', text: 'Manage Admins' } },
        { type: 'action', action: { type: 'message', label: '📊 ยอดเมื่อวาน', text: 'สรุปยอดเมื่อวาน' } }
      ]
    }
  });
}

async function showAdminSelector(event) {
  const { data: admins } = await supabase.from('system_admins').select('*');
  if (!admins || !admins.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มี Admin ในระบบค่ะ' });

  const bubbles = admins.map(admin => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: admin.display_name, weight: "bold", size: "sm", wrap: true },
        { type: "button", style: "primary", color: "#00b900", height: "sm", action: { type: "message", label: "เลือกคนนี้", text: `เลือกแอดมิน ID:${admin.line_user_id}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกแอดมิน", contents: { type: "carousel", contents: bubbles } });
}

async function showBranchSelector(event, adminId) {
  const { data: branches } = await supabase.from('branches').select('*');
  const bubbles = branches.map(branch => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: branch.branch_name, weight: "bold", size: "sm" },
        { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "เลือกสาขา", text: `ยืนยันจับคู่ A:${adminId} B:${branch.id}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: { type: "carousel", contents: bubbles } });
}

// ---------------------------------------------------------
// DATABASE FUNCTIONS (Logic)
// ---------------------------------------------------------

async function handleDailySummary(event) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  const { data: sales } = await supabase.from('machine_hourly_sales').select('*').gte('sale_time', `${dateStr}T00:00:00Z`).lte('sale_time', `${dateStr}T23:59:59Z`);

  if (!sales || sales.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: `📭 ไม่มียอดขายของวันที่ ${dateStr}` });

  let total = sales.reduce((sum, s) => sum + s.amount, 0);
  return client.replyMessage(event.replyToken, { type: 'text', text: `📊 สรุปยอดเมื่อวาน (${dateStr})\nยอดรวมทั้งหมด: ${total} บาท` });
}

async function handleCreateBranch(event, branchName) {
  const { error } = await supabase.from('branches').insert([{ branch_name: branchName }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ สร้างสาขา "${branchName}" สำเร็จ!` });
}

async function handleAddAdmin(event, targetId, displayName) {
  const { error } = await supabase.from('system_admins').insert([{ line_user_id: targetId, display_name: displayName }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ เพิ่ม Admin "${displayName}" สำเร็จ!` });
}

async function handleFinalPairing(event, adminId, branchId) {
  const { error } = await supabase.from('branch_owners').insert([{ branch_id: branchId, admin_id: adminId }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ ผิดพลาด: ${error.message}` : `✅ จับคู่สำเร็จแล้วค่ะ!` });
}

async function handleListBranches(event) {
  const { data: branches } = await supabase.from('branches').select('*');
  let msg = '🏠 รายชื่อสาขา:\n' + branches.map(b => `ID: ${b.id} - ${b.branch_name}`).join('\n');
  return client.replyMessage(event.replyToken, { type: 'text', text: msg });
}

async function handleListAdmins(event) {
  const { data: admins } = await supabase.from('system_admins').select('*');
  let msg = '👥 รายชื่อ Admin:\n' + admins.map(a => `${a.display_name} (${a.line_user_id.substring(0,8)}...)`).join('\n');
  return client.replyMessage(event.replyToken, { type: 'text', text: msg });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Admin Server is running on port ${PORT}`));
