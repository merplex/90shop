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
  // ดึงข้อมูลทั้งหมดของสาขานี้
  const { data: logs, error } = await supabase
    .from('transactions') // ใช้ชื่อตารางที่เปรมรัน SQL ไว้
    .select('*')
    .eq('branch_id', branchId);

  if (error) return client.replyMessage(event.replyToken, { type: 'text', text: 'คํานวณเงินไม่สำเร็จค่ะ' });

  const now = new Date();
  let dayTotal = 0, weekTotal = 0, monthTotal = 0;
  let coin = 0, bank = 0, qr = 0;

  logs.forEach(log => {
    const logDate = new Date(log.created_at);
    const diffTime = Math.abs(now - logDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // แยกประเภทเงิน (รวมทั้งหมด)
    if (log.type === 'coin') coin += log.amount;
    else if (log.type === 'bank') bank += log.amount;
    else if (log.type === 'qr') qr += log.amount;

    // คำนวณช่วงเวลา
    if (diffDays <= 1) dayTotal += log.amount;
    if (diffDays <= 7) weekTotal += log.amount;
    if (diffDays <= 30) monthTotal += log.amount;
  });

  // ส่ง Flex Message สรุปยอด (เรย่อส่วน JSON ให้ดูง่ายๆ นะคะ)
  return client.replyMessage(event.replyToken, {
    type: "flex",
    altText: `รายงานสาขา ${branchName}`,
    contents: {
      type: "bubble",
      header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: `📊 รายงานสาขา: ${branchName}`, color: "#ffffff", weight: "bold" }] },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: "แยกตามประเภท (ยอดรวม)", weight: "bold", size: "sm", color: "#888888" },
          { type: "box", layout: "horizontal", contents: [{ type: "text", text: "🪙 เหรียญ:" }, { type: "text", text: `฿${coin.toLocaleString()}`, align: "end", weight: "bold" }] },
          { type: "box", layout: "horizontal", contents: [{ type: "text", text: "💵 ธนบัตร:" }, { type: "text", text: `฿${bank.toLocaleString()}`, align: "end", weight: "bold" }] },
          { type: "box", layout: "horizontal", contents: [{ type: "text", text: "📱 QR Code:" }, { type: "text", text: `฿${qr.toLocaleString()}`, align: "end", weight: "bold" }] },
          { type: "separator", margin: "md" },
          { type: "text", text: "สรุปตามช่วงเวลา", weight: "bold", size: "sm", color: "#888888" },
          { type: "box", layout: "horizontal", contents: [{ type: "text", text: "📅 วันนี้:" }, { type: "text", text: `฿${dayTotal.toLocaleString()}`, align: "end", color: "#1DB446", weight: "bold" }] },
          { type: "box", layout: "horizontal", contents: [{ type: "text", text: "📅 สัปดาห์นี้:" }, { type: "text", text: `฿${weekTotal.toLocaleString()}`, align: "end", weight: "bold" }] },
          { type: "box", layout: "horizontal", contents: [{ type: "text", text: "📅 เดือนนี้:" }, { type: "text", text: `฿${monthTotal.toLocaleString()}`, align: "end", weight: "bold" }] }
        ]
      }
    }
  });
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
