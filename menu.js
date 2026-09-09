// --- ช่วงเวลา ว(วัน)/ส(สัปดาห์)/ด(เดือน) แบบปฏิทินสากล (เขตเวลาไทย, UTC+7 คงที่ ไม่มี DST) ---
// วัน   = วันนี้ 00:00–23:59 น.
// สัปดาห์ = จันทร์ 00:00 น. – อาทิตย์ 23:59 น. (ISO week)
// เดือน  = วันที่ 1 ของเดือน 00:00 น. – สิ้นเดือน (ปฏิทินสากล)
// คำนวณครั้งเดียวในโค้ด แล้วส่งเป็น timestamptz param เข้า query แทนการ inline NOW()-INTERVAL ซ้ำๆ
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;
function getThaiPeriodBounds() {
  const thaiNow = new Date(Date.now() + THAI_OFFSET_MS); // wall-clock เวลาไทย อ่านผ่าน getUTC* ได้ตรงๆ
  const y = thaiNow.getUTCFullYear(), m = thaiNow.getUTCMonth(), d = thaiNow.getUTCDate();
  const dow = thaiNow.getUTCDay(); // 0=อาทิตย์..6=เสาร์
  const daysSinceMonday = (dow + 6) % 7; // จันทร์=0

  const toUtc = (thaiMs) => new Date(thaiMs - THAI_OFFSET_MS);
  return {
    dayStart:   toUtc(Date.UTC(y, m, d, 0, 0, 0)),
    weekStart:  toUtc(Date.UTC(y, m, d - daysSinceMonday, 0, 0, 0)),
    monthStart: toUtc(Date.UTC(y, m, 1, 0, 0, 0))
  };
}

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
        header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "เมนู Admin", weight: "bold", color: "#1DB446", size: "lg" }] },
        body: {
          type: "box", layout: "vertical", spacing: "md",
          contents: [
            { type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "👤 จัดการ Owner", uri: "https://liff.line.me/2009523613-hLnRGrZC?mode=owner" } },
            { type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "📍 จัดการ Branch", uri: "https://liff.line.me/2009523613-hLnRGrZC?mode=branch" } },
            { type: "button", style: "primary", color: "#1DB446", height: "sm", action: { type: "uri", label: "🔗 เริ่มจับคู่", uri: "https://liff.line.me/2009523613-hLnRGrZC?mode=match" } }
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
        { type: "button", style: "primary", color: "#00b900", action: { type: "postback", label: "รายงานต่อสาขา", data: "REPORT_BRANCH_SELECT" } },
        { type: "button", style: "secondary", action: { type: "postback", label: "รายงานรวมรายเดือน", data: "REPORT_MONTHLY_TOTAL" } },
        { type: "button", style: "secondary", action: { type: "uri", label: "รายงานต่อเครื่อง", uri: "https://liff.line.me/2009523613-hLnRGrZC?mode=machinereport&v=2" } },
        { type: "button", style: "primary", color: "#9C27B0", action: { type: "postback", label: "รายงานแต้มสะสม", data: "POINT_REPORT_MENU" } },
        { type: "button", style: "primary", color: "#FFB74D", action: { type: "uri", label: "จัดการยอดเงิน", uri: "https://liff.line.me/2009523613-hLnRGrZC?mode=balance" } }
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
          action: { type: "postback", label: m.branch_name, data: `VIEW_REPORT_ID:${m.branch_id}|${m.branch_name}` }
        }))
      ]
    }
  };
}

