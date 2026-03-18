const { 
  getAdminMenu, 
  getReportSelectionMenu, 
  getBranchSelectMenu, 
  sendMonthlyTotalReport,
  handleBranchReportLogic, 
  sendBranchReport,
  handleMachineReportLogic,
  sendMachineSelector,
  sendMultiMachineSelector,
  sendDateSelector,
  sendMachineDetailReport,
  sendComparisonReport,
  ALPHABET_GROUPS, 
  chunkArray 
} = require('./menu');

const express = require('express');
const line = require('@line/bot-sdk');
const { Pool } = require('pg'); // เปลี่ยนเป็น pg (Postgres)
require('dotenv').config();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

// --- เชื่อมต่อ Railway Postgres โดยตรง ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // จำเป็นมากสำหรับ Railway
});

const app = express();
app.use(express.static('public'));

app.post('/api/add-owner', express.json(), async (req, res) => {
  const { userId, name } = req.body;
  if (!userId || !name) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
  await pool.query(
    'INSERT INTO branch_owners (owner_line_id, owner_name) VALUES ($1, $2) ON CONFLICT (owner_line_id) DO UPDATE SET owner_name = EXCLUDED.owner_name',
    [userId, name]
  );
  return res.json({ message: `บันทึกเจ้าของ: ${name} สำเร็จ` });
});

app.post('/api/add-branch', express.json(), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
  await pool.query('INSERT INTO branches (branch_name) VALUES ($1)', [name]);
  return res.json({ message: `บันทึกสาขา: ${name} สำเร็จ` });
});

app.get('/api/owners', async (req, res) => {
  const result = await pool.query('SELECT owner_line_id, owner_name FROM branch_owners ORDER BY owner_name');
  res.json(result.rows);
});

app.get('/api/branches', async (req, res) => {
  const result = await pool.query('SELECT id, branch_name FROM branches ORDER BY branch_name');
  res.json(result.rows);
});

app.get('/api/owner-branches/:ownerId', async (req, res) => {
  const result = await pool.query('SELECT branch_id FROM owner_branch_mapping WHERE owner_line_id = $1', [req.params.ownerId]);
  res.json(result.rows.map(r => r.branch_id));
});

app.put('/api/owner/:id', express.json(), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
  await pool.query('UPDATE branch_owners SET owner_name = $1 WHERE owner_line_id = $2', [name, req.params.id]);
  res.json({ message: 'แก้ไขสำเร็จ' });
});

app.delete('/api/owner/:id', async (req, res) => {
  await pool.query('DELETE FROM branch_owners WHERE owner_line_id = $1', [req.params.id]);
  res.json({ message: 'ลบสำเร็จ' });
});

app.put('/api/branch/:id', express.json(), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
  await pool.query('UPDATE branches SET branch_name = $1 WHERE id = $2', [name, req.params.id]);
  res.json({ message: 'แก้ไขสำเร็จ' });
});

app.delete('/api/branch/:id', async (req, res) => {
  await pool.query('DELETE FROM branches WHERE id = $1', [req.params.id]);
  res.json({ message: 'ลบสำเร็จ' });
});

app.post('/api/match', express.json(), async (req, res) => {
  const { ownerId, addBranchIds, removeBranchIds } = req.body;
  if (!ownerId) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
  if (removeBranchIds && removeBranchIds.length > 0) {
    await pool.query('DELETE FROM owner_branch_mapping WHERE owner_line_id = $1 AND branch_id = ANY($2)', [ownerId, removeBranchIds]);
  }
  if (addBranchIds && addBranchIds.length > 0) {
    for (const bId of addBranchIds) {
      await pool.query('INSERT INTO owner_branch_mapping (owner_line_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ownerId, bId]);
    }
  }
  res.json({ message: 'บันทึกสำเร็จ' });
});

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then((result) => res.json(result));
});

