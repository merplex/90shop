const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
require('dotenv').config();

// ตั้งค่า DayJS ให้ใช้ Timezone ไทย
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Asia/Bangkok");

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
  const now = dayjs().tz();

  // 🛡️ เช็คสิทธิ์ Super Admin
  const { data: isSuper } = await supabase.from('super_admins').select('*').eq('line_user_id', userId).maybeSingle();
  if (!isSuper) return null;

  // --- เมนูหลัก ---
  if (userText.toLowerCase() === 'admin') return sendFlexMainMenu(event);
  if (userText === 'เมนู Create') return sendFlexCreateMenu(event);
  if (userText === 'จัดการการจับคู่') return showManageMatching(event);

  // --- ระบบ Create ---
    // --- ระบบ Create (แบบไม่ตัดตัว U ออก) ---
  if (userText.startsWith('U') && userText.includes(' ')) {
    const parts = userText.split(' ');
    const targetId = parts[0].trim(); // รับค่าเต็มๆ เช่น U4e5afaf... ไม่ต้องตัดตัวแรกทิ้ง
    const name = parts.slice(1).join(' ');
    
    // เช็คความยาวให้ครอบคลุม (ปกติ LINE ID จะยาว 33 ตัวอักษร)
    if (targetId.length >= 10) {
      const { error } = await supabase.from('branch_owners').upsert([
        { 
          owner_line_id: targetId, 
          owner_name: name 
        }
      ], { onConflict: 'owner_line_id' });

      return client.replyMessage(event.replyToken, { 
        type: 'text', 
        text: error ? `❌ Error: ${error.message}` : `✅ บันทึก Owner: ${name} (ID: ${targetId}) เรียบร้อยค่ะ` 
      });
    }
  }


  if (userText.startsWith('Branch ')) {
    const branchName = userText.replace('Branch ', '').trim();
    const { error } = await supabase.from('branches').insert([{ branch_name: branchName, created_at: now.format() }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ สร้างสาขา "${branchName}" สำเร็จ` });
  }

  // --- ระบบ Manage & Delete (ลบการจับคู่เดิม) ---
  if (userText.startsWith('ยกเลิกการจับคู่ ID:')) {
    const targetOwnerId = userText.replace('ยกเลิกการจับคู่ ID:', '').trim();
    const { error } = await supabase
      .from('branch_owners')
      .update({ branch_id: null, paired_at: null })
      .eq('owner_line_id', targetOwnerId);

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: error ? `❌ Error: ${error.message}` : `✅ ลบการจับคู่แล้วค่ะ คุณสามารถเลือกจับคู่ใหม่ได้ทันที`
    });
  }

  // --- Flow การจับคู่ ---
  if (userText === 'เริ่มการจับคู่') return showOwnerSelector(event);

  if (userText.startsWith('เลือก Owner:')) {
    const parts = userText.split('|');
    const ownerName = parts[0].replace('เลือก Owner:', '').trim();
    const ownerId = parts[1].trim();
    return showBranchSelector(event, ownerId, ownerName);
  }

  if (userText.startsWith('ยืนยันจับคู่ ')) {
    const params = userText.replace('ยืนยันจับคู่ ', '').split(' ');
    const ownerId = params[0].split(':')[1];
    const branchId = params[1].split(':')[1];
    const ownerName = params[2].split(':')[1];
    const branchName = params[3]?.split(':')[1] || 'สาขา';
    
    const { error } = await supabase.from('branch_owners').upsert({ 
      owner_line_id: ownerId, 
      branch_id: branchId, 
      owner_name: ownerName,
      paired_at: now.format() 
    });

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: error ? `❌ Error: ${error.message}` : `✅ จับคู่ "${ownerName}" กับ "${branchName}" สำเร็จ!`
    });
  }
}

// --- UI Flex Message ---

function sendFlexMainMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Admin Menu",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "ADMIN MENU", weight: "bold", color: "#1DB446" }] },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "➕ สร้าง/จัดการ", text: "เมนู Create" } },
          { type: "button", style: "secondary", color: "#FF4B4B", action: { type: "message", label: "⚙️ จัดการการจับคู่", text: "จัดการการจับคู่" } }
        ]
      }
    }
  });
}

function sendFlexCreateMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Create Menu",
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: "CREATE & MATCHING", weight: "bold", margin: "md" },
          { type: "button", style: "link", height: "sm", action: { type: "message", label: "สร้างOwner", text: "U[ID] [ชื่อ]" } },
          { type: "button", style: "link", height: "sm", action: { type: "message", label: "สร้างสาขา", text: "Branch [ชื่อ]" } },
          { type: "button", style: "primary", color: "#464a4d", margin: "md", action: { type: "message", label: "🔗 เริ่มการจับคู่", text: "เริ่มการจับคู่" } }
        ]
      }
    }
  });
}

async function showOwnerSelector(event) {
  const { data: owners } = await supabase.from('branch_owners').select('*');
  if (!owners?.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มีรายชื่อ Owner ค่ะ' });

  const bubbles = owners.map(o => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", spacing: "xs",
      contents: [
        { type: "text", text: o.owner_name, weight: "bold", size: "sm", align: "center", wrap: true },
        { type: "button", style: "primary", color: "#00b900", height: "sm", action: { type: "message", label: "เลือก", text: `เลือก Owner: ${o.owner_name} | ${o.owner_line_id}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือก Owner", contents: { type: "carousel", contents: bubbles.slice(0, 12) } });
}

async function showBranchSelector(event, ownerId, ownerName) {
  const { data: branches } = await supabase.from('branches').select('*');
  const bubbles = branches.map(b => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", spacing: "xs",
      contents: [
        { type: "text", text: b.branch_name, weight: "bold", size: "sm", align: "center", wrap: true },
        { type: "button", style: "secondary", color: "#464a4d", height: "sm", action: { type: "message", label: "เลือก", text: `ยืนยันจับคู่ O:${ownerId} B:${b.id} N:${ownerName} BN:${b.branch_name}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: { type: "carousel", contents: bubbles.slice(0, 12) } });
}

async function showManageMatching(event) {
  const { data: matched, error } = await supabase
    .from('branch_owners')
    .select('owner_line_id, owner_name, branches(branch_name)')
    .not('branch_id', 'is', null);

  if (error || !matched?.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มีข้อมูลการจับคู่ค่ะ' });

  // แบ่งข้อมูลเป็นชุดละ 10 รายการต่อ 1 Bubble
  const chunkSize = 10;
  const chunks = [];
  for (let i = 0; i < matched.length; i += chunkSize) {
    chunks.push(matched.slice(i, i + chunkSize));
  }

  const bubbles = chunks.map((chunk, index) => ({
    type: "bubble",
    header: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: `รายการที่ ${index * chunkSize + 1} - ${index * chunkSize + chunk.length}`, size: "sm", color: "#aaaaaa" }
      ]
    },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: chunk.map(item => ({
        type: "box", layout: "horizontal", verticalAlign: "center",
        contents: [
          {
            type: "box", layout: "vertical", flex: 4,
            contents: [
              { type: "text", text: item.owner_name, weight: "bold", size: "sm", wrap: true },
              { type: "text", text: `📍 ${item.branches?.branch_name || 'N/A'}`, size: "xs", color: "#666666", wrap: true }
            ]
          },
          {
            type: "button", style: "secondary", color: "#FF4B4B", height: "sm", flex: 1,
            action: { type: "message", label: "ลบ", text: `ยกเลิกการจับคู่ ID:${item.owner_line_id}` }
          }
        ]
      }))
    }
  }));

  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: "จัดการการจับคู่",
    contents: { type: "carousel", contents: bubbles.slice(0, 12) } // สูงสุด 120 รายการ (12 bubbles * 10)
  });
}


const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Thai Admin System running on port ${PORT}`));