async function sendBranchReport(event, branchId, branchName, pool, client) {
  try {
    const { dayStart, weekStart, monthStart } = getThaiPeriodBounds();
    const res = await pool.query(
      `SELECT
         machine_id,
         SUM(coin) FILTER (WHERE period_start >= $2) as coin_day,
         SUM(coin) FILTER (WHERE period_start >= $3) as coin_week,
         SUM(coin) FILTER (WHERE period_start >= $4) as coin_month,
         SUM(coin)                                    as coin_all,
         SUM(bank) FILTER (WHERE period_start >= $2) as bank_day,
         SUM(bank) FILTER (WHERE period_start >= $3) as bank_week,
         SUM(bank) FILTER (WHERE period_start >= $4) as bank_month,
         SUM(bank)                                    as bank_all,
         SUM(qr)   FILTER (WHERE period_start >= $2) as qr_day,
         SUM(qr)   FILTER (WHERE period_start >= $3) as qr_week,
         SUM(qr)   FILTER (WHERE period_start >= $4) as qr_month,
         SUM(qr)                                      as qr_all
       FROM hourly_summary
       WHERE branch_id = $1
       GROUP BY machine_id
       ORDER BY machine_id`,
      [branchId, dayStart, weekStart, monthStart]
    );
    const stats = res.rows || [];

    if (stats.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `ยังไม่มีข้อมูลธุรกรรมสำหรับสาขา ${branchName} ค่ะ` });
    }

    // ยอด QR ใน hourly_summary รวมทั้งสแกนจ่ายผ่านธนาคาร + แลกแต้มผ่าน LINE app
    // ดึงส่วน "แลกแต้ม" (1 แต้ม = 1 บาท) มาแสดงแยกในวงเล็บใต้แถว QR
    const redeemRes = await pool.query(
      `SELECT
         machine_id,
         SUM(points) FILTER (WHERE created_at >= $2) as r_day,
         SUM(points) FILTER (WHERE created_at >= $3) as r_week,
         SUM(points) FILTER (WHERE created_at >= $4) as r_month,
         SUM(points)                                  as r_all
       FROM point_events
       WHERE branch_id = $1 AND type = 'redeem'
       GROUP BY machine_id`,
      [branchId, dayStart, weekStart, monthStart]
    );

    const machineData = {};
    const branchSummary = {
      coin:   { day: 0, week: 0, month: 0, all: 0 },
      bank:   { day: 0, week: 0, month: 0, all: 0 },
      qr:     { day: 0, week: 0, month: 0, all: 0 },
      redeem: { day: 0, week: 0, month: 0, all: 0 }
    };

    const p = v => parseInt(v) || 0;
    // key ด้วย machine_id ตัวพิมพ์เล็ก กันเคส point_events เก็บ case ไม่ตรงกับ hourly_summary
    const redeemMap = {};
    (redeemRes.rows || []).forEach(r => {
      redeemMap[String(r.machine_id).toLowerCase()] = { day: p(r.r_day), week: p(r.r_week), month: p(r.r_month), all: p(r.r_all) };
    });

    stats.forEach(row => {
      const mId = row.machine_id;
      machineData[mId] = {
        coin:   { day: p(row.coin_day), week: p(row.coin_week), month: p(row.coin_month), all: p(row.coin_all) },
        bank:   { day: p(row.bank_day), week: p(row.bank_week), month: p(row.bank_month), all: p(row.bank_all) },
        qr:     { day: p(row.qr_day),   week: p(row.qr_week),   month: p(row.qr_month),   all: p(row.qr_all)   },
        redeem: redeemMap[String(mId).toLowerCase()] || { day: 0, week: 0, month: 0, all: 0 }
      };
      ['coin', 'bank', 'qr', 'redeem'].forEach(t => {
        branchSummary[t].day   += machineData[mId][t].day;
        branchSummary[t].week  += machineData[mId][t].week;
        branchSummary[t].month += machineData[mId][t].month;
        branchSummary[t].all   += machineData[mId][t].all;
      });
    });

    const machineRows = [];
    Object.keys(machineData).sort().forEach((mId, index) => {
      const d = machineData[mId];
      if (index > 0) machineRows.push({ type: "separator", margin: "xl" });
      machineRows.push({
        type: "box", layout: "vertical", margin: "md", spacing: "sm",
        contents: [
          {
            type: "box", layout: "horizontal",
            contents: [
              { type: "text", text: `📟 เครื่อง: ${mId}`, weight: "bold", size: "md", color: "#111111", flex: 1, gravity: "center", wrap: true },
              { type: "text", text: "🧹", size: "sm", flex: 0, align: "end", gravity: "center", action: { type: "postback", data: `CONFIRM_CLEAR_MACHINE:${branchId}|${branchName}|${mId}` } },
              { type: "text", text: "❌", size: "sm", flex: 0, align: "end", gravity: "center", margin: "lg", action: { type: "postback", data: `CONFIRM_DELETE_MACHINE:${branchId}|${branchName}|${mId}` } }
            ]
          },
          createSummaryRow("🪙 เหรียญ", d.coin),
          createSummaryRow("💵 ธนบัตร", d.bank),
          createSummaryRow("📱 QR Code", d.qr),
          ...(d.redeem.all > 0 ? [createRedeemNote(d.redeem)] : [])
        ]
      });
    });

    const flexAllMachines = {
      type: "bubble",
      size: "giga",
      header: { type: "box", layout: "vertical", backgroundColor: "#333333", contents: [
        { type: "text", text: `📋 รายงานแยกเครื่อง: ${branchName}`, color: "#ffffff", weight: "bold" },
        { type: "text", text: "🧹 = ล้างยอดเป็น 0   ❌ = ลบเครื่อง (มีให้ยืนยันก่อน)", color: "#dddddd", size: "xxs", wrap: true }
      ] },
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
          ...(branchSummary.redeem.all > 0 ? [createRedeemNote(branchSummary.redeem)] : []),
          { type: "separator" },
          { type: "text", text: "* D=วันนี้ / W=สัปดาห์นี้ / M=เดือนนี้ / รวม=ทั้งหมด", size: "xxs", color: "#aaaaaa" }
        ]
      }
    };

    return client.replyMessage(event.replyToken, [
      { type: "flex", altText: "รายงานรายเครื่องละเอียด", contents: flexAllMachines },
      { type: "flex", altText: "สรุปภาพรวมสาขา", contents: flexSummary }
    ]);
  } catch (err) { console.error(err); }
}

// --- 2.5 รายงานแต้มสะสม (Point Events) ---
function getPointReportMenu() {
  return {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#9C27B0", contents: [{ type: "text", text: "🎯 รายงานแต้มสะสม", color: "#ffffff", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#1DB446", action: { type: "postback", label: "🌟 การสะสมแต้ม", data: "POINT_REPORT_SELECT:earn" } },
        { type: "button", style: "primary", color: "#FF7043", action: { type: "postback", label: "🎫 การใช้แต้ม", data: "POINT_REPORT_SELECT:redeem" } }
      ]
    }
  };
}