async function handleEvent(event) {
  if (event.type === 'postback') {
    const data = event.postback.data;
    if (data.startsWith('MACHINE_DATE_SELECT|')) {
      const idsStr = data.split('|')[1];
      const selectedDate = event.postback.params.date;
      return sendComparisonReport(event, idsStr, selectedDate, pool, client); // ส่ง pool แทน supabase
    }
    if (data === 'PROMPT_MATCH') {
      return client.replyMessage(event.replyToken, {
        type: 'flex', altText: 'จับคู่ Owner-สาขา',
        contents: {
          type: 'bubble',
          body: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: 'จับคู่ Owner - สาขา', weight: 'bold', size: 'lg' },
            { type: 'text', text: 'เลือก Owner แล้วจิ้มสาขาที่ต้องการ', size: 'sm', color: '#888888', margin: 'md', wrap: true }
          ]},
          footer: { type: 'box', layout: 'vertical', contents: [
            { type: 'button', style: 'primary', color: '#1DB446', action: { type: 'uri', label: 'เปิดหน้าจับคู่', uri: 'https://liff.line.me/2009523613-hLnRGrZC?mode=match' } }
          ]}
        }
      });
    }
    if (data === 'PROMPT_ADD_OWNER' || data === 'PROMPT_ADD_BRANCH') {
      const isOwner = data === 'PROMPT_ADD_OWNER';
      const liffUrl = `https://liff.line.me/2009523613-hLnRGrZC?mode=${isOwner ? 'owner' : 'branch'}`;
      return client.replyMessage(event.replyToken, {
        type: 'flex', altText: isOwner ? 'จัดการ Owner' : 'จัดการ Branch',
        contents: {
          type: 'bubble',
          body: { type: 'box', layout: 'vertical', contents: [
            { type: 'text', text: isOwner ? 'จัดการ Owner' : 'จัดการ Branch', weight: 'bold', size: 'lg' },
            { type: 'text', text: 'กดปุ่มด้านล่างเพื่อจัดการข้อมูล', size: 'sm', color: '#888888', margin: 'md', wrap: true }
          ]},
          footer: { type: 'box', layout: 'vertical', contents: [
            { type: 'button', style: 'primary', color: '#1DB446', action: { type: 'uri', label: isOwner ? 'เช็ค Owner' : 'เช็ค Branch', uri: liffUrl } }
          ]}
        }
      });
    }
    return null;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return null;
  
  const userText = event.message.text.trim();
  console.log(`[Log] Incoming: "${userText}"`);

  if (userText.toLowerCase() === 'admin') {
    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "Admin Menu",
      contents: getAdminMenu()
    });
  }

  if (userText === 'OWNER_REPORT') { 
    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "Select Report",
      contents: getReportSelectionMenu()
    });
  }
  
  if (userText === 'REPORT_BRANCH_SELECT') {
    return handleBranchReportLogic(event, pool, client);
  }
  if (userText === 'REPORT_MONTHLY_TOTAL') {
    return sendMonthlyTotalReport(event, pool, client);
  }
  if (userText.startsWith('VIEW_REPORT_ID:')) {
    const rawData = userText.replace('VIEW_REPORT_ID:', ''); 
    const [branchId, branchName] = rawData.split('|');
    return sendBranchReport(event, branchId, branchName, pool, client);
  }

  if (userText === 'REPORT_MACHINE_SELECT') {
    return handleMachineReportLogic(event, pool, client);
  }
  
  if (userText.startsWith('SELECT_MACHINE_BRANCH:')) {
    const parts = userText.split(':')[1].split('|');
    return sendMultiMachineSelector(event, parts[0], parts[1], [], pool, client);
  }

  if (userText.startsWith('TOGGLE_MACHINE:')) {
    const raw = userText.split(':')[1];
    const [branchId, branchName, targetId, currentListStr] = raw.split('|');
    let currentList = currentListStr ? currentListStr.split(',') : [];
    
    if (currentList.includes(targetId)) {
        currentList = currentList.filter(id => id !== targetId);
    } else {
        currentList.push(targetId);
    }
    return sendMultiMachineSelector(event, branchId, branchName, currentList, pool, client);
  }

  if (userText.startsWith('CONFIRM_COMPARE:')) {
    const selectedIdsStr = userText.split(':')[1];
    return sendDateSelector(event, selectedIdsStr, client);
  }

  if (userText.startsWith('VIEW_COMPARE_REPORT:')) {
    const [idsStr, date] = userText.split(':')[1].split('|');
    return sendComparisonReport(event, idsStr, date, pool, client);
  }

  if (userText.startsWith('SELECT_MACHINE_ID:')) {
    const parts = userText.split(':')[1].split('|');
    return sendMachineSelector(event, parts[0], parts[1], pool, client);
  }
  if (userText.startsWith('SELECT_DATE_FOR:')) {
    const machineId = userText.split(':')[1];
    return sendDateSelector(event, machineId, client);
  }
  if (userText.startsWith('VIEW_MACHINE_REPORT:')) {
    const parts = userText.split(':')[1].split('|');
    return sendMachineDetailReport(event, parts[0], parts[1], pool, client);
  }

  if (userText.startsWith('AddSuper ')) {
    const adminId = userText.replace('AddSuper ', '').trim();
    // SQL Upsert
    await pool.query('INSERT INTO super_admins (line_user_id, display_name) VALUES ($1, $1) ON CONFLICT (line_user_id) DO NOTHING', [adminId]);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ เพิ่ม Super Admin: ${adminId}` });
  }

  if (userText.startsWith('GRID_OWNER:')) return showGrid(event, 'owner', userText.split(':')[1]);
  if (userText.startsWith('GRID_BRANCH:')) return showGrid(event, 'branch', userText.split(':')[1]);
  if (userText.startsWith('GRID_MAP:')) return showGrid(event, 'map', userText.split(':')[1]);
  if (userText.startsWith('MATCH_STEP1:')) return showGrid(event, 'match_owner', userText.split(':')[1]);

  if (userText.startsWith('DELETE_OWNER:')) {
    await pool.query('DELETE FROM branch_owners WHERE owner_line_id = $1', [userText.split(':')[1]]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ ลบเจ้าของเรียบร้อย' });
  }
  if (userText.startsWith('DELETE_BRANCH:')) {
    await pool.query('DELETE FROM branches WHERE id = $1', [userText.split(':')[1]]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ ลบสาขาเรียบร้อย' });
  }
  if (userText.startsWith('RENAME_OWNER:')) {
    const [id, newName] = userText.replace('RENAME_OWNER:', '').split('|');
    if (!newName || newName === '[ชื่อใหม่]') return null;
    await pool.query('UPDATE branch_owners SET owner_name = $1 WHERE owner_line_id = $2', [newName, id]);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ เปลี่ยนชื่อเจ้าของเป็น ${newName}` });
  }
  if (userText.startsWith('RENAME_BRANCH:')) {
    const [id, newName] = userText.replace('RENAME_BRANCH:', '').split('|');
    if (!newName || newName === '[ชื่อใหม่]') return null;
    await pool.query('UPDATE branches SET branch_name = $1 WHERE id = $2', [newName, id]);
    return client.replyMessage(event.replyToken, { type: 'text', text: `✅ เปลี่ยนชื่อสาขาเป็น ${newName}` });
  }

  if (userText.startsWith('DO_MATCH:')) {
    const [oId, bId] = userText.replace('DO_MATCH:', '').split('|');
    await pool.query('INSERT INTO owner_branch_mapping (owner_line_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [oId, bId]);
    return client.replyMessage(event.replyToken, { type: 'text', text: '✅ จับคู่สำเร็จ' });
  }
  
  // อื่นๆ... (CRUD ที่เหลือเรแก้ให้เป็น SQL หมดแล้วค่ะ)
  if (userText.toUpperCase().startsWith('U') && userText.includes(' ')) return handleCreateOwner(event, userText);
  if (userText.startsWith('Branch ')) return handleCreateBranch(event, userText);
}

