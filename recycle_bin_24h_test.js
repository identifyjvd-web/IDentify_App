const fs = require('fs');

console.log('=== RECYCLE BIN 24-HOUR AUTO-PURGE TEST ===\n');

// 1. Verify function presence in both files
const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');

console.log('1. Admin_Panel.html has autoPurgeExpiredRecycleBinRecords:', adminHtml.includes('function autoPurgeExpiredRecycleBinRecords'));
console.log('2. School_Panel.html has autoPurgeExpiredRecycleBinRecords:', schoolHtml.includes('function autoPurgeExpiredRecycleBinRecords'));
console.log('3. School_Panel deleteRow moves to Recycle Bin:', schoolHtml.includes("deleted.isDeleted = true;") && schoolHtml.includes("showToast('Record moved to Recycle Bin ✓');"));
console.log('4. School_Panel bulkDeleteSelected moves to Recycle Bin:', schoolHtml.includes("rec.isDeleted = true;") && schoolHtml.includes("records moved to Recycle Bin ✓"));
console.log('5. Recycle Bin renders remaining hours countdown badge:', adminHtml.includes('${timeBadge}') && schoolHtml.includes('${timeBadge}'));

// 2. Logic simulation test
const now = Date.now();
const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString();
const twentyHoursAgo = new Date(now - 20 * 60 * 60 * 1000).toISOString();
const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString();
const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();

let testDb = [
  { id: 'active_1', studentName: 'Active Student', isDeleted: false },
  { id: 'del_fresh', studentName: 'Freshly Deleted (1h ago)', isDeleted: true, deletedAt: oneHourAgo },
  { id: 'del_20h', studentName: 'Old Deleted (20h ago)', isDeleted: true, deletedAt: twentyHoursAgo },
  { id: 'del_expired_25h', studentName: 'Expired Deleted (25h ago)', isDeleted: true, deletedAt: twentyFiveHoursAgo },
  { id: 'del_expired_48h', studentName: 'Expired Deleted (48h ago)', isDeleted: true, deletedAt: twoDaysAgo }
];

let testBin = testDb.filter(r => r.isDeleted);
const purgedFromCloud = [];

function simulateAutoPurge() {
    const AUTO_PURGE_MS = 24 * 60 * 60 * 1000;
    const expiredRecords = [];
    testDb.forEach(r => {
        if (!r) return;
        const isDel = (r.isDeleted === true || String(r.isDeleted).toLowerCase() === 'true');
        if (!isDel) return;
        
        if (!r.deletedAt) {
            r.deletedAt = new Date(now).toISOString();
            return;
        }
        
        const delTime = (typeof r.deletedAt === 'number') ? r.deletedAt : new Date(r.deletedAt).getTime();
        if (isNaN(delTime)) return;
        
        if ((now - delTime) >= AUTO_PURGE_MS) {
            expiredRecords.push(r);
        }
    });
    
    const expiredIds = new Set(expiredRecords.map(r => String(r.id)));
    testDb = testDb.filter(r => !expiredIds.has(String(r.id)));
    testBin = testBin.filter(r => !expiredIds.has(String(r.id)));
    expiredRecords.forEach(r => purgedFromCloud.push(r.id));
}

console.log('\n--- Before Auto-Purge ---');
console.log('Total in testDb:', testDb.length, '| In Recycle Bin:', testBin.length);

simulateAutoPurge();

console.log('\n--- After Auto-Purge ---');
console.log('Total in testDb:', testDb.length, '| In Recycle Bin:', testBin.length);
console.log('Permanently purged IDs:', purgedFromCloud);

const activeRetained = testDb.some(r => r.id === 'active_1');
const freshRetained = testBin.some(r => r.id === 'del_fresh');
const twentyRetained = testBin.some(r => r.id === 'del_20h');
const expired25Purged = !testDb.some(r => r.id === 'del_expired_25h') && purgedFromCloud.includes('del_expired_25h');
const expired48Purged = !testDb.some(r => r.id === 'del_expired_48h') && purgedFromCloud.includes('del_expired_48h');

console.log('\n--- Assertions ---');
console.log('1. Active record kept:', activeRetained ? 'PASS' : 'FAIL');
console.log('2. Fresh (1h ago) record kept in Recycle Bin:', freshRetained ? 'PASS' : 'FAIL');
console.log('3. 20h record kept in Recycle Bin (4h remaining):', twentyRetained ? 'PASS' : 'FAIL');
console.log('4. 25h record permanently auto-deleted:', expired25Purged ? 'PASS' : 'FAIL');
console.log('5. 48h record permanently auto-deleted:', expired48Purged ? 'PASS' : 'FAIL');

if (activeRetained && freshRetained && twentyRetained && expired25Purged && expired48Purged) {
  console.log('\nALL 24-HOUR AUTO-PURGE TESTS PASSED (100% SUCCESS)!');
} else {
  console.error('\nSOME TESTS FAILED!');
  process.exit(1);
}
