const fs = require('fs');

console.log('=== MULTI-DEVICE SN & STALE DATA SYNC SIMULATION ===\n');

// 1. Simulation of Firebase Server Store
const firebaseStore = {
  schools: {
    school_dps: {
      records: new Map()
    }
  }
};

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
        // extractSnNumber logic
        const str = String(rawSn).trim();
        if (/^\d+$/.test(str)) num = parseInt(str, 10) || 0;
        else {
          const m = str.match(/^[A-Za-z]+\d{2}(\d+)$/);
          if (m) num = parseInt(m[1], 10) || 0;
          else {
            const m2 = str.match(/(\d+)$/);
            num = m2 ? (parseInt(m2[1], 10) || 0) : (parseInt(str, 10) || 0);
          }
        }
    }
    return `${si}${year}${String(num).padStart(4, '0')}`;
}

// Device A creates 3 records on Firebase
const dNow = Date.now();
const record1 = { id: 'rec_DPS_1001_abc', sn: 1, studentName: 'Rohan', sclass: '10th', createdAt: dNow - 100000, updatedAt: dNow - 50000, schoolId: 'school_dps', schoolCode: 'DPS' };
const record2 = { id: 'rec_DPS_1002_def', sn: 2, studentName: 'Priya', sclass: '10th', createdAt: dNow - 90000, updatedAt: dNow - 40000, schoolId: 'school_dps', schoolCode: 'DPS' };
const record3 = { id: 'rec_DPS_1003_ghi', sn: 3, studentName: 'Aman', sclass: '9th', createdAt: dNow - 80000, updatedAt: dNow - 30000, schoolId: 'school_dps', schoolCode: 'DPS' };

firebaseStore.schools.school_dps.records.set(record1.id, { ...record1 });
firebaseStore.schools.school_dps.records.set(record2.id, { ...record2 });
firebaseStore.schools.school_dps.records.set(record3.id, { ...record3 });

console.log('--- Step 1: Device A created records on Server ---');
firebaseStore.schools.school_dps.records.forEach(r => {
  console.log(`Server Record: ID=${r.id}, Name=${r.studentName}, SN=${r.sn}, Display SN=${formatRecordSn(r)}`);
});

// Step 2: Device B (Old Device) has old historical memory from 1 month ago
// Notice: Device B has an old version of record 1 with old name and outdated SN
const deviceBOldMemory = [
  { id: 'rec_DPS_1001_abc', sn: 99, studentName: 'Old Rohan Name', sclass: '8th', createdAt: dNow - 100000, updatedAt: dNow - 1000000, _pending: false, schoolId: 'school_dps' },
  { id: 'rec_DPS_OLD_GHOST', sn: 50, studentName: 'Deleted Student', sclass: '10th', createdAt: dNow - 2000000, updatedAt: dNow - 2000000, _pending: false, schoolId: 'school_dps' }
];

console.log('\n--- Step 2: Device B opens with old cached records ---');
console.log('Old local memory before sync has:', deviceBOldMemory.map(r => r.id));

// Device B runs loadAllData logic
const cleanServerDb = Array.from(firebaseStore.schools.school_dps.records.values());

// Device B sync merge logic:
const currentLocalDb = deviceBOldMemory;
const pendingLocal = currentLocalDb.filter(r => r && r._pending); // Only truly pending edits
const mergedDb = cleanServerDb.map(sRec => {
  const lRec = pendingLocal.find(l => String(l.id) === String(sRec.id));
  if (lRec) {
    const res = { ...sRec, ...lRec };
    if (sRec.sn) res.sn = sRec.sn; // Server SN strictly wins!
    return res;
  }
  const memRec = currentLocalDb.find(l => l && String(l.id) === String(sRec.id));
  if (memRec) {
    const res = { ...sRec }; // Server record is the base!
    if (sRec.sn) res.sn = sRec.sn; // Server SN strictly wins!
    return res;
  }
  return sRec;
});

// Notice: rec_DPS_OLD_GHOST was not on server, and was not _pending, so it is DROPPED!
pendingLocal.forEach(lRec => {
  if (!mergedDb.some(m => String(m.id) === String(lRec.id))) {
    mergedDb.push(lRec);
  }
});

console.log('\n--- Step 3: Device B after syncing fresh data from Server ---');
let allSnsMatch = true;
mergedDb.forEach(r => {
  const serverRec = firebaseStore.schools.school_dps.records.get(r.id);
  const displaySn = formatRecordSn(r);
  const serverDisplaySn = formatRecordSn(serverRec);
  const snMatch = displaySn === serverDisplaySn;
  if (!snMatch) allSnsMatch = false;
  console.log(`Device B: ID=${r.id}, Name="${r.studentName}", SN=${r.sn}, Display SN=${displaySn} | Matches Server: ${snMatch ? 'YES' : 'NO'}`);
});

console.log('\n--- Verification Checks ---');
console.log('1. Did Device B drop the deleted/ghost record "rec_DPS_OLD_GHOST"?', !mergedDb.some(r => r.id === 'rec_DPS_OLD_GHOST') ? 'PASS (Yes, dropped!)' : 'FAIL');
console.log('2. Did Device B get the updated student name "Rohan" instead of "Old Rohan Name"?', mergedDb.find(r => r.id === 'rec_DPS_1001_abc').studentName === 'Rohan' ? 'PASS (Yes, updated!)' : 'FAIL');
console.log('3. Did Device B show SN=1 (DPS260001) instead of old SN=99?', mergedDb.find(r => r.id === 'rec_DPS_1001_abc').sn === 1 ? 'PASS (Yes, server SN won!)' : 'FAIL');
console.log('4. Did all SNs across Device A and Device B match 100%?', allSnsMatch ? 'PASS (100% Match!)' : 'FAIL');