async function handlePointReportLogic(event, type, pool, client) {
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
      return sendPointReport(event, type, mapping[0].branch_id, mapping[0].branch_name, pool, client);
    } else {
      return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: getPointBranchSelectMenu(mapping, type) });
    }
  } catch (err) { console.error(err); }
}

function getPointBranchSelectMenu(mapping, type) {
  return {
    type: "bubble",
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: "เลือกสาขาที่ต้องการดู", weight: "bold", size: "lg" },
        ...mapping.map(m => ({
          type: "button", style: "secondary", height: "sm",
          action: { type: "postback", label: m.branch_name, data: `VIEW_POINT_REPORT:${type}|${m.branch_id}|${m.branch_name}` }
        }))
      ]
    }
  };
}

async function sendPointReport(event, type, branchId, branchName, pool, client) {
  try {
    const { dayStart, weekStart, monthStart } = getThaiPeriodBounds();
    const res = await pool.query(
      `SELECT
         machine_id,
         SUM(points) FILTER (WHERE created_at >= $3) as pt_day,
         SUM(points) FILTER (WHERE created_at >= $4) as pt_week,
         SUM(points) FILTER (WHERE created_at >= $5) as pt_month,
         SUM(points)                                  as pt_all
       FROM point_events
       WHERE branch_id = $1 AND type = $2
       GROUP BY machine_id
       ORDER BY machine_id`,
      [branchId, type, dayStart, weekStart, monthStart]
    );
    const stats = res.rows || [];

    const label = type === 'earn' ? 'การสะสมแต้ม' : 'การใช้แต้ม';
    const themeColor = type === 'earn' ? '#1DB446' : '#FF7043';
    const icon = type === 'earn' ? '🌟' : '🎫';

    if (stats.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: `ยังไม่มีข้อมูล${label}สำหรับสาขา ${branchName} ค่ะ` });
    }

    const p = v => parseInt(v) || 0;
    const branchSummary = { day: 0, week: 0, month: 0, all: 0 };
    const machineRows = [];

    stats.forEach((row, index) => {
      const d = { day: p(row.pt_day), week: p(row.pt_week), month: p(row.pt_month), all: p(row.pt_all) };
      branchSummary.day += d.day;
      branchSummary.week += d.week;
      branchSummary.month += d.month;
      branchSummary.all += d.all;

      if (index > 0) machineRows.push({ type: "separator", margin: "xl" });
      machineRows.push({
        type: "box", layout: "vertical", margin: "md", spacing: "sm",
        contents: [
          { type: "text", text: `📟 เครื่อง: ${row.machine_id}`, weight: "bold", size: "md", color: "#111111" },
          createSummaryRow(`${icon} แต้ม`, d)
        ]
      });
    });

    const flexAllMachines = {
      type: "bubble",
      size: "giga",
      header: { type: "box", layout: "vertical", backgroundColor: "#333333", contents: [{ type: "text", text: `📋 ${label} แยกเครื่อง: ${branchName}`, color: "#ffffff", weight: "bold" }] },
      body: { type: "box", layout: "vertical", contents: machineRows }
    };

    const flexSummary = {
      type: "bubble",
      size: "giga",
      header: { type: "box", layout: "vertical", backgroundColor: themeColor, contents: [{ type: "text", text: `🏆 สรุปภาพรวมสาขา: ${branchName}`, color: "#ffffff", weight: "bold" }] },
      body: {
        type: "box", layout: "vertical", spacing: "md",
        contents: [
          { type: "text", text: `${label} รวมทุกเครื่อง`, weight: "bold", size: "sm" },
          createSummaryRow(`${icon} แต้มรวม`, branchSummary),
          { type: "separator" },
          { type: "text", text: "* D=วันนี้ / W=สัปดาห์นี้ / M=เดือนนี้ / รวม=ทั้งหมด", size: "xxs", color: "#aaaaaa" }
        ]
      }
    };

    return client.replyMessage(event.replyToken, [
      { type: "flex", altText: `${label} แยกเครื่อง`, contents: flexAllMachines },
      { type: "flex", altText: `สรุปภาพรวมสาขา`, contents: flexSummary }
    ]);
  } catch (err) {
    console.error('[sendPointReport Error]', err);
    try { return await client.replyMessage(event.replyToken, { type: 'text', text: '⚠️ ดึงรายงานแต้มไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ' }); } catch (_) {}
  }
}

