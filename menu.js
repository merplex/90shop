// menu.js

const ALPHABET_GROUPS = {
  "A-B": "AB".split(""), "C-D": "CD".split(""), "E-F": "EF".split(""),
  "G-H": "GH".split(""), "I-J": "IJ".split(""), "K-L": "KL".split(""),
  "M-N": "MN".split(""), "O-P": "OP".split(""), "Q-R": "QR".split(""),
  "S-T": "ST".split(""), "U-V": "UV".split(""), "W-Z": "WXYZ".split("")
};

// --- 1. เมนูหลัก Admin (Carousel) ---
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
            { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "👤 สร้าง Owner", text: "U[ID] [ชื่อ]" } },
            { type: "button", style: "secondary", height: "sm", action: { type: "message", label: "📍 สร้าง Branch", text: "Branch [ชื่อ]" } },
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

// --- 2. เมนูเลือกรายงาน (จาก Rich Menu) ---
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

// --- 3. ฟังก์ชัน Logic: จัดการรายงานต่อสาขา ---
// menu.js

// menu.js

async function handleBranchReportLogic(event, supabase, client) {
  try {
    const { data: mapping, error } = await supabase
      .from('owner_branch_mapping')
      .select('branch_id, branches(branch_name)')
      .eq('owner_line_id', event.source.userId);

    if (error || !mapping || mapping.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาที่ผูกกับบัญชีของคุณค่ะ' });
    }

    // กรณีมีแค่ 1 สาขา -> ส่งรายงานทันที
    if (mapping.length === 1) {
      return sendBranchReport(event, mapping[0].branch_id, mapping[0].branches.branch_name, supabase, client);
    } 
    // ✅ เพิ่มตรงนี้: กรณีมีหลายสาขา (mapping.length > 1)
    else {
      return client.replyMessage(event.replyToken, {
        type: "flex", 
        altText: "เลือกสาขา", 
        contents: getBranchSelectMenu(mapping) // เรียกเมนูเลือกสาขาที่เปรมมีอยู่แล้ว
      });
    }

  } catch (err) {
    console.error(err);
  }
}


// --- 4. เมนูเลือกสาขา (กรณีคุมหลายสาขา) ---
function getBranchSelectMenu(mapping) {
  return {
    type: "bubble",
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: "เลือกสาขาที่ต้องการดู", weight: "bold", size: "lg" },
        ...mapping.map(m => ({
          type: "button", style: "secondary", height: "sm",
          action: { 
            type: "message", 
            label: m.branches.branch_name, 
            text: `VIEW_REPORT_ID:${m.branch_id}|${m.branches.branch_name}` 
          }
        }))
      ]
    }
  };
}

// --- 5. Helper Function ---
function chunkArray(arr, s) { 
  const res = []; 
  for (let i = 0; i < arr.length; i += s) res.push(arr.slice(i, i + s)); 
  return res; 
}
async function sendBranchReport(event, branchId, branchName, supabase, client) {
  const { data: logs, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('branch_id', branchId);

  if (error || !logs) return client.replyMessage(event.replyToken, { type: 'text', text: 'คํานวณเงินไม่สำเร็จค่ะ' });

  const now = new Date();
  const machineData = {};
  const branchSummary = {
    coin: { day: 0, week: 0, month: 0 },
    bank: { day: 0, week: 0, month: 0 },
    qr: { day: 0, week: 0, month: 0 }
  };

  // 1. ประมวลผลข้อมูล (คำนวณทั้งรายเครื่องและรายสาขาพร้อมกัน)
  logs.forEach(log => {
    const logDate = new Date(log.created_at);
    const diffDays = Math.ceil(Math.abs(now - logDate) / (1000 * 60 * 60 * 24));
    const mId = log.machine_id;
    const type = log.type; // coin, bank, qr

    // เตรียมโครงสร้างข้อมูลรายเครื่อง (ถ้ายังไม่มี)
    if (!machineData[mId]) {
      machineData[mId] = {
        coin: { day: 0, week: 0, month: 0 },
        bank: { day: 0, week: 0, month: 0 },
        qr: { day: 0, week: 0, month: 0 }
      };
    }

    // เก็บสถิติรายเครื่อง
    if (diffDays <= 1) machineData[mId][type].day += log.amount;
    if (diffDays <= 7) machineData[mId][type].week += log.amount;
    if (diffDays <= 30) machineData[mId][type].month += log.amount;

    // เก็บสถิติสรุปรวมสาขา
    if (diffDays <= 1) branchSummary[type].day += log.amount;
    if (diffDays <= 7) branchSummary[type].week += log.amount;
    if (diffDays <= 30) branchSummary[type].month += log.amount;
  });

  // 2. สร้างเนื้อหา Flex รายงานรายเครื่อง (แบบละเอียด)
  const machineRows = [];
  Object.keys(machineData).forEach((mId, index) => {
    const d = machineData[mId];
    if (index > 0) machineRows.push({ type: "separator", margin: "xl" });

    machineRows.push({
      type: "box", layout: "vertical", margin: "md", spacing: "sm",
      contents: [
        { type: "text", text: `📟 เครื่อง: ${mId}`, weight: "bold", size: "md", color: "#111111" },
        // เรียกใช้ฟังก์ชันช่วยสร้างแถวข้อมูลย่อย (เหรียญ/แบงค์/QR) ของเครื่องนั้นๆ
        createSummaryRow("🪙 เหรียญ", d.coin),
        createSummaryRow("💵 ธนบัตร", d.bank),
        createSummaryRow("📱 QR Code", d.qr)
      ]
    });
  });

  const flexAllMachines = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#333333", contents: [{ type: "text", text: `📋 รายงานแยกเครื่อง: ${branchName}`, color: "#ffffff", weight: "bold" }] },
    body: { type: "box", layout: "vertical", contents: machineRows }
  };

  // 3. สร้าง Flex สรุปภาพรวมสาขา (เหมือนเดิม)
  const flexSummary = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: `🏆 สรุปภาพรวมสาขา: ${branchName}`, color: "#ffffff", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        { type: "text", text: "ยอดรวมทุกเครื่องแยกประเภท", weight: "bold", size: "sm" },
        createSummaryRow("🪙 เหรียญรวม", branchSummary.coin),
        createSummaryRow("💵 ธนบัตรรวม", branchSummary.bank),
        createSummaryRow("📱 QR รวม", branchSummary.qr),
        { type: "separator" },
        { type: "text", text: "* ว:วันนี้ / ส:7วัน / ด:30วัน", size: "xxs", color: "#aaaaaa" }
      ]
    }
  };

