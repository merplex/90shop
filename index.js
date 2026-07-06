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
  getPointReportMenu,
  handlePointReportLogic,
  sendPointReport,
  ALPHABET_GROUPS,
  chunkArray
} = require('./menu');

const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
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
// no-store บนไฟล์ .html กัน LINE in-app browser cache หน้าเก่าค้างไว้หลัง deploy
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

pool.query(`
  CREATE TABLE IF NOT EXISTS balance_requests (
    id SERIAL PRIMARY KEY,
    machine_id TEXT NOT NULL,
    branch_id UUID REFERENCES branches(id),
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
  )
`).catch(err => console.error('[DB Init Error]', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS point_events (
    id SERIAL PRIMARY KEY,
    machine_id TEXT NOT NULL,
    branch_id UUID REFERENCES branches(id),
    points INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('earn', 'redeem')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(err => console.error('[DB Init Error]', err.message));

// --- 90railway: รายงานยอดสะสม/ใช้แต้ม แยกตามสาขา (ไม่ผูกกับ LINE user) ---
// machine_id format เดียวกับ /api/transaction: {BRANCH_CODE}_{NUMBER}
app.post('/api/point-event', express.json(), async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.ESP32_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { machine_id, points, type } = req.body;
  if (!machine_id || !points || !['earn', 'redeem'].includes(type)) {
    return res.status(400).json({ error: 'ต้องมี: machine_id, points, type (earn|redeem)' });
  }

  const underscoreIdx = machine_id.lastIndexOf('_');
  if (underscoreIdx <= 0) {
    return res.status(400).json({ error: 'machine_id format ผิด ต้องเป็น {BRANCH}_{NUMBER} เช่น RABB01_01' });
  }
  const branchCode = machine_id.substring(0, underscoreIdx);

  try {
    let branchRes = await pool.query('SELECT id FROM branches WHERE branch_name = $1', [branchCode]);
    if (branchRes.rows.length === 0) {
      branchRes = await pool.query('INSERT INTO branches (branch_name) VALUES ($1) RETURNING id', [branchCode]);
    }
    const branchId = branchRes.rows[0].id;

    await pool.query(
      'INSERT INTO point_events (machine_id, branch_id, points, type) VALUES ($1, $2, $3, $4)',
      [machine_id, branchId, parseInt(points), type]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[Point Event Error]', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดใน server' });
  }
});

app.post('/api/add-owner', express.json(), async (req, res) => {
  const { userId, name } = req.body;
  if (!userId || !name) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
  const dupName = await pool.query('SELECT 1 FROM branch_owners WHERE owner_name = $1 AND owner_line_id != $2', [name, userId]);
  if (dupName.rows.length > 0) return res.status(409).json({ message: `ชื่อ "${name}" มีอยู่แล้ว` });
  await pool.query(
    'INSERT INTO branch_owners (owner_line_id, owner_name) VALUES ($1, $2) ON CONFLICT (owner_line_id) DO UPDATE SET owner_name = EXCLUDED.owner_name',
    [userId, name]
  );
  return res.json({ message: `บันทึกเจ้าของ: ${name} สำเร็จ` });
});

app.post('/api/add-branch', express.json(), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'ข้อมูลไม่ครบ' });
  const dupName = await pool.query('SELECT 1 FROM branches WHERE branch_name = $1', [name]);
  if (dupName.rows.length > 0) return res.status(409).json({ message: `ชื่อสาขา "${name}" มีอยู่แล้ว` });
  await pool.query('INSERT INTO branches (branch_name) VALUES ($1)', [name]);
  return res.json({ message: `บันทึกสาขา: ${name} สำเร็จ` });
});

app.get('/api/owners', async (req, res) => {
  const result = await pool.query('SELECT owner_line_id, owner_name FROM branch_owners ORDER BY owner_name');
  res.json(result.rows);
});