// --- 3. รายงานรายเดือน (แยกตามปี + บรรทัดใช้แต้ม) ---
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// ดึงยอดเงินราย ด. (coin+bank+qr ล้วน ๆ) และแต้มที่ใช้ราย ด. ของทุกสาขาที่ owner คนนี้ถือ
async function fetchMonthlyData(pool, ownerLineId) {
  const money = await pool.query(
    `SELECT h.branch_id, b.branch_name,
       EXTRACT(YEAR  FROM h.period_start AT TIME ZONE 'Asia/Bangkok')::int  AS year,
       EXTRACT(MONTH FROM h.period_start AT TIME ZONE 'Asia/Bangkok')::int  AS month,
       SUM(h.coin + h.bank + h.qr)::bigint AS amount
     FROM hourly_summary h
     JOIN branches b ON h.branch_id = b.id
     JOIN owner_branch_mapping m ON m.branch_id = h.branch_id
     WHERE m.owner_line_id = $1
     GROUP BY h.branch_id, b.branch_name, year, month`,
    [ownerLineId]
  );
  const redeem = await pool.query(
    `SELECT pe.branch_id, b.branch_name,
       EXTRACT(YEAR  FROM pe.created_at AT TIME ZONE 'Asia/Bangkok')::int  AS year,
       EXTRACT(MONTH FROM pe.created_at AT TIME ZONE 'Asia/Bangkok')::int  AS month,
       SUM(pe.points)::bigint AS pts
     FROM point_events pe
     JOIN branches b ON b.id = pe.branch_id
     JOIN owner_branch_mapping m ON m.branch_id = pe.branch_id
     WHERE m.owner_line_id = $1 AND pe.type = 'redeem'
     GROUP BY pe.branch_id, b.branch_name, year, month`,
    [ownerLineId]
  );
  return { money: money.rows || [], redeem: redeem.rows || [] };
}

// สร้าง bubble รายเดือนของ 1 สาขา สำหรับปี ค.ศ. ที่เลือก
function buildBranchMonthlyBubble(branchId, branchName, ce_year, availableYears, money, redeem) {
  const bkkNow = new Date(Date.now() + 7 * 3600 * 1000);
  const curY = bkkNow.getUTCFullYear(), curM = bkkNow.getUTCMonth() + 1;
  const lastMonth = ce_year >= curY ? curM : 12;

  const moneyOf = (m) => { const r = money.find(x => x.branch_id === branchId && x.year === ce_year && x.month === m); return r ? Number(r.amount) : 0; };
  const ptsOf   = (m) => { const r = redeem.find(x => x.branch_id === branchId && x.year === ce_year && x.month === m); return r ? Number(r.pts) : 0; };

  let totalMoney = 0, totalPts = 0;
  const rows = [];
  for (let m = 1; m <= lastMonth; m++) {
    const amt = moneyOf(m), pts = ptsOf(m);
    totalMoney += amt; totalPts += pts;
    const label = `${TH_MONTHS[m - 1]}(${ce_year + 543})` + (pts > 0 ? ` #ใช้แต้ม ${pts.toLocaleString()}` : '');
    rows.push({
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: label, size: "sm", color: "#888888", flex: 5, wrap: true },
        { type: "text", text: `฿${amt.toLocaleString()}`, align: "end", size: "sm", flex: 3,
          weight: amt > 0 ? "bold" : "regular", color: amt > 0 ? "#000000" : "#cccccc" }
      ]
    });
  }

  // ปุ่ม/ป้ายปีทางขวาของแถบเขียว — กดได้เมื่อมีข้อมูลมากกว่า 1 ปี
  const yearTag = availableYears.length > 1
    ? { type: "box", layout: "vertical", backgroundColor: "#ffffff", cornerRadius: "md", paddingAll: "xs", flex: 0,
        action: { type: "postback", label: "เลือกปี", data: `MONTHLY_YEAR_MENU:${branchId}|${branchName}` },
        contents: [{ type: "text", text: `${ce_year + 543} ▾`, size: "xs", weight: "bold", color: "#00b900", align: "center" }] }
    : { type: "text", text: `${ce_year + 543}`, size: "xs", weight: "bold", color: "#ffffff", align: "end", flex: 0, gravity: "center" };

  return {
    type: "bubble",
    header: {
      type: "box", layout: "horizontal", backgroundColor: "#00b900", spacing: "sm",
      contents: [
        { type: "text", text: `📍 สาขา: ${branchName}`, color: "#ffffff", weight: "bold", flex: 1, gravity: "center", wrap: true },
        yearTag
      ]
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: `สรุปยอดรายเดือน ปี ${ce_year + 543}`, size: "xs", weight: "bold", color: "#aaaaaa" },
        { type: "separator", margin: "sm" },
        ...rows,
        { type: "separator", margin: "md" },
        { type: "box", layout: "horizontal", margin: "md", contents: [
          { type: "text", text: "รวมยอดทั้งปี", weight: "bold", size: "sm" },
          { type: "text", text: `฿${totalMoney.toLocaleString()}`, align: "end", weight: "bold", color: "#1DB446" }
        ] },
        ...(totalPts > 0 ? [{ type: "box", layout: "horizontal", contents: [
          { type: "text", text: "ใช้แต้มทั้งปี", size: "xs", color: "#9C27B0" },
          { type: "text", text: `${totalPts.toLocaleString()} แต้ม`, align: "end", size: "xs", color: "#9C27B0" }
        ] }] : []),
        { type: "text", text: "* ยอด ฿ เป็นเงินล้วน ไม่รวมส่วนที่จ่ายด้วยแต้ม", size: "xxs", color: "#aaaaaa", margin: "sm", wrap: true }
      ]
    }
  };
}

// ปีที่มีข้อมูล (เงินหรือแต้ม) ของสาขานั้น เรียงใหม่→เก่า
function yearsForBranch(branchId, money, redeem) {
  const ys = new Set();
  money.forEach(r => { if (r.branch_id === branchId) ys.add(r.year); });
  redeem.forEach(r => { if (r.branch_id === branchId) ys.add(r.year); });
  return [...ys].sort((a, b) => b - a);
}

