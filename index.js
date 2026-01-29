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

const ALPHABET_GROUPS = {
  "A-B": "AB".split(""), "C-D": "CD".split(""), "E-F": "EF".split(""),
  "G-H": "GH".split(""), "I-J": "IJ".split(""), "K-L": "KL".split(""),
  "M-N": "MN".split(""), "O-P": "OP".split(""), "Q-R": "QR".split(""),
  "S-T": "ST".split(""), "U-V": "UV".split(""), "W-Z": "WXYZ".split("")
};

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then((result) => res.json(result));
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  const userText = event.message.text.trim();

  // --- Main Menu Router ---
  if (userText.toLowerCase() === 'admin') return sendAdminMenu(event); // เพิ่มบรรทัดนี้ค่ะ
  if (userText === 'เมนูจัดการ') return sendManageMenu(event);


  // --- Create Owner & Branch (with Guardrails 100) ---
  if (userText.startsWith('U') && userText.includes(' ')) return handleCreateOwner(event, userText);
  if (userText.startsWith('Branch ')) return handleCreateBranch(event, userText);

  // --- Alphabet Menu Selector ---
  if (userText === 'SELECT_GROUP_Owner') return sendAlphabetMenu(event, 'GRID_OWNER');
  if (userText === 'SELECT_GROUP_Branch') return sendAlphabetMenu(event, 'GRID_BRANCH');
  if (userText === 'SELECT_GROUP_Map') return sendAlphabetMenu(event, 'GRID_MAP');
  if (userText === 'SELECT_GROUP_StartMatch') return sendAlphabetMenu(event, 'MATCH_STEP1');

  // --- Grid Index Displays ---
  if (userText.startsWith('GRID_OWNER:')) return showGrid(event, 'owner', userText.split(':')[1]);
  if (userText.startsWith('GRID_BRANCH:')) return showGrid(event, 'branch', userText.split(':')[1]);
  if (userText.startsWith('GRID_MAP:')) return showGrid(event, 'map', userText.split(':')[1]);

  // --- Matching Flow Logic ---
  if (userText.startsWith('MATCH_STEP1:')) return showGrid(event, 'match_owner', userText.split(':')[1]);
  if (userText.startsWith('SEL_OWNER_FOR_MAP:')) {
    const ownerInfo = userText.replace('SEL_OWNER_FOR_MAP:', ''); // Name|ID
    return sendAlphabetMenu(event, `MATCH_STEP2|${ownerInfo}`);
  }
  if (userText.startsWith('MATCH_STEP2|')) {
    const [_, ownerInfo, range] = userText.split('|');
    return showGrid(event, 'match_branch', range, ownerInfo);
  }
  if (userText.startsWith('CONFIRM_MAP|')) {
    const [_, ownerName, ownerId, branchName, branchId] = userText.split('|');
    return sendConfirmMatch(event, ownerName, ownerId, branchName, branchId);
  }

  // --- CRUD Actions ---
  if (userText.startsWith('MANAGE_OWNER:')) return showOwnerActionMenu(event, userText.split(':')[1]);
  if (userText.startsWith('DELETE_OWNER:')) {
    await supabase.from('branch_owners').delete().eq('owner_line_id', userText.split(':')[1]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ ลบ Owner และข้อมูลผูกพันเรียบร้อย' });
  }
  if (userText.startsWith('RENAME_OWNER:')) {
    const [id, newName] = userText.replace('RENAME_OWNER:', '').split('|');
    await supabase.from('branch_owners').update({ owner_name: newName }).eq('owner_line_id', id);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ เปลี่ยนชื่อเป็น ${newName} เรียบร้อย` });
  }
  if (userText.startsWith('DO_MATCH:')) {
    const [oId, bId] = userText.replace('DO_MATCH:', '').split('|');
    await supabase.from('owner_branch_mapping').upsert([{ owner_line_id: oId, branch_id: bId }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ จับคู่สำเร็จเรียบร้อยแล้วค่ะ' });
  }
  if (userText.startsWith('CONFIRM_DEL_MAP:')) {
    const [oId, bId] = userText.replace('CONFIRM_DEL_MAP:', '').split('|');
    await supabase.from('owner_branch_mapping').delete().eq('owner_line_id', oId).eq('branch_id', bId);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ ยกเลิกการจับคู่เรียบร้อย' });
  }
}

// --- Logic functions ---

async function handleCreateOwner(event, text) {
  const parts = text.split(' ');
  const id = parts[0].trim();
  const name = parts.slice(1).join(' ').trim();
  const first = name.charAt(0).toUpperCase();
  const groupKey = Object.keys(ALPHABET_GROUPS).find(k => ALPHABET_GROUPS[k].includes(first));
  const { data } = await supabase.from('branch_owners').select('owner_name');
  if (data.filter(o => ALPHABET_GROUPS[groupKey]?.includes(o.owner_name.charAt(0).toUpperCase())).length >= 100) {
    return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ กลุ่ม ${groupKey} เต็ม (100 ชื่อ)` });
  }
  await supabase.from('branch_owners').upsert([{ owner_line_id: id, owner_name: name }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: `✅ บันทึก Owner: ${name}` });
}

