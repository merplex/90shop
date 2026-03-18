const ALPHABET_GROUPS = {
  "A-B": "AB".split(""), "C-D": "CD".split(""), "E-F": "EF".split(""),
  "G-H": "GH".split(""), "I-J": "IJ".split(""), "K-L": "KL".split(""),
  "M-N": "MN".split(""), "O-P": "OP".split(""), "Q-R": "QR".split(""),
  "S-T": "ST".split(""), "U-V": "UV".split(""), "W-Z": "WXYZ".split("")
};

// --- 1. เมนูหลัก ---
function getAdminMenu() {
  return {
    type: "carousel",
    contents: [
      {
        type: "bubble",
        header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "1. เมนูสร้าง", weight: "bold", color: "#1DB446", size: "lg" }] },
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "👤 สร้าง Owner", data: "PROMPT_ADD_OWNER", displayText: "สร้าง Owner" } },
            { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "📍 สร้าง Branch", data: "PROMPT_ADD_BRANCH", displayText: "สร้าง Branch" } },
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
}

function getReportSelectionMenu() {
  return {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: "📈 ระบบรายงาน", color: "#ffffff", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#00b900", action: { type: "message", label: "รายงานต่อสาขา", text: "REPORT_BRANCH_SELECT" } },
        { type: "button", style: "secondary", action: { type: "message", label: "รายงานรวมรายเดือน", text: "REPORT_MONTHLY_TOTAL" } },
        { type: "button", style: "secondary", action: { type: "message", label: "รายงานต่อเครื่อง", text: "REPORT_MACHINE_SELECT" } }
      ]
    }
  };
}

// --- 2. รายงานรายสาขา (SQL Version) ---
async function handleBranchReportLogic(event, pool, client) {
  try {
    const res = await pool.query(
      `SELECT m.branch_id, b.branch_name 
       FROM owner_branch_mapping m 
       JOIN branches b ON m.branch_id = b.id 
       WHERE m.owner_line_id = $1`, 
      [event.source.userId]
    );
    const mapping = res.rows || [];
    
    if (mapping.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาที่ผูกกับบัญชีของคุณค่ะ' });
    }
    if (mapping.length === 1) {
      return sendBranchReport(event, mapping[0].branch_id, mapping[0].branch_name, pool, client);
    } else {
      return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: getBranchSelectMenu(mapping) });
    }
  } catch (err) { console.error(err); }
}

function getBranchSelectMenu(mapping) {
  return {
    type: "bubble",
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: "เลือกสาขาที่ต้องการดู", weight: "bold", size: "lg" },
        ...mapping.map(m => ({
          type: "button", style: "secondary", height: "sm",
          action: { type: "message", label: m.branch_name, text: `VIEW_REPORT_ID:${m.branch_id}|${m.branch_name}` }
        }))
      ]
    }
  };
}