async function sendYearlySummaryReport(event, pool, client) {
  try {
    const { money, redeem } = await fetchMonthlyData(pool, event.source.userId);
    if (money.length === 0 && redeem.length === 0) {
      return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลธุรกรรมค่ะ' });
    }

    const branches = [];
    const seen = new Set();
    [...money, ...redeem].forEach(r => { if (!seen.has(r.branch_id)) { seen.add(r.branch_id); branches.push({ id: r.branch_id, name: r.branch_name }); } });

    const bubbles = branches.map(br => {
      const years = yearsForBranch(br.id, money, redeem);
      const showYear = years[0] || new Date().getFullYear();
      return buildBranchMonthlyBubble(br.id, br.name, showYear, years, money, redeem);
    });

    return client.replyMessage(event.replyToken, {
      type: "flex", altText: "รายงานรายเดือน",
      contents: { type: "carousel", contents: bubbles.slice(0, 10) }
    });
  } catch (err) { console.error('[sendYearlySummaryReport]', err); }
}

// กดป้ายปี → เมนูเลือกปีของสาขานั้น (เฉพาะปีที่มีข้อมูล)
async function sendMonthlyYearMenu(event, branchId, branchName, pool, client) {
  try {
    const { money, redeem } = await fetchMonthlyData(pool, event.source.userId);
    const years = yearsForBranch(branchId, money, redeem);
    if (years.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลของสาขานี้ค่ะ' });
    return client.replyMessage(event.replyToken, {
      type: "flex", altText: "เลือกปี",
      contents: {
        type: "bubble",
        header: { type: "box", layout: "vertical", backgroundColor: "#00b900", contents: [{ type: "text", text: `เลือกปี — ${branchName}`, color: "#ffffff", weight: "bold" }] },
        body: {
          type: "box", layout: "vertical", spacing: "sm",
          contents: years.map(y => ({
            type: "button", style: "secondary", height: "sm",
            action: { type: "postback", label: `ปี ${y + 543}`, data: `MONTHLY_YEAR_VIEW:${branchId}|${branchName}|${y}` }
          }))
        }
      }
    });
  } catch (err) { console.error('[sendMonthlyYearMenu]', err); }
}

// เลือกปีแล้ว → แสดง bubble รายเดือนของสาขานั้นสำหรับปีที่เลือก
async function sendMonthlyYearView(event, branchId, branchName, ce_year, pool, client) {
  try {
    const { money, redeem } = await fetchMonthlyData(pool, event.source.userId);
    const years = yearsForBranch(branchId, money, redeem);
    if (years.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: 'ไม่พบข้อมูลของสาขานี้ค่ะ' });
    const bubble = buildBranchMonthlyBubble(branchId, branchName, parseInt(ce_year), years, money, redeem);
    return client.replyMessage(event.replyToken, { type: "flex", altText: `รายเดือน ปี ${parseInt(ce_year) + 543}`, contents: bubble });
  } catch (err) { console.error('[sendMonthlyYearView]', err); }
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
        action: { type: "postback", label: m.branch_name, data: `SELECT_MACHINE_BRANCH:${m.branch_id}|${m.branch_name}` }
      }))
    }
  };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกสาขา", contents: bubble });
}

async function sendMultiMachineSelector(event, branchId, branchName, selectedIds, pool, client) {
  const res = await pool.query('SELECT DISTINCT machine_id FROM hourly_summary WHERE branch_id = $1 ORDER BY machine_id', [branchId]);
  const uniqueMachines = (res.rows || []).map(r => r.machine_id);

  if (uniqueMachines.length === 0) return client.replyMessage(event.replyToken, { type: 'text', text: `ไม่พบเครื่องในสาขา ${branchName} ค่ะ` });

  const currentListStr = selectedIds.join(',');
  const machineRows = uniqueMachines.map(mId => {
    const isSelected = selectedIds.includes(mId);
    const shortLabel = mId.substring(mId.lastIndexOf('_') + 1);
    return {
      type: "box", layout: "vertical", margin: "md", spacing: "xs",
      contents: [
        { type: "text", text: `เครื่อง ${shortLabel}`, size: "sm", color: isSelected ? "#000000" : "#555555", weight: isSelected ? "bold" : "regular" },
        { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: isSelected ? "✅ เลือกแล้ว" : "⬜ เลือกเปรียบเทียบ", data: `TOGGLE_MACHINE:${branchId}|${branchName}|${mId}|${currentListStr}` } },
        {
          type: "box", layout: "horizontal", spacing: "sm",
          contents: [
            { type: "button", style: "secondary", height: "sm", flex: 1, color: "#FF9500", action: { type: "postback", label: "🧹 ล้างยอด", data: `CONFIRM_CLEAR_MACHINE:${branchId}|${branchName}|${mId}` } },
            { type: "button", style: "secondary", height: "sm", flex: 1, color: "#FF3B30", action: { type: "postback", label: "🗑 ลบเครื่อง", data: `CONFIRM_DELETE_MACHINE:${branchId}|${branchName}|${mId}` } }
          ]
        },
        { type: "separator", margin: "sm" }
      ]
    };
  });

  const chunks = chunkArray(machineRows, 5);
  const bubbles = chunks.map(chunk => ({
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#FF1493", contents: [{ type: "text", text: `🔢 เลือกเครื่องเทียบ (${branchName})`, color: "#ffffff", weight: "bold" }, { type: "text", text: `เลือกแล้ว: ${selectedIds.length} เครื่อง`, color: "#ffffff", size: "xs" }] },
    body: { type: "box", layout: "vertical", contents: chunk },
    footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "primary", color: "#000000", margin: "sm", action: { type: "postback", label: selectedIds.length > 0 ? `🚀 เทียบยอด (${selectedIds.length})` : "กรุณาเลือกเครื่อง", data: selectedIds.length > 0 ? `CONFIRM_COMPARE:${currentListStr}` : "NOOP_NO_SELECTION" } }] }
  }));
  return client.replyMessage(event.replyToken, { type: "flex", altText: "เลือกเครื่อง", contents: { type: "carousel", contents: bubbles } });
}

