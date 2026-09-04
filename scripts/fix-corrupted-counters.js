// One-time cleanup: แก้ค่า coin/bank/qr ใน hourly_summary ที่ถูกบันทึกผิดไปแล้ว
// ก่อนที่จะมี sanitizeCounter() ใน index.js (แพตเทิร์นบั๊ก ESP32: n -> (n<<16)|n หรือ n<<16)
// ใช้ตรรกะเดียวกับ sanitizeCounter(): เพดานค่าที่สมเหตุสมผลต่อ period คือ MAX_REASONABLE_PER_PERIOD
// ค่าที่ตรงแพตเทิร์น bit-shift ที่รู้จักและแก้แล้วอยู่ในเพดาน -> แก้เป็นค่าจริง
// ค่าที่เกินเพดานแต่ไม่ตรงแพตเทิร์นที่รู้จัก (เดาค่าจริงไม่ได้) -> เซ็ตเป็น 0 แทนการปล่อยขยะไว้
//
// วิธีใช้: DATABASE_URL=... node scripts/fix-corrupted-counters.js [--apply]
// ไม่ใส่ --apply = dry-run (แสดงรายการที่จะแก้ ไม่เขียนจริง)

require('dotenv').config();
const { Pool } = require('pg');

const MAX_REASONABLE_PER_PERIOD = 999;
const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function fixValue(v) {
  const hi = v >>> 16;
  const lo = v & 0xFFFF;
  if (hi > 0 && (lo === 0 || lo === hi) && hi <= MAX_REASONABLE_PER_PERIOD) return hi;
  return 0; // เกินเพดานและเดาค่าจริงไม่ได้ -> ล้างเป็น 0 ต้องไปตรวจสอบยอดจริงหน้างานเอง
}

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id, machine_id, period_start, coin, bank, qr
       FROM hourly_summary
       WHERE coin > $1 OR bank > $1 OR qr > $1
       ORDER BY period_start`,
      [MAX_REASONABLE_PER_PERIOD]
    );

    if (rows.length === 0) {
      console.log(`ไม่พบแถวที่ค่าผิดปกติ (> ${MAX_REASONABLE_PER_PERIOD})`);
      return;
    }

    console.log(`พบ ${rows.length} แถวที่ค่าสูงผิดปกติ:`);
    for (const row of rows) {
      const coinFixed = row.coin > MAX_REASONABLE_PER_PERIOD ? fixValue(row.coin) : row.coin;
      const bankFixed = row.bank > MAX_REASONABLE_PER_PERIOD ? fixValue(row.bank) : row.bank;
      const qrFixed = row.qr > MAX_REASONABLE_PER_PERIOD ? fixValue(row.qr) : row.qr;

      const guessed = (row.coin > MAX_REASONABLE_PER_PERIOD && coinFixed === 0)
        || (row.bank > MAX_REASONABLE_PER_PERIOD && bankFixed === 0)
        || (row.qr > MAX_REASONABLE_PER_PERIOD && qrFixed === 0);

      console.log(
        `  machine=${row.machine_id} period_start=${row.period_start.toISOString()} `
        + `coin ${row.coin}->${coinFixed} bank ${row.bank}->${bankFixed} qr ${row.qr}->${qrFixed}`
        + (guessed ? '  [ไม่ตรงแพตเทิร์นที่รู้จัก ล้างเป็น 0 - ตรวจสอบยอดจริงหน้างานถ้าต้องการ]' : '')
      );

      if (apply) {
        await pool.query(
          'UPDATE hourly_summary SET coin = $1, bank = $2, qr = $3 WHERE id = $4',
          [coinFixed, bankFixed, qrFixed, row.id]
        );
      }
    }

    console.log(apply ? '\nแก้ไขเสร็จแล้ว' : '\nDry-run เท่านั้น ใส่ --apply เพื่อเขียนจริง');
  } catch (err) {
    console.error('เกิดข้อผิดพลาด:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