async function handleCreateBranch(event, text) {
  const name = text.replace('Branch ', '').trim();
  const first = name.charAt(0).toUpperCase();
  const groupKey = Object.keys(ALPHABET_GROUPS).find(k => ALPHABET_GROUPS[k].includes(first));
  const { data } = await supabase.from('branches').select('branch_name');
  if (data.filter(b => ALPHABET_GROUPS[groupKey]?.includes(b.branch_name.charAt(0).toUpperCase())).length >= 100) {
    return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ กลุ่มสาขา ${groupKey} เต็ม (100 ชื่อ)` });
  }
  await supabase.from('branches').insert([{ branch_name: name }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: `✅ บันทึก Branch: ${name}` });
}

async function showGrid(event, type, range, extraData = null) {
  let rows = [];
  if (type === 'owner' || type === 'match_owner') {
    const { data } = await supabase.from('branch_owners').select('*').order('owner_name');
    const filtered = data.filter(o => ALPHABET_GROUPS[range].includes(o.owner_name.charAt(0).toUpperCase()));
    rows = chunkArray(filtered, 4).map(row => ({
      type: "box", layout: "horizontal", spacing: "xs",
      contents: row.map(o => ({
        type: "text", text: o.owner_name.substring(0, 5), size: "xxs", color: "#0000FF", align: "center", decoration: "underline",
        action: { type: "message", label: "sel", text: type === 'owner' ? `MANAGE_OWNER:${o.owner_name}|${o.owner_line_id}` : `SEL_OWNER_FOR_MAP:${o.owner_name}|${o.owner_line_id}` }
      }))
    }));
  } else if (type === 'branch' || type === 'match_branch') {
    const { data } = await supabase.from('branches').select('*').order('branch_name');
    const filtered = data.filter(b => ALPHABET_GROUPS[range].includes(b.branch_name.charAt(0).toUpperCase()));
    rows = chunkArray(filtered, 4).map(row => ({
      type: "box", layout: "horizontal", spacing: "xs",
      contents: row.map(b => ({
        type: "text", text: b.branch_name.substring(0, 5), size: "xxs", color: "#0000FF", align: "center", decoration: "underline",
        action: { type: "message", label: "sel", text: type === 'branch' ? `GRID_BRANCH_VIEW:${b.id}` : `CONFIRM_MAP|${extraData}|${b.branch_name}|${b.id}` }
      }))
    }));
  } else if (type === 'map') {
    const { data } = await supabase.from('owner_branch_mapping').select('*, branch_owners(owner_name), branches(branch_name)');
    const filtered = data.filter(m => ALPHABET_GROUPS[range].includes(m.branches?.branch_name.charAt(0).toUpperCase()));
    if (filtered.length >= 40) return client.replyMessage(event.replyToken, { type: 'text', text: `⚠️ การจับคู่ในกลุ่ม ${range} เต็ม (40 คู่)` });
    rows = chunkArray(filtered, 2).map(row => ({
      type: "box", layout: "horizontal", spacing: "sm",
      contents: row.map(m => ({
        type: "text", text: `${m.branches?.branch_name.substring(0, 5)}:${m.branch_owners?.owner_name.substring(0, 5)}`, size: "xxs", color: "#FF4B4B", align: "center",
        action: { type: "message", label: "del", text: `CONFIRM_DEL_MAP:${m.owner_line_id}|${m.branch_id}` }
      }))
    }));
  }

  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Grid View",
    contents: { type: "bubble", header: { type: "box", layout: "vertical", contents: [{ type: "text", text: `${type.toUpperCase()} INDEX: ${range}`, weight: "bold" }] }, body: { type: "box", layout: "vertical", spacing: "md", contents: rows.slice(0, 20) } }
  });
}

// --- UI Helpers ---
function sendAdminMenu(event) {
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Admin Menu",
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "ADMIN MENU", weight: "bold", color: "#1DB446" }] },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "➕ สร้าง/จัดการ", text: "เมนูจัดการ" } },
          { type: "button", style: "secondary", color: "#464a4d", action: { type: "message", label: "🔗 เริ่มจับคู่ใหม่", text: "SELECT_GROUP_StartMatch" } }
        ]
      }
    }
  });
}

function sendManageMenu(event) {
  const options = [{l:"แก้ไข Owner",v:"Owner"}, {l:"แก้ไข Branch",v:"Branch"}, {l:"แก้ไข จับคู่ (ดู/ลบ)",v:"Map"}, {l:"เริ่มจับคู่ใหม่",v:"StartMatch"}];
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Manage Menu",
    contents: { type: "bubble", body: { type: "box", layout: "vertical", spacing: "sm", contents: options.map(o => ({ type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: o.l, text: `SELECT_GROUP_${o.v}` } })) } }
  });
}

function sendAlphabetMenu(event, nextCommandPrefix) {
  const keys = Object.keys(ALPHABET_GROUPS);
  const rows = chunkArray(keys, 3);
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Select Group",
    contents: {
      type: "bubble", body: { type: "box", layout: "vertical", spacing: "xs", contents: rows.map(row => ({
        type: "box", layout: "horizontal", spacing: "xs", contents: row.map(k => ({
          type: "button", style: "secondary", height: "sm", action: { type: "message", label: k, text: `${nextCommandPrefix}:${k}` }
        }))
      })) }
    }
  });
}

function showOwnerActionMenu(event, data) {
  const [name, id] = data.split('|');
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Manage Owner",
    contents: { type: "bubble", size: "sm", body: { type: "box", layout: "vertical", spacing: "md", contents: [
      { type: "text", text: `Owner: ${name}`, weight: "bold" },
      { type: "button", style: "primary", color: "#FF4B4B", action: { type: "message", label: "🗑️ ลบข้อมูล", text: `DELETE_OWNER:${id}` } },
      { type: "button", style: "primary", action: { type: "message", label: "✏️ แก้ไขชื่อ", text: `RENAME_OWNER:${id}|[พิมพ์ชื่อใหม่]` } }
    ] } }
  });
}

function sendConfirmMatch(event, oName, oId, bName, bId) {
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Confirm",
    contents: { type: "bubble", body: { type: "box", layout: "vertical", spacing: "md", contents: [
      { type: "text", text: "ยืนยันจับคู่", weight: "bold", align: "center" },
      { type: "text", text: `👤 ${oName}\n📍 ${bName}`, wrap: true, align: "center" },
      { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "✅ ตกลง", text: `DO_MATCH:${oId}|${bId}` } }
    ] } }
  });
}

function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Thai Admin System v5.Final running on port ${PORT}`));
