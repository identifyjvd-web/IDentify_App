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

function getRecordForSync(fn, args) {
    const firstArg = args && args[0];
    if (firstArg && typeof firstArg === 'object') return firstArg;
    if (typeof firstArg === 'string') {
        const localRecord = (typeof db !== 'undefined' && Array.isArray(db)) ? db.find(x => String(x.id) === String(firstArg)) : null;
        if (localRecord) return localRecord;
    }
    return firstArg || null;
}

function shouldSyncRecordToServer(fn, args) {
    const isSyncableFn = ['addRecord', 'submitStudentData', 'updateRecord', 'deleteRecord', 'restoreRecord', 'permanentDelete'].includes(fn);
    if (!isSyncableFn) return false;

    if (fn === 'permanentDelete') {
        const firstArg = args && args[0];
        return !!(firstArg && (typeof firstArg === 'string' || firstArg.id));
    }

    const record = getRecordForSync(fn, args);
    // Don't sync empty form drafts that have no studentName or class yet
    if (record && typeof record === 'object') {
        if (record.id && String(record.id).startsWith('draft_') && !record.studentName && !record.sclass) {
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
        for (const item of syncableQueue) {
            const latestRec = (typeof db !== 'undefined' && Array.isArray(db))
                ? db.find(x => String(x.id) === String(item.id))
                : null;
            // If record is already synced in memory with newer or verified state, just dequeue
            if (latestRec && latestRec._serverSaved && latestRec._syncStatus === 'synced' && (!item.timestamp || (latestRec.updatedAt && latestRec.updatedAt >= item.timestamp))) {
                await SchoolLocalDB.dequeueSync(item.id);
                continue;
            }
            const payloadToSync = (latestRec && item.fn !== 'deleteRecord' && item.fn !== 'permanentDelete' && item.fn !== 'permDelete')
                ? { ...item.data, ...latestRec }
                : item.data;
            serverCallSilent(item.fn, [payloadToSync], async () => {
                await SchoolLocalDB.dequeueSync(item.id);
                if (typeof db !== 'undefined' && Array.isArray(db)) {
                    const idx = db.findIndex(x => String(x.id) === String(item.id));
                    if (idx > -1) {
                        db[idx]._syncStatus = 'synced';
                        db[idx]._serverSaved = true;
                        db[idx]._pending = false;
                        if (typeof persistLocalUnverified === 'function') persistLocalUnverified();
                        if (typeof renderCurrentRecordsPage === 'function') renderCurrentRecordsPage();
                    }
                }
            }, () => {});
        }
        if (typeof showToast === 'function') {
            setTimeout(() => showToast('Offline sync completed!'), 2000);
        }
    }
}

window.syncOfflineQueueNow = syncOfflineQueueNow;
window.addEventListener('online', syncOfflineQueueNow);
window.addEventListener('focus', syncOfflineQueueNow);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncOfflineQueueNow();
});

