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
      console.error("Webhook Error:", err.message); // ดูแค่ข้อความ Error สั้นๆ
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

  // --- ระบบบันทึก Owner ---
  if (userText.startsWith('U') && userText.includes(' ')) {
    const parts = userText.split(' ');
    const targetId = parts[0].trim();
    const name = parts.slice(1).join(' ');
    if (targetId.length >= 10) {
      await supabase.from('branch_owners').upsert([{ owner_line_id: targetId, owner_name: name }], { onConflict: 'owner_line_id' });
      return client.replyMessage(event.replyToken, { type: 'text', text: `✅ บันทึก Owner: ${name} แล้ว` });
    }
  }

  // --- ระบบสร้างสาขา ---
  if (userText.startsWith('Branch ')) {
    const branchName = userText.replace('Branch ', '').trim();
    await supabase.from('branches').insert([{ branch_name: branchName }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ สร้างสาขา "${branchName}" สำเร็จ` });
  }

  // --- ยกเลิกการจับคู่ ---
  if (userText.startsWith('ยกเลิกการจับคู่ ID:')) {
    const data = userText.replace('ยกเลิกการจับคู่ ID:', '').split('|');
    await supabase.from('owner_branch_mapping').delete().eq('owner_line_id', data[0]).eq('branch_id', data[1]);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ ลบการจับคู่เรียบร้อย` });
  }

  // --- Matching Flow ---
  if (userText.startsWith('เลือก Owner:')) {
    const parts = userText.split('|');
    const ownerId = parts[1].trim();
    const ownerName = parts[0].replace('เลือก Owner:', '').trim();
    return showBranchSelector(event, ownerId, ownerName);
  }

  if (userText.startsWith('ยืนยันจับคู่ ')) {
    // แยกค่าด้วยการหา Key O: B: N: BN:
    const ownerId = userText.match(/O:(\S+)/)[1];
    const branchId = userText.match(/B:(\S+)/)[1];
    const ownerName = userText.match(/N:([^\s]+)/)[1];
    const branchName = userText.match(/BN:([^\s]+)/)[1];
    
    const { error } = await supabase.from('owner_branch_mapping').insert([{ owner_line_id: ownerId, branch_id: branchId }]);
    return client.replyMessage(event.replyToken, { 
        type: 'text', 
        text: error ? `❌ ซ้ำ: คู่นี้มีอยู่แล้วค่ะ` : `✅ จับคู่ ${ownerName} - ${branchName} สำเร็จ` 
    });
  }
}

// --- Functions ---

async function sendAlphabetMenu(event) {
  const groups = [
    { label: "A-M", range: "ABCDEFGHIJKLM".split("") },
    { label: "N-Z", range: "NOPQRSTUVWXYZ".split("") },
    { label: "ก-ฮ", range: "กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ".split("") }
  ];

  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "เลือกกลุ่ม Owner",
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: "เลือกกลุ่มชื่อเจ้าของ", weight: "bold", size: "lg" },
          ...groups.map(g => ({
            type: "button", style: "primary", color: "#1DB446", margin: "xs",
            action: { type: "message", label: g.label, text: `กลุ่มตัวอักษร: ${g.label}` }
          }))
        ]
      }
    }
  });
}

async function showOwnerSelector(event, rangeLabel) {
  const { data: owners } = await supabase.from('branch_owners').select('*').order('owner_name');
  const groups = {
    "A-M": "ABCDEFGHIJKLM".split(""),
    "N-Z": "NOPQRSTUVWXYZ".split(""),
    "ก-ฮ": "กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ".split("")
  };

  const filtered = owners.filter(o => groups[rangeLabel].includes(o.owner_name.trim().charAt(0).toUpperCase()));
  if (filtered.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบรายชื่อในกลุ่มนี้' });

  const bubbles = filtered.slice(0, 10).map(o => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: o.owner_name, weight: "bold", align: "center" },
        { type: "button", style: "primary", color: "#00b900", height: "sm", margin: "md",
          action: { type: "message", label: "เลือก", text: `เลือก Owner: ${o.owner_name} | ${o.owner_line_id}` }
        }
      ]
    }
  }));

  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือก Owner", contents: { type: "carousel", contents: bubbles } });
}

async function showBranchSelector(event, ownerId, ownerName) {
  const { data: branches } = await supabase.from('branches').select('*').order('branch_name');
  const bubbles = branches.slice(0, 10).map(b => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", contents: [
        { type: "text", text: b.branch_name, weight: "bold", align: "center" },
        { type: "button", style: "secondary", height: "sm", margin: "md",
          action: { type: "message", label: "เลือก", text: `ยืนยันจับคู่ O:${ownerId} B:${b.id} N:${ownerName} BN:${b.branch_name}` }
        }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: { type: "carousel", contents: bubbles } });
}

async function showManageMatching(event) {
  const { data: mappings } = await supabase.from('owner_branch_mapping').select('owner_line_id, branch_id, branch_owners(owner_name), branches(branch_name)');
  if (!mappings?.length) return client.replyMessage(event.replyToken, { type: 'text', text: 'ยังไม่มีข้อมูลการจับคู่' });

  const bubbles = mappings.slice(0, 10).map(item => ({
    type: "bubble", size: "micro",
    body: {
      type: "box", layout: "vertical", spacing: "xs",
      contents: [
        { type: "text", text: `👤 ${item.branch_owners?.owner_name}`, weight: "bold", size: "xs" },
        { type: "text", text: `📍 ${item.branches?.branch_name}`, size: "xs", color: "#666666" },
        { type: "button", style: "primary", color: "#FF4B4B", height: "sm", action: { type: "message", label: "ลบ", text: `ยกเลิกการจับคู่ ID:${item.owner_line_id}|${item.branch_id}` } }
      ]
    }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "จัดการคู่", contents: { type: "carousel", contents: bubbles } });
}

function sendFlexMainMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Menu",
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "ADMIN MENU", weight: "bold", align: "center" },
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
          { type: "text", text: "CREATE & MATCHING", weight: "bold" },
          { type: "button", style: "link", action: { type: "message", label: "สร้างOwner: U[ID] [ชื่อ]", text: "พิมพ์ U[ID] [ชื่อ]" } },
          { type: "button", style: "link", action: { type: "message", label: "สร้างสาขา: Branch [ชื่อ]", text: "พิมพ์ Branch [ชื่อ]" } },
          { type: "button", style: "primary", color: "#464a4d", action: { type: "message", label: "🔗 เริ่มการจับคู่", text: "เริ่มการจับคู่" } }
        ]
      }
    }
  });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Thai Admin System v4.1 running on port ${PORT}`));
