// menus.js
const ALPHABET_GROUPS = {
  "A-B": "AB".split(""), "C-D": "CD".split(""), "E-F": "EF".split(""),
  "G-H": "GH".split(""), "I-J": "IJ".split(""), "K-L": "KL".split(""),
  "M-N": "MN".split(""), "O-P": "OP".split(""), "Q-R": "QR".split(""),
  "S-T": "ST".split(""), "U-V": "UV".split(""), "W-Z": "WXYZ".split("")
};

// --- เมนูหลัก Admin (Carousel) ---
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

// --- เมนูเลือกรายงาน ---
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
  // --- 6. รายงานต่อสาขา (Step 1: เลือกสาขา) ---
  if (userText === 'REPORT_BRANCH_SELECT') {
    const { data: mapping, error } = await supabase
      .from('owner_branch_mapping')
      .select('branch_id, branches(branch_name)')
      .eq('owner_line_id', event.source.userId);

    if (error || !mapping || mapping.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาที่ผูกกับบัญชีของคุณค่ะ' });
    }

    if (mapping.length === 1) {
      // ถ้ามีสาขาเดียว ให้ข้ามไปเรียกรายงานเลย (เดี๋ยวเราจะสร้างฟังก์ชันเรียกรายงานกัน)
      return sendBranchReport(event, mapping[0].branch_id, mapping[0].branches.branch_name);
    } else {
      // ถ้ามีหลายสาขา ให้ส่งเมนูเลือกสาขา (ใช้ getBranchSelectMenu จาก menu.js)
      return client.replyMessage(event.replyToken, {
        type: "flex",
        altText: "เลือกสาขา",
        contents: getBranchSelectMenu(mapping) 
      });
    }
  }


// --- ฟังก์ชันช่วยตัดแบ่ง Array (Helper) ---
function chunkArray(arr, s) { 
  const res = []; 
  for (let i = 0; i < arr.length; i += s) res.push(arr.slice(i, i + s)); 
  return res; 
}
// menu.js

// ฟังก์ชันสร้างเมนูเลือกสาขา (กรณีเจ้าของคนนั้นมีหลายสาขา)
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

// แก้ไข module.exports ท้ายไฟล์ menu.js
module.exports = {
  getAdminMenu,
  getReportSelectionMenu,
  getBranchSelectMenu, // เพิ่มอันนี้
  ALPHABET_GROUPS,
  chunkArray
};