// --- ลบเครื่อง / ลบข้อมูลเหรียญ-แบงค์-QR ทั้งหมดของเครื่อง ---
// หมายเหตุ: ระบบไม่มีตาราง "เครื่อง" แยกต่างหาก รายชื่อเครื่องถูกดึงมาจาก machine_id ที่มีอยู่ใน hourly_summary
// ดังนั้น "ลบเครื่อง" กับ "ลบข้อมูลทั้งหมดของเครื่อง" คือการลบแถวเดียวกัน ถ้ามีข้อมูลชื่อเครื่องเดิมส่งเข้ามาใหม่ เครื่องจะกลับมาแสดงเองอัตโนมัติ
async function sendDeleteMachineConfirm(event, branchId, branchName, machineId, client) {
  const bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#FF3B30", contents: [{ type: "text", text: "⚠️ ยืนยันการลบเครื่อง", color: "#ffffff", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        { type: "text", text: `เครื่อง ${machineId} (${branchName})`, weight: "bold", wrap: true },
        { type: "text", text: "ข้อมูลเหรียญ/แบงค์/QR ทั้งหมดของเครื่องนี้ (ทุกวันที่) จะถูกลบถาวร กู้คืนไม่ได้", size: "sm", color: "#FF3B30", wrap: true }
      ]
    },
    footer: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#FF3B30", action: { type: "postback", label: "✅ ยืนยันลบ", data: `DO_DELETE_MACHINE:${branchId}|${branchName}|${machineId}` } },
        { type: "button", style: "secondary", action: { type: "postback", label: "❌ ยกเลิก", data: `SELECT_MACHINE_BRANCH:${branchId}|${branchName}` } }
      ]
    }
  };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "ยืนยันการลบเครื่อง", contents: bubble });
}

async function deleteMachineData(event, branchId, branchName, machineId, pool, client) {
  try {
    await pool.query('DELETE FROM hourly_summary WHERE branch_id = $1 AND machine_id = $2', [branchId, machineId]);
    return client.replyMessage(event.replyToken, [
      { type: 'text', text: `✅ ลบเครื่อง ${machineId} และข้อมูลเหรียญ/แบงค์/QR ทั้งหมดเรียบร้อยค่ะ` }
    ]);
  } catch (err) {
    console.error("Delete Machine Error:", err);
    return client.replyMessage(event.replyToken, { type: 'text', text: 'เกิดข้อผิดพลาดในการลบข้อมูลค่ะบอส!' });
  }
}

// --- ล้างยอด: รีเซ็ตค่าเหรียญ/แบงค์/QR เป็น 0 แต่ยังคงแถวข้อมูลไว้ เครื่องจึงยังแสดงอยู่ในระบบ (ต่างจากลบเครื่องที่ลบแถวทิ้งทั้งหมด) ---
async function sendClearMachineConfirm(event, branchId, branchName, machineId, client) {
  const bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#FF9500", contents: [{ type: "text", text: "⚠️ ยืนยันการล้างยอด", color: "#ffffff", weight: "bold" }] },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        { type: "text", text: `เครื่อง ${machineId} (${branchName})`, weight: "bold", wrap: true },
        { type: "text", text: "ยอดเหรียญ/แบงค์/QR ทั้งหมดของเครื่องนี้ (ทุกวันที่) จะถูกรีเซ็ตเป็น 0 กู้คืนไม่ได้ แต่เครื่องนี้จะยังคงแสดงอยู่ในระบบเหมือนเดิม", size: "sm", color: "#FF9500", wrap: true }
      ]
    },
    footer: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "button", style: "primary", color: "#FF9500", action: { type: "postback", label: "✅ ยืนยันล้างยอด", data: `DO_CLEAR_MACHINE:${branchId}|${branchName}|${machineId}` } },
        { type: "button", style: "secondary", action: { type: "postback", label: "❌ ยกเลิก", data: `SELECT_MACHINE_BRANCH:${branchId}|${branchName}` } }
      ]
    }
  };
  return client.replyMessage(event.replyToken, { type: "flex", altText: "ยืนยันการล้างยอด", contents: bubble });
}

