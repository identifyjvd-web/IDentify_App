/**
 * IDentify App - Automated Smoke Test Suite
 * Run anytime with: node smoke_test.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function pass(name, msg = '') {
  console.log(`  ${COLORS.green}✔ PASS${COLORS.reset} - ${COLORS.bright}${name}${COLORS.reset} ${COLORS.gray}${msg}${COLORS.reset}`);
}

function fail(name, err) {
  console.log(`  ${COLORS.red}✖ FAIL${COLORS.reset} - ${COLORS.bright}${name}${COLORS.reset}: ${COLORS.red}${err}${COLORS.reset}`);
}

function info(msg) {
  console.log(`\n${COLORS.cyan}${COLORS.bright}▶ ${msg}${COLORS.reset}`);
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    pass(name);
  } catch (e) {
    failedTests++;
    fail(name, e.message);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    pass(name);
  } catch (e) {
    failedTests++;
    fail(name, e.message);
  }
}

console.log(`${COLORS.bright}=====================================================`);
console.log(` 🩺 IDentify App - Automated Smoke Test Engine`);
console.log(`=====================================================${COLORS.reset}`);

// --- SUITE 1: File Existence & Syntax Integrity ---
info('Suite 1: File Existence & JavaScript Syntax Verification');

const CRITICAL_FILES = [
  'Admin_Panel.html',
  'School_Panel.html',
  'Login_Panel.html',
  'db-helper.js',
  'index.html',
  'manifest.json'
];

CRITICAL_FILES.forEach(file => {
  runTest(`File exists: ${file}`, () => {
    if (!fs.existsSync(file)) throw new Error(`Missing required file ${file}`);
  });
});

CRITICAL_FILES.filter(f => f.endsWith('.js') || f.endsWith('.html')).forEach(file => {
  runTest(`Syntax check: ${file}`, () => {
    const content = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.js')) {
      new vm.Script(content);
    } else {
      const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
      let match;
      let count = 0;
      while ((match = scriptRegex.exec(content)) !== null) {
        count++;
        const attrs = match[1];
        const code = match[2];
        if (attrs.includes('src=')) continue;
        const isModule = attrs.includes('type="module"') || attrs.includes("type='module'");
        if (isModule) {
          new vm.Script(code.replace(/import\s+[^;]+from\s+['"][^'"]+['"];?/g, '// import'));
        } else {
          new vm.Script(code);
        }
      }
    }
  });
});

// --- SUITE 2: Core Logic & Helper Functions ---
info('Suite 2: Database Helper Functions & Logic Rules');

const dbHelperCode = fs.readFileSync('db-helper.js', 'utf8');
// Create sandbox context to test pure helper functions from db-helper.js
const sandbox = {
  window: {},
  document: { addEventListener: () => {} },
  navigator: { userAgent: 'Node' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  indexedDB: { open: () => ({ onsuccess: () => {}, onerror: () => {} }) },
  console: console
};
sandbox.window = sandbox;

try {
  vm.createContext(sandbox);
  // Execute db-helper in sandbox (stubbing firebaseAPI)
  vm.runInContext(dbHelperCode.replace(/import\s+[^;]+from\s+['"][^'"]+['"];?/g, '// import'), sandbox);
} catch (e) {
  console.warn('Sandbox load warning:', e.message);
}

runTest('extractSnNumber correctly parses multiple formats', () => {
  const extract = sandbox.extractSnNumber;
  if (!extract) throw new Error('extractSnNumber not found in db-helper.js');
  if (extract('DPS26001') !== 1) throw new Error(`Expected 1, got ${extract('DPS26001')}`);
  if (extract('DPS26045') !== 45) throw new Error(`Expected 45, got ${extract('DPS26045')}`);
  if (extract('DPS260001') !== 1) throw new Error(`Expected 1, got ${extract('DPS260001')}`);
  if (extract('123') !== 123) throw new Error(`Expected 123, got ${extract('123')}`);
  if (extract('SN: 50') !== 50) throw new Error(`Expected 50, got ${extract('SN: 50')}`);
});

runTest('formatRecordSn preserves valid formatted SNs', () => {
  const format = sandbox.formatRecordSn;
  if (!format) throw new Error('formatRecordSn not found in db-helper.js');
  if (format('DPS26001') !== 'DPS26001') throw new Error(`Expected DPS26001, got ${format('DPS26001')}`);
  if (format('DPS260001') !== 'DPS260001') throw new Error(`Expected DPS260001, got ${format('DPS260001')}`);
  if (format({ sn: 'DPS26005' }) !== 'DPS26005') throw new Error(`Expected DPS26005, got ${format({ sn: 'DPS26005' })}`);
});

runTest('shouldSyncRecordToServer strictly rejects draft records', () => {
  const shouldSync = sandbox.shouldSyncRecordToServer;
  if (!shouldSync) throw new Error('shouldSyncRecordToServer not found in db-helper.js');
  // Draft records must NEVER sync
  const draftItem = { id: 'draft_DPS-1782579664779', studentName: 'Test Draft', fatherName: 'Father' };
  if (shouldSync('addRecord', [draftItem]) !== false) {
    throw new Error('shouldSyncRecordToServer allowed draft_ record to sync!');
  }
  if (shouldSync('updateRecord', [draftItem]) !== false) {
    throw new Error('shouldSyncRecordToServer allowed draft_ record to update!');
  }
});

runTest('shouldSyncRecordToServer requires valid student or staff name', () => {
  const shouldSync = sandbox.shouldSyncRecordToServer;
  const namelessItem = { id: 'rec_DPS_12345_abc', studentName: '', fatherName: 'Father' };
  if (shouldSync('addRecord', [namelessItem]) !== false) {
    throw new Error('shouldSyncRecordToServer allowed nameless record to sync!');
  }
  const validItem = { id: 'rec_DPS_12345_abc', studentName: 'Rahul Kumar' };
  if (shouldSync('addRecord', [validItem]) !== true) {
    throw new Error('shouldSyncRecordToServer blocked valid record from syncing!');
  }
});

// --- SUITE 3: Multi-School Isolation & Security ---
info('Suite 3: Multi-School Data Isolation & Integrity');

runTest('Admin_Panel.html has multi-school discovery logic', () => {
  const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
  if (!adminHtml.includes('syncAllSchoolsFromFirebase')) {
    throw new Error('Admin_Panel.html missing syncAllSchoolsFromFirebase');
  }
  if (!adminHtml.includes('recordBelongsToSchool')) {
    throw new Error('Admin_Panel.html missing recordBelongsToSchool');
  }
});

runTest('School_Panel.html strictly isolates school records', () => {
  const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');
  if (!schoolHtml.includes('recordBelongsToSchool')) {
    throw new Error('School_Panel.html missing recordBelongsToSchool');
  }
  // Check that draft_ is rejected in recordBelongsToSchool
  if (!schoolHtml.includes("rec.id && String(rec.id).startsWith('draft_')")) {
    throw new Error('recordBelongsToSchool does not reject draft_ records');
  }
});

// --- SUITE 4: UI & Splash Screen Placement ---
info('Suite 4: Visual UI, Icon & Splash Screen Alignment');

runTest('Splash screen app icon is positioned prominently above center (-mt-36)', () => {
  const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
  const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');
  const loginHtml = fs.readFileSync('Login_Panel.html', 'utf8');

  if (!adminHtml.includes('-mt-36')) throw new Error('Admin_Panel splash icon not positioned with -mt-36');
  if (!schoolHtml.includes('-mt-36')) throw new Error('School_Panel splash icon not positioned with -mt-36');
  if (!loginHtml.includes('-mt-36')) throw new Error('Login_Panel splash icon not positioned with -mt-36');
});

runTest('Splash screen icon size is calibrated to full original 180px', () => {
  const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
  const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');
  const loginHtml = fs.readFileSync('Login_Panel.html', 'utf8');

  if (!adminHtml.includes('w-[180px] h-[180px]')) throw new Error('Admin_Panel splash icon not sized to 180px');
  if (!schoolHtml.includes('w-[180px] h-[180px]')) throw new Error('School_Panel splash icon not sized to 180px');
  if (!loginHtml.includes('w-[180px] h-[180px]')) throw new Error('Login_Panel splash icon not sized to 180px');
});

// --- SUITE 5: Staff Mode & Form Builder Switcher Verification ---
info('Suite 5: Staff Mode, Form Builder Switcher & Dynamic Class Dropdown');

runTest('Form Builder staff switcher appears/hides immediately with inline display style', () => {
  const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
  const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');

  const pattern = 'id="fb_view_switcher" style="display:';
  if (!adminHtml.includes(pattern)) throw new Error('Admin_Panel fb_view_switcher missing dynamic inline style');
  if (!schoolHtml.includes(pattern)) throw new Error('School_Panel fb_view_switcher missing dynamic inline style');

  if (!adminHtml.includes('fb_staff_enable" ${fb_staff_active ? \'checked\' : \'\'}')) {
    throw new Error('Admin_Panel fb_staff_enable missing dynamic checked attribute');
  }
  if (!schoolHtml.includes('fb_staff_enable" ${fb_staff_active ? \'checked\' : \'\'}')) {
    throw new Error('School_Panel fb_staff_enable missing dynamic checked attribute');
  }

  // Ensure 300ms CSS animation is removed from switcher so it opens in 0ms
  if (adminHtml.includes('id="fb_view_switcher"') && adminHtml.includes('id="fb_view_switcher" style="display: ${(typeof fb_staff_active !== \'undefined\' && fb_staff_active) ? \'flex\' : \'none\'};" class="${(typeof fb_staff_active !== \'undefined\' && fb_staff_active) ? \'flex\' : \'hidden\'} mb-4 system-card p-1.5 rounded-2xl border border-emerald-100 bg-emerald-50/60 shadow-sm items-center justify-between gap-2 transition-all duration-300')) {
    throw new Error('Admin_Panel fb_view_switcher still has 300ms transition delay');
  }
  if (schoolHtml.includes('id="fb_view_switcher"') && schoolHtml.includes('id="fb_view_switcher" style="display: ${(typeof fb_staff_active !== \'undefined\' && fb_staff_active) ? \'flex\' : \'none\'};" class="${(typeof fb_staff_active !== \'undefined\' && fb_staff_active) ? \'flex\' : \'hidden\'} mb-4 system-card p-1.5 rounded-2xl border border-emerald-100 bg-emerald-50/60 shadow-sm items-center justify-between gap-2 transition-all duration-300')) {
    throw new Error('School_Panel fb_view_switcher still has 300ms transition delay');
  }

  // Ensure onclick is bound for immediate touch response
  if (!adminHtml.includes('onclick="fb_toggleStaffActive(this.checked)"')) {
    throw new Error('Admin_Panel fb_staff_enable missing onclick binding');
  }
  if (!schoolHtml.includes('onclick="fb_toggleStaffActive(this.checked)"')) {
    throw new Error('School_Panel fb_staff_enable missing onclick binding');
  }
});

runTest('fb_toggleStaffActive does not invoke filterRecords to prevent DOM flicker', () => {
  const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
  const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');

  const getBody = (html) => {
    const start = html.indexOf('function fb_toggleStaffActive(');
    const end = html.indexOf('showToast(', start);
    return html.substring(start, end);
  };

  if (getBody(adminHtml).includes('filterRecords()')) {
    throw new Error('Admin_Panel fb_toggleStaffActive unexpectedly calls filterRecords()');
  }
  if (getBody(schoolHtml).includes('filterRecords()')) {
    throw new Error('School_Panel fb_toggleStaffActive unexpectedly calls filterRecords()');
  }
});

runTest('Class dropdown includes Staff when staff active and strips Staff when disabled', () => {
  const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
  const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');

  [adminHtml, schoolHtml].forEach((html, i) => {
    const name = i === 0 ? 'Admin_Panel' : 'School_Panel';
    if (!html.includes("classOptionsWithCurrent.push('Staff')")) {
      throw new Error(`${name} toggleFormDropdown does not push Staff when active`);
    }
    if (!html.includes("classOptionsWithCurrent = classOptionsWithCurrent.filter(v => String(v).trim().toLowerCase() !== 'staff')")) {
      throw new Error(`${name} toggleFormDropdown does not filter out Staff when disabled`);
    }
  });
});

runTest('Class dropdown change to Staff dynamically switches to Staff form', () => {
  const adminHtml = fs.readFileSync('Admin_Panel.html', 'utf8');
  const schoolHtml = fs.readFileSync('School_Panel.html', 'utf8');

  [adminHtml, schoolHtml].forEach((html, i) => {
    const name = i === 0 ? 'Admin_Panel' : 'School_Panel';
    if (!html.includes('const wasStaff = prevVal.toLowerCase() === \'staff\';') && !html.includes('const wasStaff = prevClass.toLowerCase() === \'staff\';')) {
      throw new Error(`${name} selectFormDropdownOption missing wasStaff detection`);
    }
    if (!html.includes('if (wasStaff !== isNowStaff)')) {
      throw new Error(`${name} selectFormDropdownOption missing form switch trigger on wasStaff !== isNowStaff`);
    }
  });
});

// --- SUITE 6: Summary Dashboard ---
console.log(`\n${COLORS.bright}=====================================================`);
console.log(` Smoke Test Results:`);
console.log(` Total Tests:  ${totalTests}`);
console.log(` Passed:       ${COLORS.green}${passedTests}${COLORS.reset}`);
console.log(` Failed:       ${failedTests > 0 ? COLORS.red : COLORS.green}${failedTests}${COLORS.reset}`);
console.log(` Health Score: ${failedTests === 0 ? COLORS.green + '100% HEALTHY' : COLORS.red + 'ISSUES DETECTED'}${COLORS.reset}`);
console.log(`=====================================================${COLORS.reset}\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