// debug endpoint — ดู branches + mapping ว่า orphan ไหม
app.get('/api/debug/mapping', async (req, res) => {
  const [branches, mapping] = await Promise.all([
    pool.query('SELECT id, branch_name FROM branches ORDER BY id'),
    pool.query(`SELECT m.owner_line_id, o.owner_name, m.branch_id, b.branch_name as mapped_branch
                FROM owner_branch_mapping m
                LEFT JOIN branch_owners o ON m.owner_line_id = o.owner_line_id
                LEFT JOIN branches b ON m.branch_id = b.id
                ORDER BY m.owner_line_id`)
  ]);
  res.json({ branches: branches.rows, mapping: mapping.rows });
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
  const dupName = await pool.query('SELECT 1 FROM branch_owners WHERE owner_name = $1 AND owner_line_id != $2', [name, req.params.id]);
  if (dupName.rows.length > 0) return res.status(409).json({ message: `ชื่อ "${name}" มีอยู่แล้ว` });
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
  const dupName = await pool.query('SELECT 1 FROM branches WHERE branch_name = $1 AND id != $2', [name, req.params.id]);
  if (dupName.rows.length > 0) return res.status(409).json({ message: `ชื่อสาขา "${name}" มีอยู่แล้ว` });
  await pool.query('UPDATE branches SET branch_name = $1 WHERE id = $2', [name, req.params.id]);
  res.json({ message: 'แก้ไขสำเร็จ' });
});

app.delete('/api/branch/:id', async (req, res) => {
  await pool.query('DELETE FROM branches WHERE id = $1', [req.params.id]);
  res.json({ message: 'ลบสำเร็จ' });
});

// --- ESP32: รับยอดสรุปรายชั่วโมงจากเครื่อง ---
// machine_id format: {BRANCH_CODE}_{NUMBER}  เช่น RABB01_01
// unique key = (machine_id, period_start) — retry ด้วยข้อมูลเดิมปลอดภัย
app.post('/api/transaction', express.json(), async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.ESP32_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { machine_id, period_start, period_end, coin = 0, bank = 0, qr = 0 } = req.body;

  if (!machine_id || !period_start || !period_end) {
    return res.status(400).json({ error: 'ต้องมี: machine_id, period_start, period_end' });
  }

  const underscoreIdx = machine_id.lastIndexOf('_');
  if (underscoreIdx <= 0) {
    return res.status(400).json({ error: 'machine_id format ผิด ต้องเป็น {BRANCH}_{NUMBER} เช่น RABB01_01' });
  }
  const branchCode = machine_id.substring(0, underscoreIdx);

  try {
    let branchRes = await pool.query('SELECT id FROM branches WHERE branch_name = $1', [branchCode]);
    if (branchRes.rows.length === 0) {
      branchRes = await pool.query('INSERT INTO branches (branch_name) VALUES ($1) RETURNING id', [branchCode]);
    }
    const branchId = branchRes.rows[0].id;

    const overlap = await pool.query(
      `SELECT 1 FROM hourly_summary
       WHERE machine_id = $1 AND period_start < $3::timestamptz AND period_end > $2::timestamptz
       LIMIT 1`,
      [machine_id, period_start, period_end]
    );
    if (overlap.rows.length > 0) {
      return res.json({ success: false, inserted: false, message: 'ช่วงเวลาทับซ้อนกับข้อมูลเดิม' });
    }

    const insertRes = await pool.query(
      `INSERT INTO hourly_summary (machine_id, branch_id, period_start, period_end, coin, bank, qr)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7)
       ON CONFLICT (machine_id, period_start) DO NOTHING`,
      [machine_id, branchId, period_start, period_end, parseInt(coin)||0, parseInt(bank)||0, parseInt(qr)||0]
    );

    const inserted = insertRes.rowCount > 0;
    return res.json({ success: true, inserted, message: inserted ? 'บันทึกสำเร็จ' : 'ข้อมูลซ้ำ ข้ามแล้ว' });
  } catch (err) {
    console.error('[ESP32 Transaction Error]', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดใน server' });
  }
});