async function clearMachineData(event, branchId, branchName, machineId, pool, client) {
  try {
    await pool.query('UPDATE hourly_summary SET coin = 0, bank = 0, qr = 0 WHERE branch_id = $1 AND machine_id = $2', [branchId, machineId]);
    return client.replyMessage(event.replyToken, [
      { type: 'text', text: `✅ ล้างยอดเหรียญ/แบงค์/QR ของเครื่อง ${machineId} เรียบร้อยค่ะ` }
    ]);
  } catch (err) {
    console.error("Clear Machine Error:", err);
    return client.replyMessage(event.replyToken, { type: 'text', text: 'เกิดข้อผิดพลาดในการล้างยอดค่ะบอส!' });
  }
}

async function sendComparisonReport(event, idsStr, dateStr, pool, client) {
  try {
    const machineIds = idsStr.split(','); // แปลง "m1,m2" เป็น ["m1", "m2"]
    
    console.log(`[Compare] Date: ${dateStr}, IDs: ${idsStr}`);

    const res = await pool.query(
      `SELECT machine_id, SUM(coin + bank + qr) as total
       FROM hourly_summary
       WHERE machine_id = ANY($1)
       AND DATE(period_start AT TIME ZONE 'Asia/Bangkok') = $2::date
       GROUP BY machine_id`,
      [machineIds, dateStr]
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
        contents: [{ type: "button", style: "link", action: { type: "postback", label: "🔙 เลือกวันอื่น", data: `CONFIRM_COMPARE:${idsStr}` } }]
      }
    };

    return client.replyMessage(event.replyToken, { type: "flex", altText: "รายงานเปรียบเทียบ", contents: bubble });

  } catch (err) {
    console.error("Comparison Report Error:", err);
    return client.replyMessage(event.replyToken, { type: 'text', text: 'เกิดข้อผิดพลาดในการคำนวณยอดเปรียบเทียบค่ะบอส!' });
  }
}

// --- รายงานต่อเครื่อง (เลือกจากหน้า LIFF) : แยก เหรียญ/ธนบัตร/QR/แลกแต้ม ตามช่วงเวลาที่เลือก ---
function machineReportPeriodBounds(period, startStr, endStr) {
  const { dayStart, weekStart, monthStart } = getThaiPeriodBounds();
  const now = new Date();
  if (period === 'today') return { from: dayStart, to: now, label: 'วันนี้' };
  if (period === 'week')  return { from: weekStart, to: now, label: 'สัปดาห์นี้' };
  if (period === 'month') return { from: monthStart, to: now, label: 'เดือนนี้' };
  // custom: YYYY-MM-DD (เวลาไทย) รวมปลายทั้งวัน
  const from = new Date(`${startStr}T00:00:00+07:00`);
  const to = new Date(`${endStr}T23:59:59.999+07:00`);
  return { from, to, label: `${startStr} – ${endStr}` };
}

function mrRow(label, value, unit = '฿', color = '#000000') {
  return {
    type: "box", layout: "horizontal", margin: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#555555", flex: 5 },
      { type: "text", text: unit === '฿' ? `฿${value.toLocaleString()}` : `${value.toLocaleString()} ${unit}`, size: "sm", weight: "bold", align: "end", color, flex: 5 }
    ]
  };
}