function serverCall(fn, args, onSuccess, onFailure) {
    if (['addRecord', 'submitStudentData', 'updateRecord', 'deleteRecord', 'restoreRecord', 'permanentDelete', 'permDelete'].includes(fn) && !shouldSyncRecordToServer(fn, args)) {
        if (onSuccess) onSuccess(args && args[0] ? args[0] : true);
        return;
    }

    if (fn === 'loginUser') {
        const credentials = args[0] || {};
        const userId = (credentials.userId || '').toLowerCase();
        if (userId.includes('admin') && (credentials.password || '').trim() === '') {
            setTimeout(() => onSuccess({ role: 'teacher', name: 'Admin', userId: 'admin', viewMode: 'all' }), 500);
            return;
        } else if (userId.includes('teacher')) {
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

    if (window.db && window.firebaseAPI) {
        handleFirebaseCall(fn, args, onSuccess, onFailure);
    } else {
        if (fn === 'getRecords') setTimeout(() => onSuccess(typeof mockRecords !== 'undefined' ? mockRecords : []), 500);
        else setTimeout(() => onFailure(new Error("Firebase is not initialized or offline")), 500);
    }
}

function serverCallSilent(fn, args, onSuccess, onFailure) {
    const isOffline = !navigator.onLine;
    const isSyncableFn = ['addRecord', 'submitStudentData', 'updateRecord', 'deleteRecord', 'restoreRecord', 'permanentDelete', 'permDelete'].includes(fn);

    if (isSyncableFn && !shouldSyncRecordToServer(fn, args)) {
        if (onSuccess) onSuccess(args && args[0] ? args[0] : true);
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

function prepareRecordForFirestore(data) {
    const cleanData = JSON.parse(JSON.stringify(data));
    // Guard against race conditions: if local db already marked this record verified or uploaded a photo, never overwrite with stale state
    if (cleanData && cleanData.id && typeof db !== 'undefined' && Array.isArray(db)) {
        const latestLocal = db.find(r => r && String(r.id) === String(cleanData.id));
        if (latestLocal) {
            const isLocalVerified = latestLocal.verified === true || String(latestLocal.verified).toLowerCase() === 'true' || latestLocal.verified === 'Completed';
            const isLocalReturned = String(latestLocal.verified).toLowerCase() === 'returned' || String(latestLocal.status).toLowerCase() === 'returned' || latestLocal.returned === true;
            if (isLocalVerified && !isLocalReturned && !cleanData.returned) {
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
    cleanData.updatedAt = Date.now();
    cleanData._serverSaved = true;
    cleanData._syncStatus = 'synced';
    cleanData._pending = false;
    delete cleanData._verifying;
    delete cleanData._displayPhotoSrc;
    delete cleanData._eid;
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
                window._recordsUnsubscribe();
            }
            const q = query(collection(window.db, "records"), orderBy("updatedAt", "desc"));
            window._recordsUnsubscribe = onSnapshot(q, (querySnapshot) => {
                const records = [];
                querySnapshot.forEach((doc) => { records.push({ id: doc.id, ...doc.data() }); });
                if (onSuccess) onSuccess(records);
            }, (error) => {
                console.error("Firebase Snapshot Error:", error);
            });
        } else if (fn === 'submitStudentData' || fn === 'addRecord') {
            const data = args[0];
            const cleanData = prepareRecordForFirestore(data);
            
            // Always use the local ID (e.g. draft_xxx or UUID) as the permanent Firebase Document ID
            const docRef = doc(window.db, "records", String(cleanData.id));
            await setDoc(docRef, cleanData, { merge: true });
            if (onSuccess) onSuccess(data);
        } else if (fn === 'addManyRecords') {
            const records = args[0] || [];
            let addedCount = 0;
            const chunkSize = 25;
            for (let i = 0; i < records.length; i += chunkSize) {
                const chunk = records.slice(i, i + chunkSize);
                await Promise.all(chunk.map(async (rec) => {
                    const cleanData = prepareRecordForFirestore(rec);
                    const docRef = doc(window.db, "records", String(cleanData.id));
                    await setDoc(docRef, cleanData, { merge: true });
                    addedCount++;
                }));
            }
            if (onSuccess) onSuccess(addedCount);
        } else if (fn === 'updateStudentData' || fn === 'updateRecord') {
            const data = args[0];
            const cleanData = prepareRecordForFirestore(data);
            const docRef = doc(window.db, "records", String(cleanData.id));
            await setDoc(docRef, cleanData, { merge: true });
            
            if (onSuccess) onSuccess(data);
        } else if (fn === 'restoreRecord') {
            const arg = args[0];
            const id = typeof arg === 'object' && arg ? arg.id : arg;
            const recObj = (typeof arg === 'object' && arg)
                ? arg
                : ((typeof db !== 'undefined' && Array.isArray(db)) ? db.find(r => r && String(r.id) === String(id)) : null);
            if (recObj && recObj.id) {
                const cleanData = prepareRecordForFirestore({ ...recObj, isDeleted: false, isRestored: true, deletedAt: null });
                const docRef = doc(window.db, "records", String(cleanData.id));
                await setDoc(docRef, cleanData, { merge: true });
            }
            if (onSuccess) onSuccess(true);
        } else if (fn === 'deleteRecord') {
            const arg = args[0];
            const id = typeof arg === 'object' && arg ? arg.id : arg;
            if (id && !String(id).startsWith('TEMP_')) {
                const docRef = doc(window.db, "records", String(id));
                await setDoc(docRef, {
                    isDeleted: true,
                    deletedAt: new Date().toISOString(),
                    updatedAt: Date.now()
                }, { merge: true });
            }
            if (onSuccess) onSuccess(true);
        } else if (fn === 'permanentDelete' || fn === 'permDelete') {
            const arg = args[0];
            const id = typeof arg === 'object' && arg ? arg.id : arg;
            const docRef = doc(window.db, "records", String(id));
            await deleteDoc(docRef);
            if (onSuccess) onSuccess(true);
        } else if (fn === 'deleteAllRecords') {
            const q = query(collection(window.db, "records"));
            const querySnapshot = await getDocs(q);
            const promises = [];
            querySnapshot.forEach((document) => {
                promises.push(deleteDoc(doc(window.db, "records", document.id)));
            });
            // Reset SN counter to 0
            const counterRef = doc(window.db, "config", "snCounter");
            promises.push(setDoc(counterRef, { value: 0 }));
            
            await Promise.all(promises);
            if (onSuccess) onSuccess(true);
        } else if (fn === 'saveFormFields') {
            const data = args[0];
            const docRef = doc(window.db, "system", "formBuilderConfig");
            await setDoc(docRef, data);
            if (onSuccess) onSuccess();
        } else if (fn === 'getFormFields') {
            const docRef = doc(window.db, "system", "formBuilderConfig");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                if (onSuccess) onSuccess(docSnap.data());
            } else {
                if (onSuccess) onSuccess(null);
            }
        } else if (fn === 'generateId') {
            const { runTransaction } = window.firebaseAPI;
            if (!runTransaction) throw new Error("runTransaction missing");
            const localMaxSn = args[0] || 0;
            const counterRef = doc(window.db, "config", "snCounter");
            try {
                const newSn = await runTransaction(window.db, async (transaction) => {
                    const sfDoc = await transaction.get(counterRef);
                    let currentSn = 0;
                    if (sfDoc.exists()) {
                        currentSn = sfDoc.data().value || 0;
                        if (currentSn > 1000000000) currentSn = 0;
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
