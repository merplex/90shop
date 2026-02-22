// index.js
const { 
  getAdminMenu, 
  getReportSelectionMenu, 
  getBranchSelectMenu, 
  sendMonthlyTotalReport,
  handleBranchReportLogic, 
  sendBranchReport,
  // --- เพิ่มฟังก์ชันใหม่ตรงนี้ ---
  handleMachineReportLogic,
  sendMachineSelector,
  sendMultiMachineSelector,
  sendDateSelector,
  sendMachineDetailReport,
  sendComparisonReport,
  // -------------------------
  ALPHABET_GROUPS, 
  chunkArray 
} = require('./menu');

const express = require('express');
const line = require('@line/bot-sdk');
require('dotenv').config();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const app = express();

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then((result) => res.json(result));
});

async function handleEvent(event) {
  // ✅ 1. เพิ่มการรองรับ Postback (สำหรับ Date Picker)
  if (event.type === 'postback') {
    const data = event.postback.data;
    // ถ้าส่งมาจากปฏิทิน ให้ไปหน้ารายงานเปรียบเทียบเลย
    if (data.startsWith('MACHINE_DATE_SELECT|')) {
      const idsStr = data.split('|')[1];
      const selectedDate = event.postback.params.date; // YYYY-MM-DD
      return sendComparisonReport(event, idsStr, selectedDate, supabase, client);
    }
    return null;
  }

  // ถ้าไม่ใช่ข้อความ ให้ข้าม
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  
  const userText = event.message.text.trim();
  console.log(`[Log] Incoming: "${userText}"`);

  // --- 2. Admin Menu (ของเดิม) ---
  if (userText.toLowerCase() === 'admin') {
    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "Admin Menu",
      contents: getAdminMenu()
    });
  }

  // --- 3. Report Menu หลัก ---
  if (userText === 'OWNER_REPORT') { 
    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "Select Report",
      contents: getReportSelectionMenu()
    });
  }
  
  // รายงานสาขา & รายเดือน (ของเดิม)
  if (userText === 'REPORT_BRANCH_SELECT') {
    return handleBranchReportLogic(event, supabase, client);
  }
  if (userText === 'REPORT_MONTHLY_TOTAL') {
    return sendMonthlyTotalReport(event, supabase, client);
  }
  if (userText.startsWith('VIEW_REPORT_ID:')) {
    const rawData = userText.replace('VIEW_REPORT_ID:', ''); 
    const [branchId, branchName] = rawData.split('|');
    return sendBranchReport(event, branchId, branchName, supabase, client);
  }

  // --- 4. Machine Report (เพิ่มใหม่: เลือกเครื่อง & เทียบยอด) ---
  if (userText === 'REPORT_MACHINE_SELECT') {
    return handleMachineReportLogic(event, supabase, client);
  }
  
  // Flow เลือกสาขา -> เลือกหลายเครื่อง
  if (userText.startsWith('SELECT_MACHINE_BRANCH:')) {
    const parts = userText.split(':')[1].split('|');
    return sendMultiMachineSelector(event, parts[0], parts[1], [], supabase, client);
  }

  // Flow ติ๊กเลือกเครื่อง (Toggle)
  if (userText.startsWith('TOGGLE_MACHINE:')) {
    const raw = userText.split(':')[1];
    const [branchId, branchName, targetId, currentListStr] = raw.split('|');
    let currentList = currentListStr ? currentListStr.split(',') : [];
    
    if (currentList.includes(targetId)) {
        currentList = currentList.filter(id => id !== targetId); // เอาออก
    } else {
        currentList.push(targetId); // เพิ่มเข้า
    }
    return sendMultiMachineSelector(event, branchId, branchName, currentList, supabase, client);
  }

  // Flow ยืนยันเครื่อง -> ไปเลือกวันที่
  if (userText.startsWith('CONFIRM_COMPARE:')) {
    const selectedIdsStr = userText.split(':')[1];
    return sendDateSelector(event, selectedIdsStr, client);
  }

  // Flow แสดงรายงานเปรียบเทียบ (เมื่อกดปุ่ม วันนี้/เมื่อวาน)
  if (userText.startsWith('VIEW_COMPARE_REPORT:')) {
    const [idsStr, date] = userText.split(':')[1].split('|');
    return sendComparisonReport(event, idsStr, date, supabase, client);
  }

  // Flow รายงานรายตัว (Legacy: เผื่อเปรมยังใช้ปุ่มเก่า)
  if (userText.startsWith('SELECT_MACHINE_ID:')) {
    const parts = userText.split(':')[1].split('|');
    return sendMachineSelector(event, parts[0], parts[1], supabase, client);
  }
  if (userText.startsWith('SELECT_DATE_FOR:')) {
    const machineId = userText.split(':')[1];
    return sendDateSelector(event, machineId, client);
  }
  if (userText.startsWith('VIEW_MACHINE_REPORT:')) {
    const parts = userText.split(':')[1].split('|');
    return sendMachineDetailReport(event, parts[0], parts[1], supabase, client);
  }


  // --- 5. Logic เดิมของ Admin (CRUD, Grid, Matching) ---
  if (userText === 'เมนูจัดการ') return sendManageMenu(event);

  if (userText.toUpperCase().startsWith('U') && userText.includes(' ')) return handleCreateOwner(event, userText);
  if (userText.startsWith('Branch ')) return handleCreateBranch(event, userText);
  if (userText.startsWith('AddSuper ')) {
    const adminId = userText.replace('AddSuper ', '').trim();
    await supabase.from('super_admins').upsert([{ line_user_id: adminId }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ เพิ่ม Super Admin: ${adminId}` });
  }

  // Alphabet & Grid Selection
  if (userText === 'SELECT_GROUP_Owner') return sendAlphabetMenu(event, 'GRID_OWNER');
  if (userText === 'SELECT_GROUP_Branch') return sendAlphabetMenu(event, 'GRID_BRANCH');
  if (userText === 'SELECT_GROUP_Map') return sendAlphabetMenu(event, 'GRID_MAP');
  if (userText === 'SELECT_GROUP_StartMatch') return sendAlphabetMenu(event, 'MATCH_STEP1');

  if (userText.startsWith('GRID_OWNER:')) return showGrid(event, 'owner', userText.split(':')[1]);
  if (userText.startsWith('GRID_BRANCH:')) return showGrid(event, 'branch', userText.split(':')[1]);
  if (userText.startsWith('GRID_MAP:')) return showGrid(event, 'map', userText.split(':')[1]);

  // Matching Flow
  if (userText.startsWith('MATCH_STEP1:')) return showGrid(event, 'match_owner', userText.split(':')[1]);
  if (userText.startsWith('SEL_OWNER_FOR_MAP:')) {
    const ownerInfo = userText.replace('SEL_OWNER_FOR_MAP:', '');
    return sendAlphabetMenu(event, `MATCH_STEP2|${ownerInfo}`);
  }
  if (userText.startsWith('MATCH_STEP2|')) {
    const mainParts = userText.split('|');
    const ownerName = mainParts[1];
    const subParts = mainParts[2].split(':');
    const ownerId = subParts[0];
    const range = subParts[1];
    return showGrid(event, 'match_branch', range, `${ownerName}|${ownerId}`);
  }
  if (userText.startsWith('CONFIRM_MAP|')) {
    const [_, oName, oId, bName, bId] = userText.split('|');
    return sendConfirmMatch(event, oName, oId, bName, bId);
  }

  // CRUD Actions
  if (userText.startsWith('MANAGE_OWNER:')) return showOwnerActionMenu(event, userText.replace('MANAGE_OWNER:',''));
  if (userText.startsWith('MANAGE_BRANCH:')) return showBranchActionMenu(event, userText.replace('MANAGE_BRANCH:',''));

  if (userText.startsWith('DELETE_OWNER:')) {
    await supabase.from('branch_owners').delete().eq('owner_line_id', userText.split(':')[1]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ ลบเจ้าของเรียบร้อย' });
  }
  if (userText.startsWith('DELETE_BRANCH:')) {
    await supabase.from('branches').delete().eq('id', userText.split(':')[1]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ ลบสาขาเรียบร้อย' });
  }
  if (userText.startsWith('RENAME_OWNER:')) {
    const [id, newName] = userText.replace('RENAME_OWNER:', '').split('|');
    if (!newName || newName === '[ชื่อใหม่]') return null;
    await supabase.from('branch_owners').update({ owner_name: newName }).eq('owner_line_id', id);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ เปลี่ยนชื่อเจ้าของเป็น ${newName}` });
  }
  if (userText.startsWith('RENAME_BRANCH:')) {
    const [id, newName] = userText.replace('RENAME_BRANCH:', '').split('|');
    if (!newName || newName === '[ชื่อใหม่]') return null;
    await supabase.from('branches').update({ branch_name: newName }).eq('id', id);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ เปลี่ยนชื่อสาขาเป็น ${newName}` });
  }

  if (userText.startsWith('DO_MATCH:')) {
    const [oId, bId] = userText.replace('DO_MATCH:', '').split('|');
    await supabase.from('owner_branch_mapping').upsert([{ owner_line_id: oId, branch_id: bId }]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ จับคู่สำเร็จ' });
  }
  if (userText.startsWith('CONFIRM_DEL_MAP:')) {
    const [oId, bId] = userText.replace('CONFIRM_DEL_MAP:', '').split('|');
    await supabase.from('owner_branch_mapping').delete().eq('owner_line_id', oId).eq('branch_id', bId);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ ยกเลิกคู่สำเร็จ' });
  }
}

// --- ฟังก์ชัน UI & Menus (คงของเดิมไว้ทั้งหมด) ---

function sendAdminMenu(event) {
  const flexJson = {
    type: "carousel",
    contents: [
      {
        type: "bubble",
        header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "1. เมนูสร้าง", weight: "bold", color: "#1DB446", size: "lg" }] },
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "👤 สร้าง Owner", text: "U[ID] [ชื่อ]" } },
            { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "📍 สร้าง Branch", text: "Branch [ชื่อ]" } },
            { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "🔑 เพิ่ม Admin", text: "AddSuper [LineID]" } },
            { type: "button", style: "primary", color: "#1DB446", height: "sm", action: { type: "message", label: "🔗 เริ่มจับคู่", text: "SELECT_GROUP_StartMatch" } }
          ]
        }
      },
      {
        type: "bubble",
        header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "2. เมนูจัดการ", weight: "bold", color: "#464a4d", size: "lg" }] },
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "📝 แก้ไข Owner", text: "SELECT_GROUP_Owner" } },
            { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "📍 แก้ไข Branch", text: "SELECT_GROUP_Branch" } },
            { type: "button", style: "primary", color: "#464a4d", height: "sm", action: { type: "message", label: "📋 ดูคู่ (ลบ)", text: "SELECT_GROUP_Map" } }
          ]
        }
      }
    ]
  };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "Admin Menu", contents: flexJson });
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
        action: { type: "message", label: "sel", text: type === 'branch' ? `MANAGE_BRANCH:${b.branch_name}|${b.id}` : `CONFIRM_MAP|${extraData}|${b.branch_name}|${b.id}` }
      }))
    }));
  } else if (type === 'map') {
    const { data } = await supabase.from('owner_branch_mapping').select('*, branch_owners(owner_name), branches(branch_name)');
    const filtered = data.filter(m => ALPHABET_GROUPS[range].includes(m.branches?.branch_name.charAt(0).toUpperCase()));
    rows = chunkArray(filtered, 2).map(row => ({
      type: "box", layout: "horizontal", spacing: "sm",
      contents: row.map(m => ({
        type: "text", text: `${m.branches?.branch_name.substring(0, 5)}:${m.branch_owners?.owner_name.substring(0, 5)}`, size: "xxs", color: "#FF4B4B", align: "center",
        action: { type: "message", label: "del", text: `CONFIRM_DEL_MAP:${m.owner_line_id}|${m.branch_id}` }
      }))
    }));
  }
  return client.replyMessage(event.replyToken, { type: "flex", altText: "Grid View", contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: rows } } });
}

function showOwnerActionMenu(event, data) {
  const [name, id] = data.split('|');
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Menu",
    contents: { 
      type: "bubble", 
      body: { 
        type: "box", layout: "vertical", spacing: "sm", 
        contents: [
          { type: "text", text: `เจ้าของ: ${name}`, weight: "bold" }, 
          { type: "button", style: "primary", color: "#FF4B4B", action: { type: "message", label: "ลบ", text: `DELETE_OWNER:${id}` } }, 
          { type: "button", style: "secondary", action: { type: "message", label: "เปลี่ยนชื่อ", text: `RENAME_OWNER:${id}|[ชื่อใหม่]` } }
        ] 
      } 
    }
  });
}

function showBranchActionMenu(event, data) {
  const [name, id] = data.split('|');
  return client.replyMessage(event.replyToken, {
    type: "flex", altText: "Menu",
    contents: { 
      type: "bubble", 
      body: { 
        type: "box", layout: "vertical", spacing: "sm", 
        contents: [
          { type: "text", text: `สาขา: ${name}`, weight: "bold" }, 
          { type: "button", style: "primary", color: "#FF4B4B", action: { type: "message", label: "ลบสาขา", text: `DELETE_BRANCH:${id}` } },
          { type: "button", style: "secondary", action: { type: "message", label: "เปลี่ยนชื่อสาขา", text: `RENAME_BRANCH:${id}|[ชื่อใหม่]` } }
        ] 
      } 
    }
  });
}

// --- Helper Functions ---

async function handleCreateOwner(event, text) {
  if (text.includes('[ID]') || text.includes('[ชื่อ]')) return null;
  const parts = text.split(' ');
  const id = parts[0].trim();
  const name = parts.slice(1).join(' ').trim();
  if (!id || !name) return null;
  await supabase.from('branch_owners').upsert([{ owner_line_id: id, owner_name: name }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: `✅ บันทึกเจ้าของ: ${name}` });
}

async function handleCreateBranch(event, text) {
  if (text.includes('[ชื่อ]')) return null;
  const name = text.replace('Branch ', '').trim();
  if (!name) return null;
  await supabase.from('branches').insert([{ branch_name: name }]);
  return client.replyMessage(event.replyToken, { type: 'text', text: `✅ บันทึกสาขา: ${name}` });
}

function sendAlphabetMenu(event, prefix) {
  const keys = Object.keys(ALPHABET_GROUPS);
  const rows = chunkArray(keys, 3);
  const flex = { type: "bubble", body: { type: "box", layout: "vertical", spacing: "xs", contents: rows.map(r => ({ type: "box", layout: "horizontal", spacing: "xs", contents: r.map(k => ({ type: "button", style: "secondary", height: "sm", action: { type: "message", label: k, text: `${prefix}:${k}` } })) })) } };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "Select", contents: flex });
}

function sendConfirmMatch(event, oName, oId, bName, bId) {
  const flex = { type: "bubble", body: { type: "box", layout: "vertical", spacing: "md", contents: [{ type: "text", text: `👤 ${oName}\n📍 ${bName}`, wrap: true, align: "center" }, { type: "button", style: "primary", color: "#1DB446", action: { type: "message", label: "✅ ตกลง", text: `DO_MATCH:${oId}|${bId}` } }] } };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "Confirm", contents: flex });
}

function sendManageMenu(event) { return client.replyMessage(event.replyToken, { type: 'text', text: 'พิมพ์ admin เพื่อดูเมนูทั้งหมดค่ะ' }); }

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Thai Admin System v6.2 running on port ${PORT}`));