// คืน array ของ flex messages (การ์ดแยกเครื่อง + การ์ดสรุปรวมเฉพาะเครื่องที่เลือก)
async function buildMachinePeriodReport(pool, machineIds, period, startStr, endStr) {
  const { from, to, label } = machineReportPeriodBounds(period, startStr, endStr);
  if (period === 'custom' && (isNaN(from) || isNaN(to) || from > to)) {
    return { error: 'ช่วงวันที่ไม่ถูกต้อง' };
  }

  const moneyRes = await pool.query(
    `SELECT machine_id, SUM(coin)::bigint coin, SUM(bank)::bigint bank, SUM(qr)::bigint qr
     FROM hourly_summary
     WHERE machine_id = ANY($1) AND period_start >= $2 AND period_start <= $3
     GROUP BY machine_id`,
    [machineIds, from.toISOString(), to.toISOString()]
  );
  const redeemRes = await pool.query(
    `SELECT machine_id, SUM(points)::bigint pts
     FROM point_events
     WHERE machine_id = ANY($1) AND type = 'redeem' AND created_at >= $2 AND created_at <= $3
     GROUP BY machine_id`,
    [machineIds, from.toISOString(), to.toISOString()]
  );

  const moneyMap = {}, redeemMap = {};
  moneyRes.rows.forEach(r => { moneyMap[r.machine_id.toLowerCase()] = { coin: Number(r.coin), bank: Number(r.bank), qr: Number(r.qr) }; });
  redeemRes.rows.forEach(r => { redeemMap[r.machine_id.toLowerCase()] = Number(r.pts); });

  const tot = { coin: 0, bank: 0, qr: 0, redeem: 0 };
  const machineCards = machineIds.map(mId => {
    const m = moneyMap[mId.toLowerCase()] || { coin: 0, bank: 0, qr: 0 };
    const pts = redeemMap[mId.toLowerCase()] || 0;
    tot.coin += m.coin; tot.bank += m.bank; tot.qr += m.qr; tot.redeem += pts;
    return {
      type: "box", layout: "vertical", margin: "md", spacing: "xs",
      contents: [
        { type: "text", text: `📟 ${mId}`, weight: "bold", size: "sm", color: "#111111", wrap: true },
        mrRow("🪙 เหรียญ", m.coin),
        mrRow("💵 ธนบัตร", m.bank),
        mrRow("📱 QR Code", m.qr),
        ...(pts > 0 ? [mrRow("🎫 แลกแต้ม", pts, "แต้ม", "#9C27B0")] : []),
        { type: "box", layout: "horizontal", contents: [
          { type: "text", text: "รวมเครื่องนี้", size: "xs", color: "#888888", flex: 5 },
          { type: "text", text: `฿${(m.coin + m.bank + m.qr).toLocaleString()}`, size: "xs", weight: "bold", align: "end", flex: 5 }
        ] },
        { type: "separator", margin: "md" }
      ]
    };
  });

  const cardMachines = {
    type: "bubble", size: "giga",
    header: { type: "box", layout: "vertical", backgroundColor: "#FF1493", contents: [
      { type: "text", text: "📊 รายงานต่อเครื่อง", color: "#ffffff", weight: "bold" },
      { type: "text", text: `ช่วง: ${label}  •  ${machineIds.length} เครื่อง`, color: "#ffffff", size: "xs" }
    ] },
    body: { type: "box", layout: "vertical", contents: machineCards }
  };

  const cardSummary = {
    type: "bubble", size: "giga",
    header: { type: "box", layout: "vertical", backgroundColor: "#333333", contents: [
      { type: "text", text: "🏆 สรุปรวม (เฉพาะเครื่องที่เลือก)", color: "#ffffff", weight: "bold" },
      { type: "text", text: `ช่วง: ${label}`, color: "#ffffff", size: "xs" }
    ] },
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      mrRow("🪙 เหรียญรวม", tot.coin),
      mrRow("💵 ธนบัตรรวม", tot.bank),
      mrRow("📱 QR รวม", tot.qr),
      ...(tot.redeem > 0 ? [mrRow("🎫 แลกแต้มรวม", tot.redeem, "แต้ม", "#9C27B0")] : []),
      { type: "separator", margin: "md" },
      { type: "box", layout: "horizontal", margin: "md", contents: [
        { type: "text", text: "รวมเงินทั้งหมด", weight: "bold", color: "#FF1493", flex: 5 },
        { type: "text", text: `฿${(tot.coin + tot.bank + tot.qr).toLocaleString()}`, weight: "bold", align: "end", color: "#FF1493", flex: 5 }
      ] },
      { type: "text", text: "* ยอดเงินไม่รวมส่วนที่จ่ายด้วยแต้ม", size: "xxs", color: "#aaaaaa", margin: "sm" }
    ] }
  };

  return { messages: [
    { type: "flex", altText: `รายงานต่อเครื่อง (${label})`, contents: cardMachines },
    { type: "flex", altText: `สรุปรวม (${label})`, contents: cardSummary }
  ] };
}

// --- Helpers ---
// บรรทัดย่อยใต้แถว QR — บอกว่าในยอด QR นั้นเป็นการแลกแต้มผ่าน LINE app เท่าไหร่ (1 แต้ม = 1 บาท)
// ใช้ text บรรทัดเดียว wrap ได้ จึงไม่กระทบความกว้างคอลัมน์ ว/ส/ด/รวม ด้านบน
function createRedeemNote(data) {
  return {
    type: "text",
    text: `(แลกแต้ม  D= ${data.day.toLocaleString()} / W= ${data.week.toLocaleString()} / M= ${data.month.toLocaleString()} / รวม= ${data.all.toLocaleString()})`,
    size: "xxs", color: "#9C27B0", wrap: true, margin: "xs"
  };
}

function createSummaryRow(label, data) {
  return {
    type: "box", layout: "vertical", spacing: "xs", margin: "sm",
    contents: [
      { type: "text", text: label, size: "xs", weight: "bold", color: "#555555" },
      {
        type: "box", layout: "horizontal",
        contents: [
          { type: "text", text: `D= ${data.day.toLocaleString()}`, size: "xxs", color: "#1DB446", flex: 2 },
          { type: "text", text: `W= ${data.week.toLocaleString()}`, size: "xxs", color: "#FF9900", flex: 2 },
          { type: "text", text: `M= ${data.month.toLocaleString()}`, size: "xxs", color: "#0099FF", flex: 2 },
          { type: "text", text: `รวม= ${data.all.toLocaleString()}`, size: "xxs", color: "#000000", weight: "bold", align: "end", flex: 3 }
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
        { type: "button", style: "primary", color: "#FF1493", action: { type: "postback", label: "วันนี้", data: `VIEW_COMPARE_REPORT:${idsStr}|${today}` } },
        { type: "button", style: "secondary", action: { type: "postback", label: "เมื่อวาน", data: `VIEW_COMPARE_REPORT:${idsStr}|${yesterday}` } },
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
  sendMonthlyYearMenu,
  sendMonthlyYearView,
  handleBranchReportLogic,
  handleMachineReportLogic,
  sendMultiMachineSelector,
  sendDeleteMachineConfirm,
  deleteMachineData,
  sendClearMachineConfirm,
  clearMachineData,
  sendComparisonReport,
  sendDateSelector,
  getPointReportMenu,
  handlePointReportLogic,
  sendPointReport,
  buildMachinePeriodReport,
  ALPHABET_GROUPS,
  chunkArray
};