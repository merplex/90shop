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
  const now = dayjs().tz(); // เวลาปัจจุบันของไทย

  // 🛡️ เช็คสิทธิ์ Super Admin
  const { data: isSuper } = await supabase.from('super_admins').select('*').eq('line_user_id', userId).maybeSingle();
  if (!isSuper) return null;

  // --- เมนูหลัก ---
  if (userText.toLowerCase() === 'admin') return sendFlexMainMenu(event);
  if (userText === 'เมนู Create') return sendFlexCreateMenu(event);

  // --- ระบบ Create (บันทึกเวลาไทยลง metadata ถ้าจำเป็น) ---
  if (userText.startsWith('U') && userText.includes(' ')) {
    const parts = userText.split(' ');
    const targetId = parts[0].substring(1);
    const name = parts.slice(1).join(' ');
    if (targetId.length >= 10) {
      const { error } = await supabase.from('branch_owners').upsert([
        { 
          owner_line_id: targetId, 
          owner_name: name,
          updated_at: now.format() // บันทึกเวลาไทย
        }
      ]);
      return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ บันทึก Owner: ${name} แล้ว` });
    }
  }

  if (userText.startsWith('Branch ')) {
    const branchName = userText.replace('Branch ', '').trim();
    const { error } = await supabase.from('branches').insert([{ branch_name: branchName, created_at: now.format() }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ สร้างสาขา "${branchName}" สำเร็จ` });
  }

  // --- สรุปยอดเมื่อวาน (ใช้การคำนวณวันที่ตามเวลาไทย) ---
  if (userText === 'สรุปยอดเมื่อวาน') {
    const yesterday = now.subtract(1, 'day').format('YYYY-MM-DD');
    return client.replyMessage(event.replyToken, { type: 'text', text: `📊 ระบบกำลังประมวลผลยอดของวันที่ ${yesterday} (เวลาไทย) กรุณารอสักครู่ค่ะ...` });
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
      text: error ? `❌ Error: ${error.message}` : `✅ จับคู่ "${ownerName}" กับ "${branchName}" เรียบร้อยเมื่อ ${now.format('HH:mm')} น.`
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
          { type: "button", style: "secondary", action: { type: "message", label: "📊 ยอดเมื่อวาน", text: "สรุปยอดเมื่อวาน" } }
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
          { type: "button", style: "link", height: "sm", action: { type: "message", label: "วิธีสร้าง Owner", text: "พิมพ์ U[ID] [ชื่อ]" } },
          { type: "button", style: "link", height: "sm", action: { type: "message", label: "วิธีสร้างสาขา", text: "พิมพ์ Branch [ชื่อ]" } },
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
      type: "box", layout: "horizontal", spacing: "xs",
      contents: [
        { type: "text", text: o.owner_name, weight: "bold", size: "xs", gravity: "center", flex: 3, wrap: true },
        { type: "button", style: "primary", color: "#00b900", height: "sm", flex: 2, action: { type: "message", label: "✅", text: `เลือก Owner: ${o.owner_name} | ${o.owner_line_id}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือก Owner", contents: { type: "carousel", contents: bubbles } });
}

async function showBranchSelector(event, ownerId, ownerName) {
  const { data: branches } = await supabase.from('branches').select('*');
  const bubbles = branches.map(b => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "horizontal", spacing: "xs",
      contents: [
        { type: "text", text: b.branch_name, weight: "bold", size: "xs", gravity: "center", flex: 3, wrap: true },
        { type: "button", style: "secondary", color: "#464a4d", height: "sm", flex: 2, action: { type: "message", label: "✅", text: `ยืนยันจับคู่ O:${ownerId} B:${b.id} N:${ownerName} BN:${b.branch_name}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: { type: "carousel", contents: bubbles } });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Thai Admin System running on port ${PORT}`));
