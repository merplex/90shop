const express = require('express');
const line = require('@line/bot-sdk');
const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
require('dotenv').config();

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

  const { data: isSuper } = await supabase.from('super_admins').select('*').eq('line_user_id', userId).maybeSingle();
  if (!isSuper) return null;

  // --- Router ---
  if (userText.toLowerCase() === 'admin') return sendFlexMainMenu(event);
  if (userText === 'เมนู Create') return sendFlexCreateMenu(event);
  if (userText === 'จัดการการจับคู่') return showManageMatching(event);
  if (userText === 'เริ่มการจับคู่') return sendAlphabetMenu(event);
  
  if (userText.startsWith('กลุ่มตัวอักษร:')) {
    const range = userText.replace('กลุ่มตัวอักษร:', '').trim();
    return showOwnerSelector(event, range);
  }

  // --- Create Owner & Branch ---
  if (userText.startsWith('U') && userText.includes(' ')) {
    const parts = userText.split(' ');
    const targetId = parts[0].trim();
    const name = parts.slice(1).join(' ');
    if (targetId.length >= 10) {
      const { error } = await supabase.from('branch_owners').upsert([{ owner_line_id: targetId, owner_name: name }], { onConflict: 'owner_line_id' });
      return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ บันทึก Owner: ${name} (ID: ${targetId}) เรียบร้อยค่ะ` });
    }
  }

  if (userText.startsWith('Branch ')) {
    const branchName = userText.replace('Branch ', '').trim();
    const { error } = await supabase.from('branches').insert([{ branch_name: branchName, created_at: now.format() }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ สร้างสาขา "${branchName}" สำเร็จ` });
  }

  // --- Delete Matching (Many-to-Many) ---
  if (userText.startsWith('ยกเลิกการจับคู่ ID:')) {
    const data = userText.replace('ยกเลิกการจับคู่ ID:', '').split('|');
    const targetOwnerId = data[0].trim();
    const targetBranchId = data[1].trim();
    const { error } = await supabase.from('owner_branch_mapping').delete().eq('owner_line_id', targetOwnerId).eq('branch_id', targetBranchId);
    return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ ยกเลิกการเชื่อมต่อเรียบร้อยค่ะ` });
  }

  // --- Matching Flow ---
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
    const { error } = await supabase.from('owner_branch_mapping').insert([{ owner_line_id: ownerId, branch_id: branchId }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: error ? `❌ Error: ${error.message}` : `✅ จับคู่ "${ownerName}" กับ "${branchName}" เรียบร้อย!` });
  }
}

// --- Functions ---

// 1. ฟังก์ชันแสดงเมนู (จะเห็นปุ่ม A-M และ N-Z แน่นอนถ้ามีชื่อ A B C...)
async function sendAlphabetMenu(event) {
  const { data: owners, error } = await supabase.from('branch_owners').select('owner_name');
  
  // 🔍 เพิ่มบรรทัดนี้เพื่อดู Log ใน Terminal/Console
  console.log("ข้อมูล Owner ที่ดึงได้:", owners);
  if (error) console.error("Supabase Error:", error);

  const groups = [
    { label: "A-M", range: "ABCDEFGHIJKLM".split("") },
    { label: "N-Z", range: "NOPQRSTUVWXYZ".split("") },
    { label: "ก-ฮ", range: "กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ".split("") }
  ];

  // ลองปรับ Logic ให้ยืดหยุ่นขึ้น (ตัดช่องว่างออกก่อนเช็ค)
  const activeGroups = groups.filter(group => 
    owners?.some(o => {
      if (!o.owner_name) return false;
      const firstChar = o.owner_name.trim().charAt(0).toUpperCase();
      return group.range.includes(firstChar);
    })
  );

  if (activeGroups.length === 0) {
    // 🔍 ถ้าหาไม่เจอ ให้บอกด้วยว่าชื่อตัวแรกที่เจอคืออะไร
    const firstNames = owners?.map(o => o.owner_name.charAt(0)).join(", ");
    return client.replyMessage(event.replyToken, { 
      type: 'text', 
      text: `ไม่พบกลุ่มที่ตรงกับชื่อที่มีค่ะ (ชื่อขึ้นต้นด้วย: ${firstNames || 'ไม่มีข้อมูล'})` 
    });
  }
  // ... ส่วนที่เหลือคงเดิม ...
}


async function showOwnerSelector(event, rangeLabel) {
  const { data: owners } = await supabase.from('branch_owners').select('*').order('owner_name', { ascending: true });
  
  const alphabet = {
    "A-M": "ABCDEFGHIJKLM".split(""),
    "N-Z": "NOPQRSTUVWXYZ".split(""),
    "ก-ฮ": "กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ".split("")
  };

  // กรองเฉพาะชื่อที่อยู่ในกลุ่มที่เลือก
  const filtered = owners.filter(o => {
    const firstChar = o.owner_name?.trim().charAt(0).toUpperCase();
    return alphabet[rangeLabel].includes(firstChar);
  });

  if (filtered.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบรายชื่อในกลุ่มนี้ค่ะ' });

  const chunks = [];
  for (let i = 0; i < filtered.length; i += 10) chunks.push(filtered.slice(i, i + 10));

  const bubbles = chunks.map(chunk => ({
    type: "bubble",
    header: { type: "box", layout: "vertical", contents: [{ type: "text", text: `รายชื่อกลุ่ม ${rangeLabel}`, size: "sm", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: chunk.map(o => ({
        type: "box", layout: "horizontal", verticalAlign: "center",
        contents: [
          { type: "text", text: o.owner_name, weight: "bold", size: "sm", flex: 3, wrap: true },
          { type: "button", style: "primary", color: "#00b900", height: "sm", flex: 2, action: { type: "message", label: "เลือก", text: `เลือก Owner: ${o.owner_name} | ${o.owner_line_id}` } }
        ]
      }))
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
  const { data: mappings, error } = await supabase.from('owner_branch_mapping').select('owner_line_id, branch_id, branch_owners(owner_name), branches(branch_name)');
  if (error || !mappings?.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มีข้อมูลการจับคู่ค่ะ' });

  const bubbles = mappings.map(item => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", spacing: "xs",
      contents: [
        { type: "text", text: `👤 ${item.branch_owners?.owner_name || 'N/A'}`, weight: "bold", size: "xs", wrap: true },
        { type: "text", text: `📍 ${item.branches?.branch_name || 'N/A'}`, size: "xs", color: "#666666", wrap: true },
        { type: "button", style: "primary", color: "#FF4B4B", height: "sm", margin: "xs", action: { type: "message", label: "🗑️ ลบ", text: `ยกเลิกการจับคู่ ID:${item.owner_line_id}|${item.branch_id}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "จัดการการจับคู่", contents: { type: "carousel", contents: bubbles.slice(0, 12) } });
}

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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Thai Admin System v3 (Alphabet Filter) running on port ${PORT}`));
