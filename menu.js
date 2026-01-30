// menu.js

const ALPHABET_GROUPS = {
  "A-B": "AB".split(""), "C-D": "CD".split(""), "E-F": "EF".split(""),
  "G-H": "GH".split(""), "I-J": "IJ".split(""), "K-L": "KL".split(""),
  "M-N": "MN".split(""), "O-P": "OP".split(""), "Q-R": "QR".split(""),
  "S-T": "ST".split(""), "U-V": "UV".split(""), "W-Z": "WXYZ".split("")
};

function getAdminMenu() {
  return { type: "carousel", contents: [ /* โค้ดเมนู Admin เดิม */ ] };
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

// --- ฟังก์ชันใหม่: จัดการ Logic รายงานต่อสาขา ---
async function handleBranchReportLogic(event, supabase, client) {
  const { data: mapping, error } = await supabase
    .from('owner_branch_mapping')
    .select('branch_id, branches(branch_name)')
    .eq('owner_line_id', event.source.userId);

  if (error || !mapping || mapping.length === 0) {
    return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลสาขาของคุณค่ะ' });
  }

  if (mapping.length === 1) {
    // ถ้ามีสาขาเดียว จะให้ทำอะไรต่อค่อยว่ากัน (เช่น ส่งยอดเงิน)
    return client.replyMessage(event.replyToken, { type: 'text', text: `กำลังดึงข้อมูลสาขา ${mapping[0].branches.branch_name}...` });
  } else {
    // ถ้ามีหลายสาขา ส่ง Flex เลือกสาขา
    return client.replyMessage(event.replyToken, {
      type: "flex", altText: "เลือกสาขา", contents: getBranchSelectMenu(mapping) 
    });
  }
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

function chunkArray(arr, s) { 
  const res = []; 
  for (let i = 0; i < arr.length; i += s) res.push(arr.slice(i, i + s)); 
  return res; 
}

module.exports = {
  getAdminMenu,
  getReportSelectionMenu,
  getBranchSelectMenu,
  handleBranchReportLogic, // เพิ่มอันนี้เข้าไป
  ALPHABET_GROUPS,
  chunkArray
};