// --- ฟังก์ชันดึงข้อมูลแบบ "กันตาย" (Fixed TypeError) ---
async function showGrid(event, type, range, extraData = null) {
  let rows = [];
  try {
    let query = '';
    if (type === 'owner' || type === 'match_owner') query = 'SELECT * FROM branch_owners ORDER BY owner_name';
    else if (type === 'branch' || type === 'match_branch') query = 'SELECT * FROM branches ORDER BY branch_name';
    else if (type === 'map') query = 'SELECT m.*, o.owner_name, b.branch_name FROM owner_branch_mapping m LEFT JOIN branch_owners o ON m.owner_line_id = o.owner_line_id LEFT JOIN branches b ON m.branch_id = b.id';

    const result = await pool.query(query);
    const data = result.rows || []; // ✅ ป้องกัน null.filter ด้วย (data || [])

    const filtered = data.filter(item => {
      const name = item.owner_name || item.branch_name || "";
      return ALPHABET_GROUPS[range].includes(name.charAt(0).toUpperCase());
    });

    if (filtered.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลในหมวดนี้ค่ะ' });

    rows = chunkArray(filtered, 4).map(row => ({
      type: "box", layout: "horizontal", spacing: "xs",
      contents: row.map(i => ({
        type: "text", text: (i.owner_name || i.branch_name).substring(0, 5), size: "xxs", color: "#0000FF", align: "center", decoration: "underline",
        action: { 
          type: "message", 
          label: "sel", 
          text: type.includes('owner') ? `MANAGE_OWNER:${i.owner_name}|${i.owner_line_id}` : `MANAGE_BRANCH:${i.branch_name}|${i.id}` 
        }
      }))
    }));

    return client.replyMessage(event.replyToken, { type: "flex", altText: "Grid", contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: rows } } });
  } catch (err) {
    console.error(err);
    return client.replyMessage(event.replyToken, { type: 'text', text: 'ฐานข้อมูลมีปัญหาค่ะบอส!' });
  }
}

async function handleCreateOwner(event, text) {
  const parts = text.split(' ');
  const id = parts[0].trim();
  const name = parts.slice(1).join(' ').trim();
  await pool.query('INSERT INTO branch_owners (owner_line_id, owner_name) VALUES ($1, $2) ON CONFLICT (owner_line_id) DO UPDATE SET owner_name = EXCLUDED.owner_name', [id, name]);
  return client.replyMessage(event.replyToken, { type: 'text', text: `✅ บันทึกเจ้าของ: ${name}` });
}

async function handleCreateBranch(event, text) {
  const name = text.replace('Branch ', '').trim();
  await pool.query('INSERT INTO branches (branch_name) VALUES ($1)', [name]);
  return client.replyMessage(event.replyToken, { type: 'text', text: `✅ บันทึกสาขา: ${name}` });
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`90Shop on Railway Postgres running on port ${PORT}`));