// ESP32 ถาม: "server รู้จักข้อมูลของเครื่องนี้ถึงเมื่อไหร่แล้ว?"
app.get('/api/machine-status/:machineId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT MAX(period_end) as last_period_end FROM hourly_summary WHERE machine_id = $1',
      [req.params.machineId]
    );
    return res.json({
      machine_id: req.params.machineId,
      last_period_end: result.rows[0].last_period_end || null
    });
  } catch (err) {
    console.error('[Machine Status Error]', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// ยืนยันตัวตนกับ LINE เอง (ห้ามเชื่อ userId ที่ client ส่งมาตรงๆ เพราะปลอมได้)
async function verifyLineUser(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.data.userId || null;
  } catch (e) {
    return null;
  }
}

// --- จัดการยอดเงิน: รายชื่อสาขาเฉพาะของ LINE user นี้ (super admin เห็นทุกสาขา) ---
app.get('/api/my-branches', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    const userId = await verifyLineUser(accessToken);
    if (!userId) {
      return res.status(401).json({ message: 'ยืนยันตัวตนไม่สำเร็จ กรุณาเข้า LIFF ใหม่อีกครั้ง' });
    }

    const superAdmin = await pool.query('SELECT 1 FROM super_admins WHERE line_user_id = $1', [userId]);
    if (superAdmin.rows.length > 0) {
      const all = await pool.query('SELECT id, branch_name FROM branches ORDER BY branch_name');
      return res.json(all.rows);
    }

    const owned = await pool.query(
      `SELECT b.id, b.branch_name FROM owner_branch_mapping m
       JOIN branches b ON m.branch_id = b.id
       WHERE m.owner_line_id = $1
       ORDER BY b.branch_name`,
      [userId]
    );
    res.json(owned.rows);
  } catch (e) {
    console.error('[my-branches Error]', e.message);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการโหลดสาขา' });
  }
});

// --- จัดการยอดเงิน: รายชื่อเครื่องของสาขา (สำหรับหน้าเลือกสาขา/เครื่อง) ---
app.get('/api/machines/:branchId', async (req, res) => {
  const branchId = req.params.branchId; // branches.id เป็น UUID ไม่ใช่ตัวเลข
  if (!branchId) return res.status(400).json({ message: 'รหัสสาขาไม่ถูกต้อง' });
  try {
    const result = await pool.query(
      'SELECT DISTINCT machine_id FROM hourly_summary WHERE branch_id = $1 ORDER BY machine_id',
      [branchId]
    );
    res.json(result.rows.map(r => r.machine_id));
  } catch (e) {
    console.error('[machines Error]', e.message);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการโหลดรายชื่อเครื่อง' });
  }
});

// --- จัดการยอดเงิน: LIFF ส่งคำสั่งเติมยอดให้เครื่อง (สร้างรายการ pending) ---
// ต้องเป็น super admin หรือเจ้าของสาขานั้นจริง (ยืนยันด้วย access token กับ LINE ก่อนเช็คสิทธิ์)
app.post('/api/balance/request', express.json(), async (req, res) => {
  const { machineId, branchId, amount, accessToken } = req.body;
  const amt = parseInt(amount, 10);
  if (!machineId || !branchId || !amt || amt <= 0) {
    return res.status(400).json({ message: 'ข้อมูลไม่ครบหรือจำนวนเงินไม่ถูกต้อง' });
  }

  try {
    const userId = await verifyLineUser(accessToken);
    if (!userId) {
      return res.status(401).json({ message: 'ยืนยันตัวตนไม่สำเร็จ กรุณาเข้า LIFF ใหม่อีกครั้ง' });
    }

    const superAdmin = await pool.query('SELECT 1 FROM super_admins WHERE line_user_id = $1', [userId]);
    if (superAdmin.rows.length === 0) {
      const ownerMatch = await pool.query(
        'SELECT 1 FROM owner_branch_mapping WHERE owner_line_id = $1 AND branch_id = $2',
        [userId, branchId]
      );
      if (ownerMatch.rows.length === 0) {
        return res.status(403).json({ message: 'คุณไม่มีสิทธิ์จัดการยอดเงินของสาขานี้' });
      }
    }

    await pool.query(
      'INSERT INTO balance_requests (machine_id, branch_id, amount, requested_by) VALUES ($1, $2, $3, $4)',
      [machineId, branchId, amt, userId]
    );
    return res.json({ message: `ส่งคำสั่งเติม ฿${amt.toLocaleString()} ไปยังเครื่อง ${machineId} สำเร็จ` });
  } catch (e) {
    console.error('[balance/request Error]', e.message);
    return res.status(500).json({ message: 'เกิดข้อผิดพลาดในการส่งคำสั่ง' });
  }
});

