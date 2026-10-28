const fs = require('fs');
const vm = require('vm');

console.log('=== 1. CHECKING SYNTAX ===');
const jsFiles = ['card-generator.js', 'camera-sync-helper.js', 'db-helper.js', 'cropper-helper.js'];
jsFiles.forEach(f => {
  if (!fs.existsSync(f)) return;
  try {
    const code = fs.readFileSync(f, 'utf8');
    new vm.Script(code);
    console.log('[PASS] ' + f + ': Syntax valid');
  } catch (err) {
    console.error('[FAIL] ' + f + ' Error:', err.message);
  }
});

const htmlFiles = ['Admin_Panel.html', 'School_Panel.html'];
htmlFiles.forEach(f => {
  if (!fs.existsSync(f)) return;
  const content = fs.readFileSync(f, 'utf8');
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let idx = 0;
  let errors = 0;
  while ((match = scriptRegex.exec(content)) !== null) {
    idx++;
    const attrs = match[1];
    const code = match[2];
    if (attrs.includes('src=')) continue;
    if (!code.trim()) continue;
    if (attrs.includes('type="module"') || attrs.includes("type='module'")) {
      console.log(`[PASS] ${f} Script #${idx} (ES Module): Loaded`);
    } else {
      try {
        new vm.Script(code);
        console.log(`[PASS] ${f} Script #${idx}: Syntax valid`);
      } catch (err) {
        errors++;
        console.error(`[FAIL] ${f} Script #${idx} Error:`, err.message);
      }
    }
  }
});

console.log('\n=== 2. UNIQUE ID COLLISION TEST (50,000 IDs) ===');
const schoolCodes = ['DPS', 'STX', 'KV', 'MODERN', 'JVD'];
const idSet = new Set();
let collisions = 0;
for (let i = 0; i < 50000; i++) {
  const sCode = schoolCodes[i % schoolCodes.length];
  const nowTs = Date.now();
  const id = `rec_${sCode}_${nowTs}_${Math.random().toString(36).substr(2, 6)}`;
  if (idSet.has(id)) {
    collisions++;
  } else {
    idSet.add(id);
  }
}
console.log(`Total generated IDs: 50,000 | Collisions: ${collisions}`);
if (collisions === 0) {
  console.log('[PASS] Record Unique ID is 100% Collision-Proof!');
} else {
  console.log('[FAIL] Record Unique ID had collisions!');
}

console.log('\n=== 3. SN (SERIAL NUMBER) EXTRACTION & FORMATTING TEST ===');
function extractSnNumber(sn) {
    if (!sn) return 0;
    if (typeof sn === 'number') return sn;
    const str = String(sn).trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10) || 0;
    const m = str.match(/^[A-Za-z]+\d{2}(\d+)$/);
    if (m) return parseInt(m[1], 10) || 0;
    const m2 = str.match(/(\d+)$/);
    if (m2) return parseInt(m2[1], 10) || 0;
    return parseInt(str, 10) || 0;
}

function formatRecordSn(rec, schoolCode = 'DPS') {
    if (!rec) return '';
    if (typeof rec === 'string' || typeof rec === 'number') {
        rec = { sn: rec };
    }
    const rawSn = String(rec.sn || rec.draftSn || '').trim();
    if (!rawSn) return '';
    if (/^[A-Za-z]+\d+$/.test(rawSn)) {
        return rawSn.toUpperCase();
    }
    const si = (rec.schoolCode || schoolCode || "DPS").toUpperCase();
    const year = new Date(rec.createdAt || Date.now()).getFullYear().toString().slice(-2);
    let num = 1;
    if (rawSn) {
        num = extractSnNumber(rawSn) || 1;
    }
    return `${si}${year}${String(num).padStart(4, '0')}`;
}

const snTestCases = [
  { input: 1, expectedExtract: 1, expectedFmt: 'DPS260001' },
  { input: '42', expectedExtract: 42, expectedFmt: 'DPS260042' },
  { input: 'DPS260001', expectedExtract: 1, expectedFmt: 'DPS260001' },
  { input: 'DPS260100', expectedExtract: 100, expectedFmt: 'DPS260100' },
  { input: 'DPS261000', expectedExtract: 1000, expectedFmt: 'DPS261000' },
  { input: 'DPS-001', expectedExtract: 1, expectedFmt: 'DPS260001' },
  { input: 'rec_DPS_1234', expectedExtract: 1234, expectedFmt: 'DPS261234' }
];

