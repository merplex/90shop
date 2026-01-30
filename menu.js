// menu.js
const ALPHABET_GROUPS = {
  "A-B": "AB".split(""), "C-D": "CD".split(""), "E-F": "EF".split(""),
  "G-H": "GH".split(""), "I-J": "IJ".split(""), "K-L": "KL".split(""),
  "M-N": "MN".split(""), "O-P": "OP".split(""), "Q-R": "QR".split(""),
  "S-T": "ST".split(""), "U-V": "UV".split(""), "W-Z": "WXYZ".split("")
};

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

async function handleBranchReportLogic(event, supabase, client) {
  try {
    const { data: mapping, error } = await supabase
      .from('owner_branch_mapping')
      .select('branch_id, branches(branch_name)')
      .eq('owner_line_id', event.source.userId);
    if (error || !mapping || mapping.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาที่ผูกกับบัญชีของคุณค่ะ' });
    }
    if (mapping.length === 1) {
      return sendBranchReport(event, mapping[0].branch_id, mapping[0].branches.branch_name, supabase, client);
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
          action: { type: "message", label: m.branches.branch_name, text: `VIEW_REPORT_ID:${m.branch_id}|${m.branches.branch_name}` }
        }))
      ]
    }
  };
}

// --- 1. รายงานรายสาขา (ดึงจาก transactions และแสดงผล ว/ส/ด) ---
async function sendBranchReport(event, branchId, branchName, supabase, client) {
  const { data: logs, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('branch_id', branchId);

  if (error || !logs || logs.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: `ไม่พบข้อมูลธุรกรรมของสาขา ${branchName} ค่ะ` });

  const now = new Date();
  const machineData = {};
  const branchSummary = {
    coin: { day: 0, week: 0, month: 0 },
    bank: { day: 0, week: 0, month: 0 },
    qr: { day: 0, week: 0, month: 0 }
  };

  logs.forEach(log => {
    const logDate = new Date(log.created_at);
    // คำนวณส่วนต่างวัน (ใช้ค่าสัมบูรณ์เพื่อให้ครอบคลุมข้อมูลสุ่มที่อาจจะคลาดเคลื่อน)
    const diffTime = Math.abs(now - logDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const mId = log.machine_id;
    const type = log.type;

    if (!machineData[mId]) {
      machineData[mId] = {
        coin: { day: 0, week: 0, month: 0 },
        bank: { day: 0, week: 0, month: 0 },
        qr: { day: 0, week: 0, month: 0 }
      };
    }

    // เก็บสถิติ (ว: 1 วัน / ส: 7 วัน / ด: 30 วัน)
    if (diffDays <= 1) {
      machineData[mId][type].day += log.amount;
      branchSummary[type].day += log.amount;
    }
    if (diffDays <= 7) {
      machineData[mId][type].week += log.amount;
      branchSummary[type].week += log.amount;
    }
    if (diffDays <= 30) {
      machineData[mId][type].month += log.amount;
      branchSummary[type].month += log.amount;
    }
  });

  const machineRows = [];
  Object.keys(machineData).forEach((mId, index) => {
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
    header: { type: "box", layout: "vertical", backgroundColor: "#333333", contents: [{ type: "text", text: `📋 รายงานแยกเครื่อง: ${branchName}`, color: "#ffffff", weight: "bold" }] },
    body: { type: "box", layout: "vertical", contents: machineRows }
  };

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

  return client.replyMessage(event.replyToken, [
    { type: "flex", altText: "รายงานรายเครื่องละเอียด", contents: flexAllMachines },
    { type: "flex", altText: "สรุปภาพรวมสาขา", contents: flexSummary }
  ]);
}

async function sendYearlySummaryReport(event, supabase, client) {
  try {
    const userId = event.source.userId;
    const { data: mapping } = await supabase.from('owner_branch_mapping').select('branch_id, branches(branch_name)').eq('owner_line_id', userId);
    if (!mapping || mapping.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาค่ะ' });

    const branchIds = mapping.map(m => m.branch_id);
    const branchMap = {};
    mapping.forEach(m => branchMap[m.branch_id] = m.branches.branch_name);

    const now = new Date();
    const startOfPeriod = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();

    const { data: transactions } = await supabase
      .from('transactions')
      .select('amount, created_at, branch_id')
      .in('branch_id', branchIds)
      .gte('created_at', startOfPeriod);

    const branchBubbles = Object.keys(branchMap).map(id => {
      let totalAll = 0;
      const monthlyRows = [];

      // วนลูป 12 เดือนถอยหลัง
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mIdx = d.getMonth();
        const year = d.getFullYear();

        // ✅ แก้ไข: บวกรวมยอดเงินทั้งหมดของเดือนนั้น (Sum)
        const monthAmount = (transactions || [])
          .filter(t => t.branch_id === id && new Date(t.created_at).getMonth() === mIdx && new Date(t.created_at).getFullYear() === year)
          .reduce((sum, t) => sum + t.amount, 0);

        if (monthAmount > 0 || i === 0) {
          totalAll += monthAmount;
          monthlyRows.push({
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: d.toLocaleString('th-TH', { month: 'short' }) + ` (${year + 543})`, size: "sm", color: "#888888" },
              { type: "text", text: `฿${monthAmount.toLocaleString()}`, align: "end", size: "sm", weight: "bold" }
            ]
          });
        }
      }

      return {
        type: "bubble",
        header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: `📍 สาขา: ${branchMap[id]}`, color: "#ffffff", weight: "bold" }] },
        body: {
          type: "box", layout: "vertical", spacing: "sm",
          contents: [
            { type: "text", text: "สรุปยอดรายเดือนรวมทุกเครื่อง", size: "xs", weight: "bold", color: "#aaaaaa" },
            { type: "separator", margin: "sm" },
            ...monthlyRows,
            { type: "separator", margin: "md" },
            {
              type: "box", layout: "horizontal", margin: "md",
              contents: [
                { type: "text", text: "รวมยอดที่แสดง", weight: "bold", size: "sm" },
                { type: "text", text: `฿${totalAll.toLocaleString()}`, align: "end", weight: "bold", color: "#1DB446" }
              ]
            }
          ]
        }
      };
    });

    return client.replyMessage(event.replyToken, {
      type: "flex",
      altText: "รายงานรายปี",
      contents: { type: "carousel", contents: branchBubbles.slice(0, 10) }
    });
  } catch (err) { console.error(err); }
}



function createSummaryRow(label, data) {
  return { type: "box", layout: "vertical", spacing: "xs", margin: "sm", contents: [{ type: "text", text: label, size: "xs", weight: "bold" }, { type: "box", layout: "horizontal", contents: [{ type: "text", text: `ว: ${data.day.toLocaleString()}`, size: "xs", color: "#1DB446" }, { type: "text", text: `ส: ${data.week.toLocaleString()}`, size: "xs", color: "#F39C12", align: "center" }, { type: "text", text: `ด: ${data.month.toLocaleString()}`, size: "xs", align: "end" }] }] };
}

function chunkArray(arr, s) { const res = []; for (let i = 0; i < arr.length; i += s) res.push(arr.slice(i, i + s)); return res; }

module.exports = {
  getAdminMenu,
  getReportSelectionMenu,
  getBranchSelectMenu,
  sendBranchReport,
  sendMonthlyTotalReport: sendYearlySummaryReport,
  handleBranchReportLogic,
  ALPHABET_GROUPS,
  chunkArray
};