// --- ESP32/HMI: endpoint เดียวกับโปรเจค 90railway (/machine/check, /machine/confirm) ---
// ใช้ contract เดิมเป๊ะ (query param, ชื่อ field "points", ไม่ต้องใช้ x-api-key)
// เพื่อให้เฟิร์มแวร์ ESP32 ที่มีอยู่แล้วทำงานกับ 90shop ได้โดยไม่ต้องแก้โค้ดฝั่งเครื่อง
app.get('/machine/check', async (req, res) => {
  const machine_id = req.query.machine_id || '';
  try {
    const result = await pool.query(
      `SELECT id, amount, status FROM balance_requests
       WHERE machine_id = $1 AND (
           (status = 'pending' AND created_at >= NOW() - INTERVAL '70 seconds')
           OR (status = 'success' AND confirmed_at >= NOW() - INTERVAL '30 seconds')
       )
       ORDER BY created_at DESC LIMIT 1`,
      [machine_id]
    );
    if (result.rows.length === 0) return res.json({ status: 'idle' });
    const row = result.rows[0];
    if (row.status === 'success') return res.json({ status: 'success', log_id: row.id, points: row.amount });
    res.json({ status: 'pending', log_id: row.id, points: row.amount });
  } catch (e) {
    console.error('[machine/check Error]', e.message);
    res.status(500).json({ status: 'error' });
  }
});

app.post('/machine/confirm', express.json(), async (req, res) => {
  const { log_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE balance_requests SET status = 'success', confirmed_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [log_id]
    );
    if (result.rows.length === 0) return res.status(400).json({ success: false });
    res.json({ success: true });
  } catch (e) {
    console.error('[machine/confirm Error]', e.message);
    res.status(500).json({ success: false });
  }
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
    return null;
  }

  if (event.type !== 'message' || event.message.type !== 'text') return null;
  
  const userText = event.message.text.trim();
  console.log(`[Log] Incoming: "${userText}"`);

  if (userText === 'dbcheck') {
    const [br, mp] = await Promise.all([
      pool.query('SELECT id, branch_name FROM branches ORDER BY id'),
      pool.query(`SELECT m.owner_line_id, o.owner_name, m.branch_id, b.branch_name as bn
                  FROM owner_branch_mapping m
                  LEFT JOIN branch_owners o ON m.owner_line_id = o.owner_line_id
                  LEFT JOIN branches b ON m.branch_id = b.id`)
    ]);
    const branchLines = br.rows.map(r => `id=${r.id} "${r.branch_name}"`).join('\n');
    const mapLines = mp.rows.map(r => `${r.owner_name}(${r.owner_line_id?.slice(-4)}) → branch_id=${r.branch_id} "${r.bn ?? 'NULL(orphan)'}"`).join('\n');
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `[branches]\n${branchLines || 'ว่าง'}\n\n[mapping]\n${mapLines || 'ว่าง'}`
    });
  }

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

  if (userText === 'POINT_REPORT_MENU') {
    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "รายงานแต้มสะสม",
      contents: getPointReportMenu()
    });
  }
  if (userText.startsWith('POINT_REPORT_SELECT:')) {
    const type = userText.split(':')[1];
    return handlePointReportLogic(event, type, pool, client);
  }
  if (userText.startsWith('VIEW_POINT_REPORT:')) {
    const rawData = userText.replace('VIEW_POINT_REPORT:', '');
    const [type, branchId, branchName] = rawData.split('|');
    return sendPointReport(event, type, branchId, branchName, pool, client);
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