async function bulkDownloadSelectedJpg() {
    if (typeof selectedRecords === 'undefined' || selectedRecords.size === 0) return;
    
    const count = selectedRecords.size;
    const btn = document.getElementById('btn-bulk-download-jpg');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[16px]"></i>';
    
    const origMode = typeof blankRecordMode !== 'undefined' ? blankRecordMode : 'none';
    const origPreview = typeof previewRecord !== 'undefined' ? previewRecord : null;
    
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100vw'; overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.95)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex'; overlay.style.flexDirection = 'column'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center'; overlay.style.color = 'white';
    overlay.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-5xl mb-6 text-amber-500"></i><div id="bulk-jpg-progress" class="text-2xl font-black tracking-widest uppercase">Generating 0 / ' + count + '</div><div class="text-sm text-slate-400 mt-2">Please do not close this window</div>';
    document.body.appendChild(overlay);

    try {
        const zip = new JSZip();
        const folder = zip.folder("ID_Cards_JPG");
        let doneCount = 0;
        
        const recordsSource = (typeof window !== 'undefined' && Array.isArray(window.studentRecordsDb))
            ? window.studentRecordsDb
            : ((typeof db !== 'undefined' && Array.isArray(db)) ? db : []);

        const recordsToExport = [];
        selectedRecords.forEach(id => {
            const rec = recordsSource.find(x => String(x.id) === String(id));
            if (rec) recordsToExport.push(rec);
        });

        for (let i = 0; i < recordsToExport.length; i++) {
            const rec = recordsToExport[i];
            doneCount++;
            document.getElementById('bulk-jpg-progress').innerText = `Generating ${doneCount} / ${count}`;
            
            if (typeof previewRecord !== 'undefined') previewRecord = rec;
            if (typeof setBlankRecordMode === 'function') setBlankRecordMode('preview'); 
            
            // Wait for render and images to load
            await new Promise(res => setTimeout(res, 400));
            
            const card = document.querySelector('.preview-dark-card');
            if (card) {
                const actionBars = card.querySelectorAll('.preview-action-bar');
                actionBars.forEach(bar => bar.style.display = 'none');
                
                const dynamicScale = window.innerWidth < 768 ? 1 : 2;
                const canvas = await html2canvas(card, { scale: dynamicScale, useCORS: true, backgroundColor: '#1e293b' });
                
                actionBars.forEach(bar => bar.style.display = '');
                
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                const sn = rec.sn ? rec.sn : 'Unknown';
                const safeName = (rec.studentName || rec.name || 'Unknown').replace(/[^\p{L}\p{N}\s_-]/gu, '_').trim();
                folder.file(`ID_Card_${sn}_${safeName}.jpg`, imgData.split(',')[1], {base64: true});
            }
        }
        
        document.getElementById('bulk-jpg-progress').innerText = "Zipping Files...";
        const content = await zip.generateAsync({type:"blob"});
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        let schoolCode = 'DPS';
        if (typeof schoolConfig !== 'undefined' && schoolConfig) {
            if (schoolConfig.code && String(schoolConfig.code).trim()) {
                schoolCode = String(schoolConfig.code).trim().replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
            } else if (schoolConfig.name && String(schoolConfig.name).trim()) {
                schoolCode = String(schoolConfig.name).trim().split(/\s+/).map(w => w[0]).join('').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
            }
        }
        if (!schoolCode) schoolCode = 'DPS';
        const zipFileName = `${schoolCode}_${dd}_${mm}_${yyyy}_${selectedIds.length}count.zip`;

        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(content);
        downloadLink.download = zipFileName;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        if (typeof showToast === 'function') showToast("Downloaded Successfully!");
    } catch (e) {
        console.error("Bulk JPG Error:", e);
        if (typeof showToast === 'function') showToast("Error generating JPGs", true);
    } finally {
        if (btn) btn.innerHTML = origHtml;
        document.body.removeChild(overlay);
        if (typeof previewRecord !== 'undefined') previewRecord = origPreview;
        if (typeof setBlankRecordMode === 'function') setBlankRecordMode(origMode);
        if (origMode === 'none' && typeof renderCurrentRecordsPage === 'function') {
            renderCurrentRecordsPage();
        }
    }
}

function downloadPreviewCardAsJpg() {
    // Disabled per user request (no long-press or automatic JPG download on preview card)
    return;
}

