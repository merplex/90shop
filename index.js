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

// ... (ส่วนหัวข้อและการตั้งค่าเหมือนเดิม) ...

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
          { type: 'action', action: { type: 'message', label: 'เพิ่มแอดมิน', text: 'เพิ่มแอดมิน' } },
          { type: 'action', action: { type: 'message', label: '🔗 จับคู่ (Pairing)', text: 'เริ่มการจับคู่' } }
        ]
      }
    });
  }

  // ---------------------------------------------------------
  // ส่วนที่ 2: ขั้นตอนการจับคู่ (Pairing Flow)
  // ---------------------------------------------------------

  // ขั้นตอนที่ 1: เลือก Admin (แสดง List รายชื่อแอดมิน)
  if (userText === 'เริ่มการจับคู่') {
    return showAdminSelector(event);
  }

  // ขั้นตอนที่ 2: รับค่า Admin ที่เลือก แล้วแสดง List รายชื่อสาขา
  // ตัวอย่างข้อความที่ได้รับ: "เลือกแอดมิน ID:U12345..."
  if (userText.startsWith('เลือกแอดมิน ID:')) {
    const adminId = userText.split('ID:')[1];
    return showBranchSelector(event, adminId);
  }

  // ขั้นตอนที่ 3: รับค่าคู่ที่เลือก แล้วบันทึกลง Database
  // ตัวอย่างข้อความที่ได้รับ: "ยืนยันจับคู่ A:U123... B:5"
  if (userText.startsWith('ยืนยันจับคู่ ')) {
    const params = userText.replace('ยืนยันจับคู่ ', '').split(' ');
    const adminId = params[0].split(':')[1];
    const branchId = params[1].split(':')[1];
    return handleFinalPairing(event, adminId, branchId);
  }

  // ---------------------------------------------------------
  // ส่วนที่ 3: ระบบ Manage & อื่นๆ
  // ---------------------------------------------------------
  if (userText === 'เมนู Manage') {
    return sendManageMenu(event);
  }
  
  if (userText === 'Manage Branches') return handleListBranches(event);
  if (userText === 'Manage Admins') return handleListAdmins(event);

  // การสร้างแบบพิมพ์เอง (Fallback)
  if (userText.startsWith('Branch ')) return handleCreateBranch(event, userText.replace('Branch ', '').trim());
}

// ---------------------------------------------------------
// ส่วนที่ 4: ฟังก์ชันสร้าง Flex Message (UI Functions)
// ---------------------------------------------------------

// ฟังก์ชัน: สร้าง List แอดมินให้จิ้ม
async function showAdminSelector(event) {
  const { data: admins } = await supabase.from('system_admins').select('*');
  if (!admins.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มี Admin ในระบบค่ะ' });

  const bubbles = admins.map(admin => ({
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: admin.display_name, weight: "bold", size: "sm", wrap: true },
        { type: "button", style: "primary", color: "#00b900", height: "sm",
          action: { type: "message", label: "เลือกคนนี้", text: `เลือกแอดมิน ID:${admin.line_user_id}` }
        }
      ]
    }
  }));

  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: "เลือกแอดมิน",
    contents: { type: "carousel", contents: bubbles }
  });
}

// ฟังก์ชัน: สร้าง List สาขาให้จิ้ม (หลังจากเลือกแอดมินแล้ว)
async function showBranchSelector(event, adminId) {
  const { data: branches } = await supabase.from('branches').select('*');
  
  const bubbles = branches.map(branch => ({
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: branch.branch_name, weight: "bold", size: "sm" },
        { type: "button", style: "secondary", height: "sm",
          action: { type: "message", label: "เลือกสาขานี้", text: `ยืนยันจับคู่ A:${adminId} B:${branch.id}` }
        }
      ]
    }
  }));

  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: "เลือกสาขา",
    contents: { type: "carousel", contents: bubbles }
  });
}

// ฟังก์ชัน: บันทึกการจับคู่ลงตาราง branch_owners
async function handleFinalPairing(event, adminId, branchId) {
  const { error } = await supabase.from('branch_owners').insert([{ branch_id: branchId, admin_id: adminId }]);

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: error ? `❌ ผิดพลาด: ${error.message}` : `✅ จับคู่สำเร็จแล้วค่ะ!\nแอดมินพร้อมดูแลสาขานี้แล้ว`
  });
}

// --- ฟังก์ชันแยกกันอยู่ข้างนอก ไม่ซ้อนกันแล้วค่ะ ---

async function handleCreateBranch(event, branchName) {
  try {
    const { error } = await supabase
      .from('branches')
      .insert([{ branch_name: branchName }]);

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: error ? `❌ สร้างไม่สำเร็จ: ${error.message}` : `✅ สร้างสาขา "${branchName}" เรียบร้อยแล้วค่ะ!`
    });
  } catch (err) {
    console.error(err);
  }
}

async function handleAddAdmin(event, targetId, displayName) {
  try {
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

    const { error } = await supabase
      .from('system_admins')
      .insert([{ line_user_id: targetId, display_name: displayName }]);

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: error ? '❌ เกิดข้อผิดพลาดในการบันทึก' : `✅ เพิ่ม Admin: ${displayName} เรียบร้อยแล้วค่ะ`
    });
  } catch (err) {
    console.error(err);
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Admin Server is running on port ${PORT}`));
