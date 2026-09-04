// One-time cleanup: แก้ค่า coin/bank/qr ใน hourly_summary ที่ถูกบันทึกผิดไปแล้ว
// ก่อนที่จะมี sanitizeCounter() ใน index.js (แพตเทิร์นบั๊ก ESP32: n -> (n<<16)|n หรือ n<<16)
// รันครั้งเดียวหลัง deploy fix เพื่อล้างข้อมูลที่ค้างเป็นค่าพังอยู่ในฐานข้อมูล
//
// วิธีใช้: DATABASE_URL=... node scripts/fix-corrupted-counters.js [--apply]
// ไม่ใส่ --apply = dry-run (แสดงรายการที่จะแก้ ไม่เขียนจริง)

require('dotenv').config();
const { Pool } = require('pg');

const apply = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function fixValue(v) {
  const hi = v >>> 16;
  const lo = v & 0xFFFF;
  if (hi > 0 && (lo === 0 || lo === hi)) return hi;
  return null; // ไม่ตรงแพตเทิร์นที่รู้จัก ไม่แตะ
}

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id, machine_id, period_start, coin, bank, qr
       FROM hourly_summary
       WHERE coin > 65535 OR bank > 65535 OR qr > 65535
       ORDER BY period_start`
    );

    if (rows.length === 0) {
      console.log('ไม่พบแถวที่ค่าผิดปกติ (> 65535)');
      return;
    }

    console.log(`พบ ${rows.length} แถวที่ค่าสูงผิดปกติ:`);
    for (const row of rows) {
      const coinFixed = row.coin > 65535 ? fixValue(row.coin) : row.coin;
      const bankFixed = row.bank > 65535 ? fixValue(row.bank) : row.bank;
      const qrFixed = row.qr > 65535 ? fixValue(row.qr) : row.qr;

      const unresolved = (row.coin > 65535 && coinFixed === null)
        || (row.bank > 65535 && bankFixed === null)
        || (row.qr > 65535 && qrFixed === null);

      console.log(
        `  machine=${row.machine_id} period_start=${row.period_start.toISOString()} `
        + `coin ${row.coin}->${coinFixed} bank ${row.bank}->${bankFixed} qr ${row.qr}->${qrFixed}`
        + (unresolved ? '  [ไม่ตรงแพตเทิร์นที่รู้จัก ต้องตรวจด้วยตนเอง]' : '')
      );

      if (apply && !unresolved) {
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
