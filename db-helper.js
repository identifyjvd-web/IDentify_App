// --- IndexedDB Wrapper & Offline Queue ---
const SchoolLocalDB = {
    dbName: 'SchoolSystemDB',
    version: 1,
    init: function() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onupgradeneeded = (e) => {
                const idb = e.target.result;
                if (!idb.objectStoreNames.contains('store')) {
                    idb.createObjectStore('store');
                }
                if (!idb.objectStoreNames.contains('syncQueue')) {
                    idb.createObjectStore('syncQueue', { keyPath: 'id' });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },
    get: async function(key) {
        try {
            const idb = await this.init();
            return await new Promise((resolve, reject) => {
                const tx = idb.transaction('store', 'readonly');
                const store = tx.objectStore('store');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch(e) { return null; }
    },
    set: async function(key, val) {
        try {
            const idb = await this.init();
            return await new Promise((resolve, reject) => {
                const tx = idb.transaction('store', 'readwrite');
                const store = tx.objectStore('store');
                const req = store.put(val, key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch(e) { console.warn(e); }
    },
    enqueueSync: async function(record) {
        try {
            const idb = await this.init();
            return await new Promise((resolve, reject) => {
                const tx = idb.transaction('syncQueue', 'readwrite');
                const store = tx.objectStore('syncQueue');
                const req = store.put(record);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch(e) { console.warn(e); }
    },
    dequeueSync: async function(id) {
        try {
            const idb = await this.init();
            return await new Promise((resolve, reject) => {
                const tx = idb.transaction('syncQueue', 'readwrite');
                const store = tx.objectStore('syncQueue');
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch(e) { console.warn(e); }
    },
    getAllSyncQueue: async function() {
        try {
            const idb = await this.init();
            return await new Promise((resolve, reject) => {
                const tx = idb.transaction('syncQueue', 'readonly');
                const store = tx.objectStore('syncQueue');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        } catch(e) { return []; }
    },
    clearQueue: async function() {
        try {
            const idb = await this.init();
            return await new Promise((resolve, reject) => {
                const tx = idb.transaction('syncQueue', 'readwrite');
                const store = tx.objectStore('syncQueue');
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        } catch(e) {}
    }
};

function isVerifiedRecordForSync(record) {
    if (!record || typeof record !== 'object') return false;
    if (record._serverSaved === true) return true;
    if (record.verified === true || record.verified === 'Completed') return true;
    return String(record.verified).toLowerCase() === 'true';
}

function getLocalRecordsArray() {
    if (typeof window !== 'undefined' && Array.isArray(window.studentRecordsDb)) {
        return window.studentRecordsDb;
    }
    if (typeof db !== 'undefined' && Array.isArray(db)) {
        return db;
    }
    return [];
}

function getRecordForSync(fn, args) {
    const firstArg = args && args[0];
    if (firstArg && typeof firstArg === 'object') return firstArg;
    if (typeof firstArg === 'string') {
        const localDb = getLocalRecordsArray();
        const localRecord = localDb.find(x => String(x.id) === String(firstArg));
        if (localRecord) return localRecord;
    }
    return firstArg || null;
}

function shouldSyncRecordToServer(fn, args) {
    const isSyncableFn = ['addRecord', 'submitStudentData', 'updateRecord', 'deleteRecord', 'restoreRecord', 'permanentDelete', 'permDelete'].includes(fn);
    if (!isSyncableFn) return false;

    if (fn === 'permanentDelete' || fn === 'permDelete') {
        const firstArg = args && args[0];
        return !!(firstArg && (typeof firstArg === 'string' || firstArg.id));
    }

    const firstArg = args && args[0];
    const recId = (firstArg && typeof firstArg === 'object') ? firstArg.id : firstArg;
    if (!recId) return false;

    // Never sync soft delete or restore if record does not exist or has no student details
    if (fn === 'deleteRecord' || fn === 'restoreRecord') {
        const localDb = getLocalRecordsArray();
        const existing = (firstArg && typeof firstArg === 'object') ? firstArg : (localDb.find(r => r && String(r.id) === String(recId)) || null);
        if (!existing || (!String(existing.studentName || '').trim() && !String(existing.fatherName || '').trim() && !String(existing.sclass || '').trim() && !existing.photoData && !existing.docUrl)) {
            return false;
        }
        return true;
    }

    const record = getRecordForSync(fn, args);
    // Never sync empty form drafts or ghost records with no student details
    if (record && typeof record === 'object') {
        const hasName = String(record.studentName || '').trim().length > 0;
        const hasFather = String(record.fatherName || '').trim().length > 0;
        const hasClass = String(record.sclass || '').trim().length > 0;
        const hasDoc = !!(record.photoData || record.docUrl || record.docFileId);
        if (!hasName && !hasFather && !hasClass && !hasDoc) {
            return false;
        }
    }

    // ALL saved records (with or without photo, pending or verified) should safely sync to cloud!
    return true;
}

async function syncOfflineQueueNow() {
    const queue = await SchoolLocalDB.getAllSyncQueue();
    // Sync all real saved records (Verified, Pending, Unverified, Deleted)
    const syncableQueue = queue.filter(item => item && item.data && (item.data.studentName || item.fn === 'deleteRecord' || item.fn === 'permanentDelete' || item.fn === 'permDelete' || item.fn === 'restoreRecord'));
    const droppedQueue = queue.filter(item => !syncableQueue.includes(item));

    // Remove non-syncable items from the offline queue silently
    for (const item of droppedQueue) {
        await SchoolLocalDB.dequeueSync(item.id);
    }

    if (syncableQueue.length > 0) {
        if (typeof showToast === 'function') {
            showToast('<span class="material-symbols-outlined mr-2">cloud_upload</span> Syncing ' + syncableQueue.length + ' offline records...');
        }
        let syncedCount = 0;
        for (const item of syncableQueue) {
            const localDb = getLocalRecordsArray();
            const latestRec = localDb.find(x => String(x.id) === String(item.id)) || null;
            // If record is already synced in memory with newer or verified state, just dequeue
            if (latestRec && latestRec._serverSaved && latestRec._syncStatus === 'synced' && (!item.timestamp || (latestRec.updatedAt && latestRec.updatedAt >= item.timestamp))) {
                await SchoolLocalDB.dequeueSync(item.id);
                continue;
            }
            const payloadToSync = (latestRec && item.fn !== 'deleteRecord' && item.fn !== 'permanentDelete' && item.fn !== 'permDelete')
                ? { ...item.data, ...latestRec }
                : item.data;
            await new Promise((resolve) => {
                serverCallSilent(item.fn, [payloadToSync], async () => {
                    await SchoolLocalDB.dequeueSync(item.id);
                    const currentDb = getLocalRecordsArray();
                    const idx = currentDb.findIndex(x => String(x.id) === String(item.id));
                    if (idx > -1) {
                        currentDb[idx]._syncStatus = 'synced';
                        currentDb[idx]._serverSaved = true;
                        currentDb[idx]._pending = false;
                        if (typeof persistLocalUnverified === 'function') persistLocalUnverified();
                        if (typeof renderCurrentRecordsPage === 'function') renderCurrentRecordsPage();
                    }
                    syncedCount++;
                    resolve();
                }, () => {
                    resolve();
                });
            });
        }
        if (syncedCount > 0 && typeof showToast === 'function') {
            showToast('Offline sync completed (' + syncedCount + ' records synced)!');
        }
    }
}

window.syncOfflineQueueNow = syncOfflineQueueNow;
window.addEventListener('online', syncOfflineQueueNow);
window.addEventListener('focus', () => {
    syncOfflineQueueNow();
    if (typeof loadAllData === 'function') loadAllData();
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        syncOfflineQueueNow();
        if (typeof loadAllData === 'function') loadAllData();
    }
});

// Real-time Cross-Tab Broadcast Channel (instant zero-delay sync between tabs on same browser)
const appSyncChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('identify_app_sync') : null;
if (appSyncChannel) {
    appSyncChannel.onmessage = (event) => {
        if (event && event.data && event.data.type === 'RECORD_SYNC_EVENT') {
            console.log('[BroadcastChannel] Instant sync event received:', event.data.action);
            if (typeof loadAllData === 'function') {
                loadAllData();
            }
        }
    };
}

function broadcastAppSync(action, payload) {
    if (appSyncChannel) {
        try {
            appSyncChannel.postMessage({
                type: 'RECORD_SYNC_EVENT',
                action: action,
                payload: (payload && payload.id) ? payload.id : payload,
                timestamp: Date.now()
            });
        } catch (e) {}
    }
}
window.broadcastAppSync = broadcastAppSync;

function serverCall(fn, args, onSuccess, onFailure) {
    if (['addRecord', 'submitStudentData', 'updateRecord', 'deleteRecord', 'restoreRecord', 'permanentDelete', 'permDelete'].includes(fn) && !shouldSyncRecordToServer(fn, args)) {
        if (onSuccess) onSuccess(args && args[0] ? args[0] : true);
        return;
    }

    if (fn === 'loginUser') {
        const credentials = args[0] || {};
        const userId = (credentials.userId || '').toLowerCase();
        if (userId.includes('teacher')) {
            setTimeout(() => onSuccess({ role: 'teacher', name: 'Teacher', userId: credentials.userId }), 500);
            return;
        } else if (userId.includes('admin')) {
            setTimeout(() => onFailure({ message: 'Admin login will be linked later.' }), 500);
            return;
        } else {
            setTimeout(() => onSuccess({ role: 'teacher', name: credentials.userId, userId: credentials.userId }), 500);
            return;
        }
    }

    function tryHandleFirebase() {
        if (window.db && window.firebaseAPI) {
            // If on a private panel (not public registration form), ensure Firebase Auth has restored the user session
            if (!window.isPublicFormMode && window.auth && !window.auth.currentUser) {
                try {
                    const saved = localStorage.getItem('student_auth_v1');
                    if (saved) {
                        return false; // Wait for Firebase Auth session to finish restoring!
                    }
                } catch(e) {}
            }
            handleFirebaseCall(fn, args, (res) => {
                if (['addRecord', 'submitStudentData', 'addManyRecords', 'updateRecord', 'updateStudentData', 'deleteRecord', 'restoreRecord', 'permanentDelete', 'permDelete', 'saveFormFields'].includes(fn)) {
                    broadcastAppSync(fn, args && args[0]);
                }
                if (onSuccess) onSuccess(res);
            }, onFailure);
            return true;
        }
        return false;
    }

    if (!tryHandleFirebase()) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (tryHandleFirebase()) {
                clearInterval(interval);
            } else if (attempts >= 60) { // 6 seconds timeout
                clearInterval(interval);
                if (fn === 'getRecords') {
                    if (onSuccess) onSuccess(typeof mockRecords !== 'undefined' ? mockRecords : []);
                } else {
                    if (onFailure) onFailure(new Error("Firebase is not initialized or offline"));
                }
            }
        }, 100);
    }
}

function serverCallSilent(fn, args, onSuccess, onFailure) {
    const isOffline = !navigator.onLine;
    const isSyncableFn = ['addRecord', 'submitStudentData', 'updateRecord', 'deleteRecord', 'restoreRecord', 'permanentDelete', 'permDelete'].includes(fn);

    const safeOnSuccess = onSuccess || (() => {});
    const safeOnFailure = onFailure || ((err) => {
        console.warn(`[serverCallSilent] ${fn} completed with notice:`, err);
        if (onSuccess) onSuccess();
    });

    if (isSyncableFn && !shouldSyncRecordToServer(fn, args)) {
        safeOnSuccess(args && args[0] ? args[0] : true);
        return;
    }

    if (isSyncableFn) {
        let recId = null;
        let recData = null;
        let status = 'Draft';

        if (fn === 'deleteRecord' || fn === 'permanentDelete' || fn === 'permDelete') {
            recId = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].id ? args[0].id : null);
            recData = args[0]; // Can be ID or object, backend handles both
            status = 'Deleted';
        } else if (fn === 'restoreRecord') {
            recId = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].id ? args[0].id : null);
            recData = args[0];
            status = 'Restored';
        } else {
            recData = args[0];
            if (recData && recData.id) {
                recId = recData.id;
                if (recData.verified === true || String(recData.verified).toLowerCase() === 'true' || recData.verified === 'Completed' || recData._serverSaved) {
                    status = 'Verified';
                } else if (String(recId).startsWith('draft_')) {
                    status = 'Draft';
                } else if (String(recId).startsWith('TEMP_')) {
                    status = 'Imported';
                } else {
                    status = 'Imported'; // Fallback for unverified non-draft
                }
            }
        }

        const handleOfflineEnqueue = () => {
            if (recId) {
                SchoolLocalDB.enqueueSync({ id: recId, fn: fn, data: recData, timestamp: Date.now(), status: status });
            }
        };

        if (isOffline) {
            handleOfflineEnqueue();
            if (onFailure) onFailure(new Error("Offline: queued for sync"));
            else if (onSuccess) onSuccess(recData);
            return;
        }

        serverCall(fn, args, (res) => {
            if (recId) {
                SchoolLocalDB.dequeueSync(recId).catch(() => {});
            }
            if (onSuccess) onSuccess(res);
        }, (err) => {
            handleOfflineEnqueue(); // Re-enqueue on failure
            if (onFailure) onFailure(err || new Error("Sync failed: queued for retry"));
            else if (onSuccess) onSuccess(recData); // Fail gracefully when caller has no failure path
        });
    } else {
        serverCall(fn, args, onSuccess, onFailure);
    }
}


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
window.extractSnNumber = extractSnNumber;

function formatRecordSn(rec) {
    if (!rec) return '';
    if (typeof rec === 'string' || typeof rec === 'number') {
        rec = { sn: rec };
    }
    const rawSn = String(rec.sn || rec.draftSn || '').trim();
    if (/^[A-Za-z]+\d{2}\d{4,}$/.test(rawSn)) {
        return rawSn.toUpperCase();
    }
    const cfg = (typeof window !== 'undefined' && window.schoolConfig) ? window.schoolConfig : ((typeof schoolConfig !== 'undefined' && schoolConfig) ? schoolConfig : {});
    const si = (rec.schoolCode || cfg.code || (cfg.name || "DPS").trim().split(/\s+/).map(w=>w[0]).join('')).toUpperCase() || "DPS";
    const year = new Date(rec.createdAt || Date.now()).getFullYear().toString().slice(-2);
    let num = 1;
    if (rawSn) {
        num = extractSnNumber(rawSn) || 1;
    }
    return `${si}${year}${String(num).padStart(4, '0')}`;
}
window.formatRecordSn = formatRecordSn;

function resolveRecordSchoolInfo(rec) {
    let targetId = '';
    let targetCode = '';

    // 1. Current active school configuration takes highest precedence
    const cfg = (typeof window !== 'undefined' && window.schoolConfig) 
        ? window.schoolConfig 
        : (typeof schoolConfig !== 'undefined' ? schoolConfig : null);
    if (cfg) {
        if (!targetId && cfg.id) targetId = String(cfg.id);
        if (!targetCode && cfg.code) targetCode = String(cfg.code || '').trim().toUpperCase();
    }

    if (!targetId || !targetCode) {
        try {
            const raw = localStorage.getItem('school_config_v1');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed) {
                    if (!targetId && parsed.id) targetId = String(parsed.id);
                    if (!targetCode && parsed.code) targetCode = String(parsed.code).trim().toUpperCase();
                }
            }
        } catch(e){}
    }

    if (!targetId) {
        try {
            const activeId = localStorage.getItem('identify_active_school_id');
            if (activeId) targetId = activeId;
        } catch(e){}
    }

    // 2. Fallback to record's own schoolId / schoolCode if present
    if (!targetId && rec && rec.schoolId) {
        targetId = String(rec.schoolId).trim();
    }
    if (!targetCode && rec && rec.schoolCode) {
        targetCode = String(rec.schoolCode).trim().toUpperCase();
    }

    // 3. Fallback: Parse schoolCode from rec.sn (e.g. AS260001 -> AS)
    if (!targetCode && rec && rec.sn) {
        const m = String(rec.sn).trim().match(/^([A-Za-z]+)\d{2}\d+$/);
        if (m && m[1]) {
            targetCode = m[1].toUpperCase();
        }
    }

    // 4. Fallback: Parse schoolCode from rec.id only if parts[1] is NOT numeric
    if (!targetCode && rec && rec.id && String(rec.id).startsWith('rec_')) {
        const parts = String(rec.id).split('_');
        if (parts.length >= 3 && parts[1] && !/^\d+$/.test(parts[1])) {
            targetCode = parts[1].toUpperCase();
        }
    }

    if (!targetId && targetCode) {
        targetId = 'school_' + targetCode.toLowerCase();
    }
    if (!targetId) targetId = 'school_dps';
    if (!targetCode) targetCode = 'DPS';

    return { schoolId: targetId, schoolCode: targetCode };
}
window.resolveRecordSchoolInfo = resolveRecordSchoolInfo;

function prepareRecordForFirestore(data) {
    const cleanData = JSON.parse(JSON.stringify(data));
    const schoolInfo = resolveRecordSchoolInfo(cleanData);
    const targetCode = String(schoolInfo.schoolCode || 'DPS').toUpperCase();

    // Guard against race conditions: if local db already marked this record verified or uploaded a photo, never overwrite with stale state
    const localDb = getLocalRecordsArray();
    if (cleanData && cleanData.id && localDb.length > 0) {
        const latestLocal = localDb.find(r => r && String(r.id) === String(cleanData.id));
        if (latestLocal) {
            const isLocalVerified = latestLocal.verified === true || String(latestLocal.verified).toLowerCase() === 'true' || latestLocal.verified === 'Completed';
            const isLocalReturned = String(latestLocal.verified).toLowerCase() === 'returned' || String(latestLocal.status).toLowerCase() === 'returned' || latestLocal.returned === true;
            if (isLocalVerified && !isLocalReturned) {
                cleanData.verified = true;
                cleanData.status = 'verified';
                cleanData.isRestored = false;
                cleanData.draftStatus = '';
                if (latestLocal.sn && !cleanData.sn) cleanData.sn = latestLocal.sn;
                if (latestLocal.verifiedBy && !cleanData.verifiedBy) cleanData.verifiedBy = latestLocal.verifiedBy;
                if (latestLocal.verifiedAt && !cleanData.verifiedAt) cleanData.verifiedAt = latestLocal.verifiedAt;
            }
            // If photo was added locally right after initial save, don't let an older no-photo payload wipe it out
            const localHasPhoto = !!(latestLocal.photoData || latestLocal.docUrl);
            const cleanHasPhoto = !!(cleanData.photoData || cleanData.docUrl || cleanData.photo);
            if (localHasPhoto && !cleanHasPhoto && (!cleanData.updatedAt || !latestLocal.updatedAt || latestLocal.updatedAt >= cleanData.updatedAt)) {
                if (latestLocal.photoData) cleanData.photoData = latestLocal.photoData;
                if (latestLocal.docUrl) cleanData.docUrl = latestLocal.docUrl;
                if (latestLocal.fileName) cleanData.fileName = latestLocal.fileName;
                if (cleanData.status === 'pending' && latestLocal.status) cleanData.status = latestLocal.status;
            }
        }
    }
    cleanData.createdAt = cleanData.createdAt || Date.now();

    // Format sn as {SchoolCode}{Year2Digits}{4-digit-serial} e.g. DPS260001, AS260001
    const rawSn = String(cleanData.sn || '').trim();
    if (!/^[A-Za-z]+\d{2}\d{4,}$/.test(rawSn)) {
        const num = extractSnNumber(rawSn) || 1;
        const year = new Date(cleanData.createdAt || Date.now()).getFullYear().toString().slice(-2);
        cleanData.sn = `${targetCode}${year}${String(num).padStart(4, '0')}`;
    } else {
        cleanData.sn = rawSn.toUpperCase();
    }

    // Strip removed fields and background metadata per user requirement
    delete cleanData.schoolId;
    delete cleanData.schoolCode;
    delete cleanData.returned;
    delete cleanData._serverSaved;
    delete cleanData._syncStatus;
    delete cleanData._pending;
    delete cleanData._verifying;
    delete cleanData._displayPhotoSrc;
    delete cleanData._eid;
    delete cleanData.draftSn;
    delete cleanData.draftStatus;
    delete cleanData.updatedAt;
    delete cleanData.deviceInfo;
    delete cleanData.location;
    delete cleanData.timestamp;
    delete cleanData.oldId;
    delete cleanData.isRestored;
    if (cleanData.photo && String(cleanData.photo).startsWith('data:image')) {
        if (!cleanData.photoData) cleanData.photoData = cleanData.photo;
        delete cleanData.photo;
    }
    if (cleanData.docUrl && String(cleanData.docUrl).startsWith('data:image') && cleanData.photoData && String(cleanData.photoData).startsWith('data:image')) {
        cleanData.docUrl = '';
    }
    return cleanData;
}

async function handleFirebaseCall(fn, args, onSuccess, onFailure) {
    const { collection, addDoc, getDocs, updateDoc, setDoc, deleteDoc, doc, query, orderBy, onSnapshot, getDoc } = window.firebaseAPI;
    try {
        if (fn === 'getRecords') {
            if (window._recordsUnsubscribe) {
                try { window._recordsUnsubscribe(); } catch (e) {}
            }
            const activeSchoolInfo = resolveRecordSchoolInfo(null);
            const schoolId = String(activeSchoolInfo.schoolId || 'school_dps');
            const targetCode = String(activeSchoolInfo.schoolCode || 'DPS').toUpperCase();

            // Isolated school collection path: schools/{schoolId}/records
            const schoolColRef = collection(window.db, "schools", schoolId, "records");
            
            window._recordsUnsubscribe = onSnapshot(schoolColRef, async (querySnapshot) => {
                const records = [];
                querySnapshot.forEach((d) => {
                    const r = { id: d.id, ...d.data() };
                    // Auto-purge/ignore ghost records: empty records with isDeleted: true and no student details
                    const hasName = String(r.studentName || '').trim().length > 0;
                    const hasFather = String(r.fatherName || '').trim().length > 0;
                    const hasClass = String(r.sclass || '').trim().length > 0;
                    const hasDoc = !!(r.photoData || r.docUrl || r.docFileId);
                    if (r.isDeleted && !hasName && !hasFather && !hasClass && !hasDoc) {
                        try {
                            deleteDoc(d.ref).catch(()=>{});
                            deleteDoc(doc(window.db, "records", String(d.id))).catch(()=>{});
                        } catch(e) {}
                        return; // Drop ghost record from state
                    }
                    records.push(r);
                });

                // Always check root collection and merge any missing records or photoData for this school
                try {
                    const rootSnap = await getDocs(collection(window.db, "records"));
                    const subMap = new Map();
                    records.forEach(r => subMap.set(String(r.id), r));

                    rootSnap.forEach(d => {
                        const r = { id: d.id, ...d.data() };
                        const matchesId = r.schoolId && String(r.schoolId) === schoolId;
                        const matchesCode = r.schoolCode && String(r.schoolCode).toUpperCase() === targetCode;
                        const matchesPrefix = targetCode && (String(r.id || '').startsWith('rec_' + targetCode + '_') || String(r.id || '').startsWith('draft_' + targetCode + '-'));
                        const matchesSn = targetCode && r.sn && String(r.sn).toUpperCase().startsWith(targetCode);
                        if (matchesId || (targetCode && (matchesCode || matchesPrefix || matchesSn))) {
                            if (!subMap.has(String(r.id))) {
                                records.push(r);
                                subMap.set(String(r.id), r);
                                setDoc(doc(window.db, "schools", schoolId, "records", String(r.id)), r, { merge: true }).catch(()=>{});
                            } else {
                                const existing = subMap.get(String(r.id));
                                if (r.photoData && !existing.photoData) {
                                    existing.photoData = r.photoData;
                                    setDoc(doc(window.db, "schools", schoolId, "records", String(r.id)), { photoData: r.photoData }, { merge: true }).catch(()=>{});
                                }
                            }
                        }
                    });
                } catch(e) {}

                if (onSuccess) onSuccess(records);
            }, (error) => {
                console.error("Firebase School Records Snapshot Error:", error);
                // If permission-denied occurred because auth state was still restoring, auto-retry when auth resolves
                if (error && (error.code === 'permission-denied' || String(error.message).toLowerCase().includes('permission'))) {
                    if (window.auth && window.firebaseAPI && window.firebaseAPI.onAuthStateChanged) {
                        const unsub = window.firebaseAPI.onAuthStateChanged(window.auth, (u) => {
                            if (u) {
                                unsub();
                                handleFirebaseCall('getRecords', args, onSuccess, onFailure);
                            }
                        });
                        return;
                    }
                }
                getDocs(schoolColRef).then((snapshot) => {
                    const fallbackRecords = [];
                    snapshot.forEach((d) => { fallbackRecords.push({ id: d.id, ...d.data() }); });
                    if (onSuccess) onSuccess(fallbackRecords);
                }).catch((e) => {
                    if (onFailure) onFailure(e);
                });
            });
        } else if (fn === 'submitStudentData' || fn === 'addRecord') {
            const data = args[0];
            const schoolInfo = resolveRecordSchoolInfo(data);
            const schoolId = String(schoolInfo.schoolId || 'school_dps');
            const cleanData = prepareRecordForFirestore(data);
            
            // 1. Save in dedicated school subcollection: schools/{schoolId}/records/{id}
            const schoolDocRef = doc(window.db, "schools", schoolId, "records", String(cleanData.id));
            // 2. Also keep root records in sync for compatibility
            const rootDocRef = doc(window.db, "records", String(cleanData.id));
            await Promise.all([
                setDoc(schoolDocRef, cleanData),
                setDoc(rootDocRef, cleanData)
            ]);
            if (onSuccess) onSuccess(data);
        } else if (fn === 'addManyRecords') {
            const records = args[0] || [];
            let addedCount = 0;
            const chunkSize = 25;
            for (let i = 0; i < records.length; i += chunkSize) {
                const chunk = records.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (rec) => {
                    const schoolInfo = resolveRecordSchoolInfo(rec);
                    const schoolId = String(schoolInfo.schoolId || 'school_dps');
                    const cleanData = prepareRecordForFirestore(rec);
                    const schoolDocRef = doc(window.db, "schools", schoolId, "records", String(cleanData.id));
                    const rootDocRef = doc(window.db, "records", String(cleanData.id));
                    await Promise.all([
                        setDoc(schoolDocRef, cleanData),
                        setDoc(rootDocRef, cleanData)
                    ]);
                    addedCount++;
                }));
            }
            if (onSuccess) onSuccess(addedCount);
        } else if (fn === 'updateStudentData' || fn === 'updateRecord') {
            const data = args[0];
            const schoolInfo = resolveRecordSchoolInfo(data);
            const schoolId = String(schoolInfo.schoolId || 'school_dps');
            const cleanData = prepareRecordForFirestore(data);
            const schoolDocRef = doc(window.db, "schools", schoolId, "records", String(cleanData.id));
            const rootDocRef = doc(window.db, "records", String(cleanData.id));
            await Promise.all([
                setDoc(schoolDocRef, cleanData),
                setDoc(rootDocRef, cleanData)
            ]);
            
            if (onSuccess) onSuccess(data);
        } else if (fn === 'restoreRecord') {
            const arg = args[0];
            const id = typeof arg === 'object' && arg ? arg.id : arg;
            const localDb = getLocalRecordsArray();
            let recObj = (typeof arg === 'object' && arg)
                ? arg
                : (localDb.find(r => r && String(r.id) === String(id)) || null);
            if (!recObj && id) {
                const rootDocRef = doc(window.db, "records", String(id));
                const docSnap = await getDoc(rootDocRef);
                if (docSnap.exists()) {
                    recObj = { id: docSnap.id, ...docSnap.data() };
                }
            }
            if (recObj && recObj.id) {
                const schoolInfo = resolveRecordSchoolInfo(recObj);
                const schoolId = String(schoolInfo.schoolId || 'school_dps');
                const cleanData = prepareRecordForFirestore({ ...recObj, isDeleted: false, isRestored: true, deletedAt: null });
                const schoolDocRef = doc(window.db, "schools", schoolId, "records", String(cleanData.id));
                const rootDocRef = doc(window.db, "records", String(cleanData.id));
                await Promise.all([
                    setDoc(schoolDocRef, cleanData),
                    setDoc(rootDocRef, cleanData)
                ]);
            }
            if (onSuccess) onSuccess(true);
        } else if (fn === 'deleteRecord') {
            // SOFT DELETE: Update Firestore document with isDeleted: true so it appears in Recycle Bin
            const arg = args[0];
            const id = typeof arg === 'object' && arg ? arg.id : arg;
            if (id && !String(id).startsWith('TEMP_')) {
                const localDb = getLocalRecordsArray();
                const recObj = (typeof arg === 'object' && arg) ? arg : (localDb.find(r => r && String(r.id) === String(id)) || null);
                // Guard: Never create or soft-delete a ghost record in Firestore if it has no data
                if (!recObj || (!String(recObj.studentName || '').trim() && !String(recObj.fatherName || '').trim() && !String(recObj.sclass || '').trim() && !recObj.photoData && !recObj.docUrl)) {
                    if (onSuccess) onSuccess(true);
                    return;
                }
                const schoolInfo = resolveRecordSchoolInfo(recObj);
                const schoolId = String(schoolInfo.schoolId || (schoolInfo.schoolCode ? 'school_' + schoolInfo.schoolCode.toLowerCase() : 'school_dps'));

                const softDeleteData = {
                    isDeleted: true,
                    deletedAt: Date.now(),
                    updatedAt: Date.now()
                };

                const updatePromises = [
                    setDoc(doc(window.db, "schools", schoolId, "records", String(id)), softDeleteData, { merge: true }),
                    setDoc(doc(window.db, "records", String(id)), softDeleteData, { merge: true })
                ];
                if (schoolInfo.schoolCode && ('school_' + String(schoolInfo.schoolCode).toLowerCase()) !== schoolId) {
                    updatePromises.push(setDoc(doc(window.db, "schools", "school_" + String(schoolInfo.schoolCode).toLowerCase(), "records", String(id)), softDeleteData, { merge: true }).catch(()=>{}));
                }
                await Promise.all(updatePromises);
            }
            if (onSuccess) onSuccess(true);
        } else if (fn === 'restoreRecord') {
            // RESTORE: Update Firestore document with isDeleted: false
            const arg = args[0];
            const id = typeof arg === 'object' && arg ? arg.id : arg;
            if (id && !String(id).startsWith('TEMP_')) {
                const localDb = getLocalRecordsArray();
                const recObj = (typeof arg === 'object' && arg) ? arg : (localDb.find(r => r && String(r.id) === String(id)) || {});
                const schoolInfo = resolveRecordSchoolInfo(recObj);
                const schoolId = String(schoolInfo.schoolId || (schoolInfo.schoolCode ? 'school_' + schoolInfo.schoolCode.toLowerCase() : 'school_dps'));

                const restoreData = {
                    isDeleted: false,
                    isRestored: true,
                    updatedAt: Date.now()
                };

                const updatePromises = [
                    setDoc(doc(window.db, "schools", schoolId, "records", String(id)), restoreData, { merge: true }),
                    setDoc(doc(window.db, "records", String(id)), restoreData, { merge: true })
                ];
                if (schoolInfo.schoolCode && ('school_' + String(schoolInfo.schoolCode).toLowerCase()) !== schoolId) {
                    updatePromises.push(setDoc(doc(window.db, "schools", "school_" + String(schoolInfo.schoolCode).toLowerCase(), "records", String(id)), restoreData, { merge: true }).catch(()=>{}));
                }
                await Promise.all(updatePromises);
            }
            if (onSuccess) onSuccess(true);
        } else if (fn === 'permanentDelete' || fn === 'permDelete') {
            // HARD DELETE: Actually delete the document from Firestore and Storage
            const arg = args[0];
            const id = typeof arg === 'object' && arg ? arg.id : arg;
            if (id && !String(id).startsWith('TEMP_')) {
                const localDb = getLocalRecordsArray();
                const recObj = (typeof arg === 'object' && arg) ? arg : (localDb.find(r => r && String(r.id) === String(id)) || {});
                const schoolInfo = resolveRecordSchoolInfo(recObj);
                const schoolId = String(schoolInfo.schoolId || (schoolInfo.schoolCode ? 'school_' + schoolInfo.schoolCode.toLowerCase() : 'school_dps'));

                const delPromises = [];
                delPromises.push(deleteDoc(doc(window.db, "schools", schoolId, "records", String(id))).catch(()=>{}));
                delPromises.push(deleteDoc(doc(window.db, "records", String(id))).catch(()=>{}));
                if (schoolInfo.schoolCode) {
                    delPromises.push(deleteDoc(doc(window.db, "schools", "school_" + String(schoolInfo.schoolCode).toLowerCase(), "records", String(id))).catch(()=>{}));
                }
                if (typeof schoolConfig !== 'undefined' && schoolConfig && schoolConfig.id && String(schoolConfig.id) !== schoolId) {
                    delPromises.push(deleteDoc(doc(window.db, "schools", String(schoolConfig.id), "records", String(id))).catch(()=>{}));
                }
                const sList = (typeof loadSchoolsList === 'function' ? loadSchoolsList() : (Array.isArray(window.schoolsList) ? window.schoolsList : []));
                sList.forEach(s => {
                    if (s && s.id && String(s.id) !== schoolId) {
                        delPromises.push(deleteDoc(doc(window.db, "schools", String(s.id), "records", String(id))).catch(()=>{}));
                    }
                    if (s && s.code) {
                        delPromises.push(deleteDoc(doc(window.db, "schools", "school_" + String(s.code).toLowerCase(), "records", String(id))).catch(()=>{}));
                    }
                });
                if (window.auth && window.auth.currentUser && window.auth.currentUser.uid) {
                    delPromises.push(deleteDoc(doc(window.db, "schools", window.auth.currentUser.uid, "records", String(id))).catch(()=>{}));
                }
                const docFileId = recObj.docFileId || (recObj.docUrl && recObj.docUrl.includes('documents%2F') ? decodeURIComponent(recObj.docUrl.split('documents%2F')[1].split('?')[0]) : null);
                if (docFileId && window.storage && window.firebaseAPI && window.firebaseAPI.deleteObject) {
                    try {
                        const { ref, deleteObject } = window.firebaseAPI;
                        delPromises.push(deleteObject(ref(window.storage, `documents/${docFileId}`)).catch(()=>{}));
                    } catch(e){}
                }
                await Promise.all(delPromises);
            }
            if (onSuccess) onSuccess(true);
        } else if (fn === 'getRecordById') {
            const id = args[0];
            const activeSchoolInfo = resolveRecordSchoolInfo(null);
            const schoolId = String(activeSchoolInfo.schoolId || 'school_dps');
            const schoolDocRef = doc(window.db, "schools", schoolId, "records", String(id));
            let docSnap = await getDoc(schoolDocRef);
            if (!docSnap.exists()) {
                const rootDocRef = doc(window.db, "records", String(id));
                docSnap = await getDoc(rootDocRef);
            }
            if (docSnap.exists()) {
                if (onSuccess) onSuccess({ id: docSnap.id, ...docSnap.data() });
            } else {
                if (onSuccess) onSuccess(null);
            }
        } else if (fn === 'deleteDriveFile') {
            const fileId = args[0];
            if (window.storage && fileId && window.firebaseAPI && window.firebaseAPI.deleteObject) {
                try {
                    const { ref, deleteObject } = window.firebaseAPI;
                    const storageRef = ref(window.storage, `documents/${fileId}`);
                    await deleteObject(storageRef);
                } catch (e) {
                    console.warn("deleteDriveFile warning:", e);
                }
            }
            if (onSuccess) onSuccess(true);
        } else if (fn === 'updateUserCredentials') {
            const payload = args[0] || {};
            try {
                const authUser = window.auth && window.auth.currentUser;
                if (authUser && payload.nextPassword && window.firebaseAPI && window.firebaseAPI.updatePassword) {
                    await window.firebaseAPI.updatePassword(authUser, payload.nextPassword);
                }
            } catch (e) {
                console.warn("updatePassword warning:", e);
            }
            const localUser = (typeof loadAuthUser === 'function') ? loadAuthUser() : null;
            const updatedUser = localUser ? { ...localUser } : { userId: payload.nextUserId || 'admin', role: 'teacher' };
            if (payload.nextUserId) updatedUser.userId = payload.nextUserId;
            if (onSuccess) onSuccess(updatedUser);
        } else if (fn === 'deleteSchoolRecords' || fn === 'deleteAllRecords') {
            const activeSchoolInfo = resolveRecordSchoolInfo(args && args[0] ? args[0] : null);
            const schoolId = String(activeSchoolInfo.schoolId || 'school_dps');
            const targetCode = String(activeSchoolInfo.schoolCode || '').toUpperCase();
            
            const promises = [];
            try {
                // Delete only records of THIS school from dedicated subcollection
                const schoolRecsCol = collection(window.db, "schools", schoolId, "records");
                const snap = await getDocs(schoolRecsCol);
                snap.forEach((d) => {
                    const rData = d.data() || {};
                    if (rData.docFileId && window.storage && window.firebaseAPI && window.firebaseAPI.deleteObject) {
                        try {
                            const { ref, deleteObject } = window.firebaseAPI;
                            promises.push(deleteObject(ref(window.storage, `documents/${rData.docFileId}`)).catch(()=>{}));
                        } catch(e){}
                    }
                    promises.push(deleteDoc(doc(window.db, "schools", schoolId, "records", d.id)).catch(()=>{}));
                });
            } catch(e){}

            try {
                // Also delete from root records only those belonging to THIS school
                const rootSnap = await getDocs(collection(window.db, "records"));
                rootSnap.forEach((d) => {
                    const rData = d.data() || {};
                    const matchesId = rData.schoolId && String(rData.schoolId) === schoolId;
                    const matchesCode = targetCode && rData.schoolCode && String(rData.schoolCode).toUpperCase() === targetCode;
                    const matchesPrefix = targetCode && (String(d.id).startsWith('rec_' + targetCode + '_') || String(d.id).startsWith('draft_' + targetCode + '-'));
                    const matchesSn = targetCode && rData.sn && String(rData.sn).toUpperCase().startsWith(targetCode);
                    if (matchesId || matchesCode || matchesPrefix || matchesSn) {
                        if (rData.docFileId && window.storage && window.firebaseAPI && window.firebaseAPI.deleteObject) {
                            try {
                                const { ref, deleteObject } = window.firebaseAPI;
                                promises.push(deleteObject(ref(window.storage, `documents/${rData.docFileId}`)).catch(()=>{}));
                            } catch(e){}
                        }
                        promises.push(deleteDoc(doc(window.db, "records", d.id)).catch(()=>{}));
                    }
                });
            } catch(e){}

            // Reset school's snCounter in Firebase
            try {
                const counterRef = doc(window.db, "schools", schoolId, "config", "snCounter");
                promises.push(setDoc(counterRef, { value: 0 }, { merge: true }).catch(()=>{}));
            } catch(e){}

            // Also clean alias subcollection if present
            if (activeSchoolInfo.schoolCode) {
                try {
                    const codeCol = collection(window.db, "schools", "school_" + String(activeSchoolInfo.schoolCode).toLowerCase(), "records");
                    const cSnap = await getDocs(codeCol);
                    cSnap.forEach((d) => {
                        promises.push(deleteDoc(d.ref).catch(()=>{}));
                    });
                } catch(e){}
            }

            try {
                await Promise.race([
                    Promise.all(promises),
                    new Promise(r => setTimeout(r, 4000))
                ]);
            } catch(e){}

            if (onSuccess) onSuccess(true);
        } else if (fn === 'saveFormFields') {
            const data = args[0];
            const docRef = doc(window.db, "system", "formBuilderConfig");
            await setDoc(docRef, { ...data, updatedAt: Date.now() }, { merge: true });

            try {
                const activeSchoolInfo = resolveRecordSchoolInfo(null);
                const schoolId = activeSchoolInfo && activeSchoolInfo.schoolId;
                if (schoolId) {
                    const sDocRef = doc(window.db, "schools", String(schoolId));
                    await setDoc(sDocRef, { formBuilderConfig: data, updatedAt: Date.now() }, { merge: true });
                }
            } catch(e) {}

            if (onSuccess) onSuccess();
        } else if (fn === 'getFormFields') {
            try {
                const activeSchoolInfo = resolveRecordSchoolInfo(null);
                const schoolId = activeSchoolInfo && activeSchoolInfo.schoolId;
                if (schoolId) {
                    const sDocRef = doc(window.db, "schools", String(schoolId));
                    const sSnap = await getDoc(sDocRef);
                    if (sSnap.exists() && sSnap.data().formBuilderConfig) {
                        if (onSuccess) onSuccess(sSnap.data().formBuilderConfig);
                        return;
                    }
                }
                const docRef = doc(window.db, "system", "formBuilderConfig");
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    if (onSuccess) onSuccess(docSnap.data());
                } else {
                    if (onSuccess) onSuccess(null);
                }
            } catch(e) {
                if (onFailure) onFailure(e);
            }
        } else if (fn === 'generateId') {
            const { runTransaction } = window.firebaseAPI;
            if (!runTransaction) throw new Error("runTransaction missing");
            const localMaxSn = Number(args[0]) || 0;
            const activeSchoolInfo = resolveRecordSchoolInfo(args && args[1] ? args[1] : null);
            const schoolId = String(activeSchoolInfo.schoolId || (activeSchoolInfo.schoolCode ? 'school_' + activeSchoolInfo.schoolCode.toLowerCase() : 'school_dps'));

            // Counter scoped per school (never shared across all schools!)
            const counterRef = doc(window.db, "schools", schoolId, "config", "snCounter");
            try {
                const newSn = await runTransaction(window.db, async (transaction) => {
                    const sfDoc = await transaction.get(counterRef);
                    let currentSn = 0;
                    if (sfDoc.exists()) {
                        currentSn = Number(sfDoc.data().value) || 0;
                        if (currentSn > 1000000000) currentSn = 0;
                    }
                    // If localMaxSn is 0 (e.g. all records of this school were deleted), reset counter to 0!
                    if (localMaxSn === 0) {
                        currentSn = 0;
                    }
                    const nextSn = Math.max(currentSn, localMaxSn) + 1;
                    transaction.set(counterRef, { value: nextSn }, { merge: true });
                    return nextSn;
                });
                if (onSuccess) onSuccess(newSn);
            } catch (e) {
                if (onFailure) onFailure(e);
            }
        } else if (fn === 'uploadRecordDocument') {
            const { ref, uploadString, getDownloadURL } = window.firebaseAPI;
            if (!window.storage) throw new Error("Firebase Storage is not initialized.");
            const payload = args[0];
            const storageRef = ref(window.storage, `documents/${payload.fileName}`);
            await uploadString(storageRef, payload.base64Data, 'base64', {
                contentType: payload.mimeType
            });
            const downloadURL = await getDownloadURL(storageRef);
            if (onSuccess) {
                onSuccess({
                    fileId: payload.fileName,
                    url: downloadURL,
                    previewUrl: downloadURL,
                    mimeType: payload.mimeType,
                    size: 0
                });
            }
        } else {
            if (onSuccess) onSuccess(true);
        }
    } catch (error) {
        console.error("Firebase Error:", error);
        if (onFailure) onFailure(error);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isVerifiedRecordForSync,
        getRecordForSync,
        shouldSyncRecordToServer
    };
}