async function sendBranchReport(event, branchId, branchName, pool, client) {
  try {
    const res = await pool.query('SELECT * FROM get_branch_stats($1)', [branchId]);
    const stats = res.rows || [];

    if (stats.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `ยังไม่มีข้อมูลธุรกรรมสำหรับสาขา ${branchName} ค่ะ` });
    }

    const machineData = {};
    const branchSummary = {
      coin: { day: 0, week: 0, month: 0, all: 0 },
      bank: { day: 0, week: 0, month: 0, all: 0 },
      qr: { day: 0, week: 0, month: 0, all: 0 }
    };

    stats.forEach(row => {
      const mId = row.machine_id;
      const type = row.payment_type ? row.payment_type.toLowerCase() : 'coin';

      if (!machineData[mId]) {
        machineData[mId] = {
          coin: { day: 0, week: 0, month: 0, all: 0 },
          bank: { day: 0, week: 0, month: 0, all: 0 },
          qr: { day: 0, week: 0, month: 0, all: 0 }
        };
      }

      if (machineData[mId][type]) {
          machineData[mId][type].day = parseInt(row.day_total);
          machineData[mId][type].week = parseInt(row.week_total);
          machineData[mId][type].month = parseInt(row.month_total);
          machineData[mId][type].all = parseInt(row.all_total);
      }

      if (branchSummary[type]) {
          branchSummary[type].day += parseInt(row.day_total);
          branchSummary[type].week += parseInt(row.week_total);
          branchSummary[type].month += parseInt(row.month_total);
          branchSummary[type].all += parseInt(row.all_total);
      }
    });

    const machineRows = [];
    Object.keys(machineData).sort().forEach((mId, index) => {
      const d = machineData[mId];
      if (index > 0) machineRows.push({ type: "separator", margin: "xl" });
      machineRows.push({
        type: "box", layout: "vertical", margin: "md", spacing: "sm",
        contents: [
          { type: "text", text: `📟 เครื่อง: ${mId}`, weight: "bold", size: "md", color: "#111111" },
          createSummaryRow("🪙 เหรียญ", d.coin),
          createSummaryRow("💵 ธนบัตร", d.bank),
          createSummaryRow("📱 QR Code", d.qr)
        ]
      });
    });

    const flexAllMachines = {
      type: "bubble",
      size: "giga",
      header: { type: "box", layout: "vertical", backgroundColor: "#333333", contents: [{ type: "text", text: `📋 รายงานแยกเครื่อง: ${branchName}`, color: "#ffffff", weight: "bold" }] },
      body: { type: "box", layout: "vertical", contents: machineRows }
    };

    const flexSummary = {
      type: "bubble",
      size: "giga",
      header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: `🏆 สรุปภาพรวมสาขา: ${branchName}`, color: "#ffffff", weight: "bold" }] },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "ยอดรวมทุกเครื่องแยกประเภท", weight: "bold", size: "sm" },
          createSummaryRow("🪙 เหรียญรวม", branchSummary.coin),
          createSummaryRow("💵 ธนบัตรรวม", branchSummary.bank),
          createSummaryRow("📱 QR รวม", branchSummary.qr),
          { type: "separator" },
          { type: "text", text: "* ว:24ชม. / ส:7วัน / ด:30วัน / รวม:ทั้งหมด", size: "xxs", color: "#aaaaaa" }
        ]
      }
    };

    return client.replyMessage(event.replyToken, [
      { type: "flex", altText: "รายงานรายเครื่องละเอียด", contents: flexAllMachines },
      { type: "flex", altText: "สรุปภาพรวมสาขา", contents: flexSummary }
    ]);
  } catch (err) { console.error(err); }
}

// --- 3. รายงานรายเดือน (SQL Version) ---
async function sendYearlySummaryReport(event, pool, client) {
  try {
    const res = await pool.query('SELECT * FROM get_owner_yearly_stats($1)', [event.source.userId]);
    const stats = res.rows || [];

    if (stats.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลธุรกรรมค่ะ' });

    const branchMap = {};
    stats.forEach(item => {
      if (!branchMap[item.branch_id]) branchMap[item.branch_id] = { name: item.branch_name, data: [] };
      branchMap[item.branch_id].data.push(item);
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const lastYear = currentYear - 1;

    const branchBubbles = Object.keys(branchMap).map(bId => {
      const branch = branchMap[bId];
      let totalAll = 0;
      const monthlyRows = [];
      for (let mIdx = 0; mIdx <= 11; mIdx++) {
        const targetYear = (mIdx <= now.getMonth()) ? currentYear : lastYear;
        const match = branch.data.find(d => parseInt(d.month) === (mIdx + 1) && parseInt(d.year) === targetYear);
        const amount = match ? parseInt(match.total_amount) : 0;
        if (amount > 0 || mIdx <= now.getMonth() || targetYear === lastYear) {
           totalAll += amount;
           const textColor = amount > 0 ? "#000000" : "#cccccc";
           const textWeight = amount > 0 ? "bold" : "regular";
           monthlyRows.push({ type: "box", layout: "horizontal", contents: [{ type: "text", text: new Date(0, mIdx).toLocaleString('th-TH', { month: 'short' }) + ` (${targetYear + 543})`, size: "sm", color: "#888888" }, { type: "text", text: `฿${amount.toLocaleString()}`, align: "end", size: "sm", weight: textWeight, color: textColor }] });
        }
      }
      return { type: "bubble", header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: `📍 สาขา: ${branch.name}`, color: "#ffffff", weight: "bold" }] }, body: { type: "box", layout: "vertical", spacing: "sm", contents: [{ type: "text", text: "สรุปยอดรายเดือน", size: "xs", weight: "bold", color: "#aaaaaa" }, { type: "separator", margin: "sm" }, ...monthlyRows, { type: "separator", margin: "md" }, { type: "box", layout: "horizontal", margin: "md", contents: [{ type: "text", text: "รวมยอดทั้งปี", weight: "bold", size: "sm" }, { type: "text", text: `฿${totalAll.toLocaleString()}`, align: "end", weight: "bold", color: "#1DB446" }] }] } };
    });
    return client.replyMessage(event.replyToken, { type: "flex", altText: "รายงานรายปี", contents: { type: "carousel", contents: branchBubbles.slice(0, 10) } });
  } catch (err) { console.error(err); }
}

