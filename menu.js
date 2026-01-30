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

async function handleBranchReportLogic(event, supabase, client) {
  try {
    const { data: mapping, error } = await supabase
      .from('owner_branch_mapping')
      .select('branch_id, branches(branch_name)')
      .eq('owner_line_id', event.source.userId);

    if (error || !mapping || mapping.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาที่ผูกกับบัญชีของคุณค่ะ' });
    }

    // menu.js (ใน handleBranchReportLogic)

    if (mapping.length === 1) {
      // ตัด await และข้อความ text ทิ้งไปเลย เพื่อไม่ให้แย่งใช้ replyToken
      // เรียกฟังก์ชันส่ง Flex รายงานโดยตรง
      return sendBranchReport(event, mapping[0].branch_id, mapping[0].branches.branch_name, supabase, client);
    }

  } catch (err) {
    console.error(err);
    // ไม่ต้องส่ง replyMessage ใน catch ถ้ากังวลเรื่อง Token ซ้ำ
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

  // ประมวลผลข้อมูล
  logs.forEach(log => {
    const logDate = new Date(log.created_at);
    const diffDays = Math.ceil(Math.abs(now - logDate) / (1000 * 60 * 60 * 24));
    const mId = log.machine_id;

    if (!machineData[mId]) {
      machineData[mId] = { coin: 0, bank: 0, qr: 0, total: 0 };
    }
    
    // แยกตามเครื่อง (ยอดรวมทั้งหมดของเครื่องนั้น)
    if (log.type === 'coin') machineData[mId].coin += log.amount;
    if (log.type === 'bank') machineData[mId].bank += log.amount;
    if (log.type === 'qr') machineData[mId].qr += log.amount;
    machineData[mId].total += log.amount;

    // แยกสรุปรวมสาขาตามช่วงเวลา
    if (diffDays <= 1) branchSummary[log.type].day += log.amount;
    if (diffDays <= 7) branchSummary[log.type].week += log.amount;
    if (diffDays <= 30) branchSummary[log.type].month += log.amount;
  });

  // --- ส่วนการสร้างหน้าตา Flex ---

  // 1. สร้างเนื้อหาในตารางรายเครื่อง
  const machineRows = [];
  Object.keys(machineData).forEach((mId, index) => {
    const d = machineData[mId];
    // เพิ่มขีดคั่นระหว่างเครื่อง (ยกเว้นเครื่องแรก)
    if (index > 0) machineRows.push({ type: "separator", margin: "md" });
    
    machineRows.push({
      type: "box", layout: "vertical", margin: "md", spacing: "xs",
      contents: [
        { type: "text", text: `📟 เครื่อง: ${mId}`, weight: "bold", size: "sm", color: "#111111" },
        { type: "box", layout: "horizontal", contents: [{ type: "text", text: "เหรียญ/แบงค์/QR", size: "xs", color: "#888888" }, { type: "text", text: `${d.coin}/${d.bank}/${d.qr}`, align: "end", size: "xs" }] },
        { type: "box", layout: "horizontal", contents: [{ type: "text", text: "ยอดรวมเครื่องนี้", size: "sm", weight: "bold" }, { type: "text", text: `฿${d.total.toLocaleString()}`, align: "end", size: "sm", weight: "bold", color: "#4169E1" }] }
      ]
    });
  });

  const flexAllMachines = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#333333", contents: [{ type: "text", text: `📋 รายเครื่อง: ${branchName}`, color: "#ffffff", weight: "bold" }] },
    body: { type: "box", layout: "vertical", contents: machineRows }
  };

  // 2. สร้าง Flex สรุปยอดรวม (ใช้ฟังก์ชัน getSummaryFlex เดิมที่เรเคยให้ไว้ได้เลย)
  const flexSummary = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: `🏆 สรุปภาพรวม: ${branchName}`, color: "#ffffff", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        { type: "text", text: "ยอดรวมแยกประเภท (วัน/สัปดาห์/เดือน)", weight: "bold", size: "sm" },
        createSummaryRow("🪙 เหรียญ", branchSummary.coin),
        createSummaryRow("💵 ธนบัตร", branchSummary.bank),
        createSummaryRow("📱 QR Code", branchSummary.qr),
        { type: "separator" },
        { type: "text", text: "* ว:วันนี้ / ส:7วัน / ด:30วัน", size: "xxs", color: "#aaaaaa" }
      ]
    }
  };

  return client.replyMessage(event.replyToken, [
    { type: "flex", altText: "รายงานรายเครื่อง", contents: flexAllMachines },
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
  handleBranchReportLogic,
  ALPHABET_GROUPS,
  chunkArray
};