async function sendYearlySummaryReport(event, supabase, client) {
  const userId = event.source.userId;

  // 1. หาว่า Owner คนนี้คุมสาขาอะไรบ้าง
  const { data: mapping } = await supabase
    .from('owner_branch_mapping')
    .select('branch_id, branches(branch_name)')
    .eq('owner_line_id', userId);

  if (!mapping || mapping.length === 0) {
    return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาที่ผูกกับบัญชีของคุณค่ะ' });
  }

  const branchIds = mapping.map(m => m.branch_id);
  const branchMap = {}; // ไว้เก็บชื่อสาขาตาม ID
  mapping.forEach(m => branchMap[m.branch_id] = m.branches.branch_name);

  // 2. กำหนดช่วงเวลา (12 เดือนย้อนหลัง)
  const now = new Date();
  const firstDayOfYear = new Date(now.getFullYear(), 0, 1).toISOString(); // เริ่มต้นปีนี้

  // 3. ดึง Transaction ของทุกสาขาในปีนี้
  const { data: transactions } = await supabase
    .from('machine_transactions')
    .select('amount, created_at, branch_id')
    .in('branch_id', branchIds)
    .gte('created_at', firstDayOfYear);

  // 4. จัดกลุ่มข้อมูล [สาขา][เดือน] = ยอดรวม
  const reportData = {};
  branchIds.forEach(id => {
    reportData[id] = Array(12).fill(0); // เตรียมไว้ 12 เดือน (0-11)
  });

  transactions.forEach(t => {
    const month = new Date(t.created_at).getMonth();
    if (reportData[t.branch_id]) {
      reportData[t.branch_id][month] += t.amount;
    }
  });

  // 5. สร้าง Flex Message
  const branchBubbles = Object.keys(reportData).map(id => {
    const monthlyRows = reportData[id].map((amount, idx) => {
      if (amount === 0 && idx > now.getMonth()) return null; // ไม่แสดงเดือนที่ยังมาไม่ถึงและไม่มีเงิน
      return {
        type: "box", layout: "horizontal", contents: [
          { type: "text", text: new Date(0, idx).toLocaleString('th-TH', { month: 'short' }), size: "sm", color: "#888888" },
          { type: "text", text: `฿${amount.toLocaleString()}`, align: "end", size: "sm", weight: amount > 0 ? "bold" : "regular" }
        ]
      };
    }).filter(row => row !== null);

    return {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#00b900",
        contents: [{ type: "text", text: `📍 สาขา: ${branchMap[id]}`, color: "#ffffff", weight: "bold" }]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [
          { type: "text", text: "สรุปยอดรายเดือน (ปีนี้)", size: "xs", weight: "bold", color: "#aaaaaa" },
          { type: "separator", margin: "sm" },
          ...monthlyRows,
          { type: "separator", margin: "md" },
          {
            type: "box", layout: "horizontal", margin: "md",
            contents: [
              { type: "text", text: "รวมทั้งปี", weight: "bold" },
              { type: "text", text: `฿${reportData[id].reduce((a, b) => a + b, 0).toLocaleString()}`, align: "end", weight: "bold", color: "#1DB446" }
            ]
          }
        ]
      }
    };
  });

  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: "รายงานสรุปรายปีแยกสาขา",
    contents: { type: "carousel", contents: branchBubbles.slice(0, 10) } // แสดงได้สูงสุด 10 สาขาในหนึ่ง Carousel
  });
}

module.exports = {
  // ... อันเดิม ...
  sendYearlySummaryReport
};

  return client.replyMessage(event.replyToken, [
    { type: "flex", altText: "รายงานรายเครื่องละเอียด", contents: flexAllMachines },
    { type: "flex", altText: "สรุปภาพรวมสาขา", contents: flexSummary }
  ]);
}


// ฟังก์ชันช่วยสร้างแถวสรุปยอดรวม
function createSummaryRow(label, data) {
  return {
    type: "box", layout: "vertical", spacing: "xs", margin: "sm",
    contents: [
      { type: "text", text: label, size: "xs", weight: "bold" },
      {
        type: "box", layout: "horizontal",
        contents: [
          { type: "text", text: `ว: ${data.day.toLocaleString()}`, size: "xs", color: "#1DB446" },
          { type: "text", text: `ส: ${data.week.toLocaleString()}`, size: "xs", color: "#F39C12", align: "center" },
          { type: "text", text: `ด: ${data.month.toLocaleString()}`, size: "xs", align: "end" }
        ]
      }
    ]
  };
}


// --- 6. Export ---
module.exports = {
  getAdminMenu,
  getReportSelectionMenu,
  getBranchSelectMenu,
  sendBranchReport,
  sendMonthlyTotalReport:sendYearlySummaryReport,
  handleBranchReportLogic,
  ALPHABET_GROUPS,
  chunkArray
};