// --- 4. รายงานเปรียบเทียบเครื่อง (Multiselect + Pink Theme) ---
async function handleMachineReportLogic(event, pool, client) {
  const res = await pool.query(
    `SELECT m.branch_id, b.branch_name 
     FROM owner_branch_mapping m 
     JOIN branches b ON m.branch_id = b.id 
     WHERE m.owner_line_id = $1`, 
    [event.source.userId]
  );
  const mapping = res.rows || [];
  
  if (mapping.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาค่ะ' });

  const bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#FF1493", contents: [{ type: "text", text: "🏩 เลือกสาขา (เปรียบเทียบ)", color: "#ffffff", weight: "bold", size: "lg" }] },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: mapping.map(m => ({
        type: "button", style: "secondary", height: "sm",
        action: { type: "message", label: m.branch_name, text: `SELECT_MACHINE_BRANCH:${m.branch_id}|${m.branch_name}` }
      }))
    }
  };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: bubble });
}

async function sendMultiMachineSelector(event, branchId, branchName, selectedIds, pool, client) {
  const res = await pool.query('SELECT DISTINCT machine_id FROM transactions WHERE branch_id = $1 ORDER BY machine_id', [branchId]);
  const uniqueMachines = (res.rows || []).map(r => r.machine_id);

  if (uniqueMachines.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: `ไม่พบเครื่องในสาขา ${branchName} ค่ะ` });

  const currentListStr = selectedIds.join(',');
  const machineRows = uniqueMachines.map(mId => {
    const isSelected = selectedIds.includes(mId);
    return {
      type: "box", layout: "horizontal", margin: "sm", spacing: "sm",
      contents: [
        { type: "text", text: `เครื่อง ${mId}`, size: "sm", gravity: "center", flex: 4, color: isSelected ? "#000000" : "#555555", weight: isSelected ? "bold" : "regular" },
        { type: "button", style: "secondary", height: "sm", flex: 2, action: { type: "message", label: isSelected ? "✅" : "⬜", text: `TOGGLE_MACHINE:${branchId}|${branchName}|${mId}|${currentListStr}` } }
      ]
    };
  });

  const chunks = chunkArray(machineRows, 10);
  const bubbles = chunks.map(chunk => ({
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#FF1493", contents: [{ type: "text", text: `🔢 เลือกเครื่องเทียบ (${branchName})`, color: "#ffffff", weight: "bold" }, { type: "text", text: `เลือกแล้ว: ${selectedIds.length} เครื่อง`, color: "#ffffff", size: "xs" }] },
    body: { type: "box", layout: "vertical", contents: chunk },
    footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "primary", color: "#000000", margin: "sm", action: { type: "message", label: selectedIds.length > 0 ? `🚀 เทียบยอด (${selectedIds.length})` : "กรุณาเลือกเครื่อง", text: selectedIds.length > 0 ? `CONFIRM_COMPARE:${currentListStr}` : "ยังไม่ได้เลือกเครื่อง" } }] }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกเครื่อง", contents: { type: "carousel", contents: bubbles } });
}