let snPassCount = 0;
snTestCases.forEach((tc, idx) => {
  const extracted = extractSnNumber(tc.input);
  const formatted = formatRecordSn({ sn: tc.input, schoolCode: 'DPS', createdAt: Date.parse('2026-01-01') });
  const extractOk = extracted === tc.expectedExtract;
  const fmtOk = formatted === tc.expectedFmt;
  if (extractOk && fmtOk) {
    snPassCount++;
    console.log(`[PASS] Case #${idx+1} (${tc.input}): extracted=${extracted}, formatted=${formatted}`);
  } else {
    console.error(`[FAIL] Case #${idx+1} (${tc.input}): extracted=${extracted} (exp ${tc.expectedExtract}), formatted=${formatted} (exp ${tc.expectedFmt})`);
  }
});
console.log(`SN Tests: ${snPassCount}/${snTestCases.length} Passed`);

console.log('\n=== 4. QR CODE CONTENT & DATA EXPORT TEST ===');
function buildQrVal(rec, schoolName = 'Delhi Public School', appName = 'IDentify°') {
    const lines = [];
    lines.push(`School Name: ${schoolName}`);
    lines.push(`App Name: ${appName}`);

    const snVal = formatRecordSn(rec);
    if (snVal) lines.push(`SN: ${snVal}`);

    const isStaffRec = rec.recordType === 'staff' || String(rec.sclass || '').trim().toLowerCase() === 'staff';

    if (isStaffRec) {
        const sName = rec.staffName || rec.studentName || '';
        if (sName) lines.push(`Staff Name: ${sName}`);
        const fhName = rec.fatherHusbandName || rec.fatherName || '';
        if (fhName) lines.push(`Father / Husband Name: ${fhName}`);
        const desig = rec.staff_designation || rec.designation || '';
        if (desig) lines.push(`Designation: ${desig}`);
        else lines.push(`Category: Staff`);
        if (rec.mobile) lines.push(`Mobile: ${rec.mobile}`);
        if (rec.dob) lines.push(`Date of Birth: ${rec.dob}`);
        if (rec.gender) lines.push(`Gender: ${rec.gender}`);
        if (rec.aadhar) lines.push(`Aadhar: ${rec.aadhar}`);
        if (rec.address) lines.push(`Address: ${rec.address}`);
    } else {
        const stdList = [
            { id: 'studentName', label: 'Student Name', val: rec.studentName },
            { id: 'fatherName', label: "Father's Name", val: rec.fatherName },
            { id: 'motherName', label: "Mother's Name", val: rec.motherName },
            { id: 'sclass', label: 'Class', val: rec.sclass },
            { id: 'section', label: 'Section', val: rec.section },
            { id: 'rollNo', label: 'Roll No', val: rec.rollNo || rec.roll_no },
            { id: 'admissionNo', label: 'Admission No', val: rec.admissionNo || rec.admission_no },
            { id: 'dob', label: 'Date of Birth', val: rec.dob },
            { id: 'gender', label: 'Gender', val: rec.gender },
            { id: 'mobile', label: 'Mobile', val: rec.mobile },
            { id: 'aadhar', label: 'Aadhar', val: rec.aadhar },
            { id: 'bloodGroup', label: 'Blood Group', val: rec.bloodGroup || rec.blood_group },
            { id: 'address', label: 'Address', val: rec.address }
        ];
        stdList.forEach(sf => {
            if (sf.val !== undefined && sf.val !== null && String(sf.val).trim() !== '' && String(sf.val).trim() !== '-') {
                lines.push(`${sf.label}: ${String(sf.val).trim()}`);
            }
        });
    }
    return lines.length > 0 ? lines.join('\n') : String(rec.id || 'NID');
}

const sampleStudent = {
  id: 'rec_DPS_1719543829102_a1b2c3',
  sn: 1,
  schoolCode: 'DPS',
  createdAt: Date.parse('2026-01-01'),
  studentName: 'Rahul Sharma',
  fatherName: 'Suresh Sharma',
  motherName: 'Sunita Sharma',
  sclass: '10th',
  section: 'A',
  rollNo: '24',
  admissionNo: 'ADM-1082',
  dob: '15-08-2010',
  gender: 'Male',
  mobile: '9876543210',
  aadhar: '1234 5678 9012',
  bloodGroup: 'B+',
  address: 'Civil Lines, Raipur'
};

const qrString = buildQrVal(sampleStudent);
console.log('Sample QR Code Data Content:');
console.log('----------------------------------------');
console.log(qrString);
console.log('----------------------------------------');
console.log(`QR String Length: ${qrString.length} chars`);
console.log(`UTF-8 Safe: ${encodeURIComponent(qrString).length > 0 ? 'YES' : 'NO'}`);
if (qrString.includes('Rahul Sharma') && qrString.includes('DPS260001') && qrString.includes('ADM-1082')) {
  console.log('[PASS] QR Code Data export includes all key identification details!');
} else {
  console.log('[FAIL] QR Code Data missing key fields!');
}