async function sendComparisonReport(event, idsStr, dateStr, pool, client) {
  try {
    const machineIds = idsStr.split(','); // แปลง "m1,m2" เป็น ["m1", "m2"]
    
    // ปรับรูปแบบวันที่ให้ชัวร์สำหรับ Postgres
    const startTime = `${dateStr} 00:00:00`;
    const endTime = `${dateStr} 23:59:59`;
    
    console.log(`[Compare] Date: ${dateStr}, IDs: ${idsStr}`);

    // SQL: ใช้ ANY($1) เพื่อเช็กค่าใน List และกรองวันที่
    const res = await pool.query(
      `SELECT machine_id, SUM(amount) as total 
       FROM transactions 
       WHERE machine_id = ANY($1) 
       AND created_at >= $2::timestamp 
       AND created_at <= $3::timestamp 
       GROUP BY machine_id`,
      [machineIds, startTime, endTime]
    );
    
    const stats = res.rows || [];
    const summary = {};
    
    // ตั้งค่าเริ่มต้นให้ทุกเครื่องเป็น 0 (เผื่อเครื่องไหนไม่มีค่ายอดขายในวันนั้น)
    machineIds.forEach(id => summary[id] = 0);
    stats.forEach(t => summary[t.machine_id] = parseInt(t.total));
    
    const niceDate = new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
    
    // สร้างแถวข้อมูลเครื่อง
    const rows = machineIds.map(id => ({
      type: "box", layout: "horizontal", margin: "sm",
      contents: [
        { type: "text", text: `เครื่อง ${id}`, size: "sm", color: "#555555", flex: 6 },
        { type: "text", text: `฿${(summary[id] || 0).toLocaleString()}`, size: "sm", color: "#000000", weight: "bold", align: "end", flex: 4 }
      ]
    }));

    const grandTotal = Object.values(summary).reduce((a, b) => a + b, 0);

    const bubble = {
      type: "bubble",
      header: { 
        type: "box", layout: "vertical", backgroundColor: "#333333", 
        contents: [
          { type: "text", text: `📊 เปรียบเทียบยอดขาย`, color: "#ffffff", weight: "bold" },
          { type: "text", text: `วันที่: ${niceDate}`, color: "#ffffff", size: "sm" }
        ] 
      },
      body: { 
        type: "box", layout: "vertical", spacing: "sm", 
        contents: [
          ...rows, 
          { type: "separator", margin: "md" }, 
          { 
            type: "box", layout: "horizontal", margin: "md", 
            contents: [
              { type: "text", text: "รวมทั้งหมด", weight: "bold", color: "#FF1493" },
              { type: "text", text: `฿${grandTotal.toLocaleString()}`, weight: "bold", align: "end", color: "#FF1493" }
            ] 
          }
        ] 
      },
      footer: { 
        type: "box", layout: "vertical", 
        contents: [{ type: "button", style: "link", action: { type: "message", label: "🔙 เลือกวันอื่น", text: `CONFIRM_COMPARE:${idsStr}` } }] 
      }
    };

    return client.replyMessage(event.replyToken, { type: "flex", altText: "รายงานเปรียบเทียบ", contents: bubble });

  } catch (err) {
    console.error("Comparison Report Error:", err);
    return client.replyMessage(event.replyToken, { type: 'text', text: 'เกิดข้อผิดพลาดในการคำนวณยอดเปรียบเทียบค่ะบอส!' });
  }
}

// --- Helpers ---
function createSummaryRow(label, data) {
  return {
    type: "box", layout: "vertical", spacing: "xs", margin: "sm",
    contents: [
      { type: "text", text: label, size: "xs", weight: "bold", color: "#555555" },
      {
        type: "box", layout: "horizontal",
        contents: [
          { type: "text", text: `ว: ${data.day.toLocaleString()}`, size: "xxs", color: "#1DB446", flex: 2 },
          { type: "text", text: `ส: ${data.week.toLocaleString()}`, size: "xxs", color: "#FF9900", flex: 2 },
          { type: "text", text: `ด: ${data.month.toLocaleString()}`, size: "xxs", color: "#0099FF", flex: 2 },
          { type: "text", text: `รวม: ${data.all.toLocaleString()}`, size: "xxs", color: "#000000", weight: "bold", align: "end", flex: 3 }
        ]
      }
    ]
  };
}

// --- 4.3 เลือกวันที่ (เพิ่มกลับเข้าไปให้บอทหาย Error ค่ะ) ---
async function sendDateSelector(event, idsStr, client) {
  if (!idsStr) return;
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0];

  const bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#FF1493", contents: [{ type: "text", text: `📅 เลือกวันที่ดูรายงาน`, color: "#ffffff", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        { type: "button", style: "primary", color: "#FF1493", action: { type: "message", label: "วันนี้", text: `VIEW_COMPARE_REPORT:${idsStr}|${today}` } },
        { type: "button", style: "secondary", action: { type: "message", label: "เมื่อวาน", text: `VIEW_COMPARE_REPORT:${idsStr}|${yesterday}` } },
        { type: "separator" },
        { type: "button", style: "secondary", action: { type: "datetimepicker", label: "เลือกวันที่เอง 🗓️", data: `MACHINE_DATE_SELECT|${idsStr}`, mode: "date" } }
      ]
    }
  };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกวันที่", contents: bubble });
}

function chunkArray(arr, s) { const res = []; for (let i = 0; i < arr.length; i += s) res.push(arr.slice(i, i + s)); return res; }

module.exports = {
  getAdminMenu,
  getReportSelectionMenu,
  getBranchSelectMenu,
  sendBranchReport,
  sendMonthlyTotalReport: sendYearlySummaryReport,
  handleBranchReportLogic,
  handleMachineReportLogic,
  sendMultiMachineSelector,
  sendComparisonReport,
  sendDateSelector,
  ALPHABET_GROUPS,
  chunkArray
};