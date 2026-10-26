/**
 * Camera Sync Helper
 * Handles smart capture logic:
 * - Mobile: opens native device camera directly
 * - Desktop with Webcam: opens Live Desktop Webcam modal
 * - Desktop without Webcam: opens Mobile QR Code for real-time cloud photo transfer
 * - Mobile QR Receiver: Direct full-screen live camera view with 1-tap Phone Camera & WebRTC
 */

(function () {
    let activeWebcamStream = null;
    let activeCameraFacing = 'user'; // default front for laptop/pc webcam
    let activeQrSessionUnsubscribe = null;
    let currentQrSessionId = null;

    function isMobileDevice() {
        const ua = navigator.userAgent || navigator.vendor || window.opera;
        const isMobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua);
        const isSmallScreen = (window.innerWidth <= 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 1));
        return isMobileUA || isSmallScreen;
    }
    window.isMobileDevice = isMobileDevice;

    async function checkWebcamAvailable() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return false;
        }
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            return videoDevices.length > 0;
        } catch (e) {
            return false;
        }
    }
    window.checkWebcamAvailable = checkWebcamAvailable;

    function getMobileCameraSyncUrl(sessionId) {
        const sc = (typeof schoolConfig !== 'undefined' && schoolConfig) ? schoolConfig : {};
        const schoolCode = (sc.code || 'DPS').toUpperCase();

        const isHttp = window.location.protocol.startsWith('http');
        if (isHttp) {
            // Strip hash fragments (#...) and query parameters (?...) completely to prevent hash routing contamination
            let cleanHref = window.location.href.split('#')[0].split('?')[0];
            let baseUrl = cleanHref.replace(/(?:Admin|School)_Panel\.html/i, '');
            // When opened on localhost or 127.0.0.1, convert to local Wi-Fi IP so mobile phone on same network can reach it
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                baseUrl = baseUrl.replace(window.location.hostname, '192.168.29.177');
            }
            const cleanBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
            return `${cleanBase}mobile-camera.html?session=${encodeURIComponent(sessionId)}&school=${encodeURIComponent(schoolCode)}&_t=${Date.now()}`;
        } else {
            // Live hosted service fallback on GitHub Pages for file:/// mode
            return `https://identifyjvd-web.github.io/IDentify_App/mobile-camera.html?session=${encodeURIComponent(sessionId)}&school=${encodeURIComponent(schoolCode)}&_t=${Date.now()}`;
        }
    }
    window.getMobileCameraSyncUrl = getMobileCameraSyncUrl;

    function applyCapturedPhotoToForm(dataUrl, targetType = 'student_photo') {
        if (!dataUrl) return;

        if (targetType === 'student_photo') {
            if (typeof setPhotoData === 'function') {
                setPhotoData(dataUrl);
            }
            if (typeof window.photoData !== 'undefined') {
                window.photoData = dataUrl;
            }
            if (typeof photoData !== 'undefined') {
                photoData = dataUrl;
            }
            if (typeof showPhotoPreview === 'function') {
                showPhotoPreview(dataUrl);
            }
            if (typeof setUploadFieldProgress === 'function') {
                setUploadFieldProgress('Saved Locally', 100, false);
            }
            if (typeof resetUploadFieldLabel === 'function') {
                resetUploadFieldLabel('Saved');
            }

            const removeBtn = document.getElementById('remove-photo-btn');
            if (removeBtn) removeBtn.classList.remove('hidden');

            const uploadInput = document.getElementById('photo-upload');
            if (uploadInput) uploadInput.value = '';
            const captureInput = document.getElementById('photo-capture');
            if (captureInput) captureInput.value = '';

            if (typeof queueDraftSave === 'function') queueDraftSave('Document');
            if (typeof queueServerDraftSync === 'function') queueServerDraftSync();
            if (typeof renderCurrentRecordsPage === 'function') renderCurrentRecordsPage();

            // Automatically open crop modal for passport alignment
            setTimeout(() => {
                if (typeof openCropModal === 'function') {
                    openCropModal();
                }
            }, 300);
        } else if (typeof targetType === 'string' && targetType.startsWith('custom-')) {
            const idx = parseInt(targetType.replace('custom-', ''), 10);
            if (!isNaN(idx)) {
                if (typeof syncBlankField === 'function') {
                    syncBlankField(`in-customField${idx}`, dataUrl);
                }
                const previewImg = document.getElementById(`blank-custom-img-preview-${idx}`);
                const placeholder = document.getElementById(`blank-custom-img-placeholder-${idx}`);
                const container = document.getElementById(`blank-custom-img-container-${idx}`);

                if (previewImg) {
                    previewImg.src = dataUrl;
                    previewImg.classList.remove('hidden');
                }
                if (placeholder) {
                    placeholder.classList.add('hidden');
                }

                let cropBtn = document.getElementById(`blank-custom-img-crop-${idx}`);
                let removeBtn = document.getElementById(`blank-custom-img-remove-${idx}`);
                if (!cropBtn && container) {
                    cropBtn = document.createElement('button');
                    cropBtn.type = 'button';
                    cropBtn.id = `blank-custom-img-crop-${idx}`;
                    cropBtn.className = 'absolute bottom-1 left-1 w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform hover:bg-blue-600';
                    cropBtn.onclick = () => openCustomCropModal(idx);
                    cropBtn.title = 'Crop Photo';
                    cropBtn.innerHTML = '<i class="fa-solid fa-crop-simple text-[11px]"></i>';
                    container.appendChild(cropBtn);
                } else if (cropBtn) {
                    cropBtn.classList.remove('hidden');
                }

                if (!removeBtn && container) {
                    removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.id = `blank-custom-img-remove-${idx}`;
                    removeBtn.className = 'absolute bottom-1 right-1 w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform hover:bg-rose-600';
                    removeBtn.onclick = () => {
                        if (typeof removeCustomPhoto === 'function') removeCustomPhoto(idx);
                    };
                    removeBtn.title = 'Delete Photo';
                    removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-[12px]"></i>';
                    container.appendChild(removeBtn);
                } else if (removeBtn) {
                    removeBtn.classList.remove('hidden');
                }

                if (typeof renderCurrentRecordsPage === 'function') renderCurrentRecordsPage();

                setTimeout(() => {
                    if (typeof openCustomCropModal === 'function') {
                        openCustomCropModal(idx);
                    }
                }, 300);
            }
        }
    }
    window.applyCapturedPhotoToForm = applyCapturedPhotoToForm;

    // --- 1. Desktop Webcam Modal ---
    function closeDesktopWebcamModal() {
        if (activeWebcamStream) {
            activeWebcamStream.getTracks().forEach(t => t.stop());
            activeWebcamStream = null;
        }
        const modal = document.getElementById('desktop-webcam-modal');
        if (modal) modal.remove();
    }
    window.closeDesktopWebcamModal = closeDesktopWebcamModal;

    async function openDesktopWebcamModal(targetType = 'student_photo') {
        closeDesktopWebcamModal();
        closeMobileQrCaptureModal();

        const modal = document.createElement('div');
        modal.id = 'desktop-webcam-modal';
        modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none';
        modal.innerHTML = `
            <div class="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col text-white">
                <!-- Header -->
                <div class="px-5 py-4 flex items-center justify-between border-b border-slate-800 bg-slate-950/60">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                            <i class="fa-solid fa-camera"></i>
                        </div>
                        <div>
                            <h3 class="text-sm font-black text-white">Desktop Webcam Capture</h3>
                            <p class="text-[10px] text-slate-400">Position face inside oval guide and click snapshot</p>
                        </div>
                    </div>
                    <button type="button" onclick="closeDesktopWebcamModal()" class="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-400 hover:text-white flex items-center justify-center transition">
                        <i class="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>

                <!-- Video Viewport -->
                <div class="relative bg-black flex items-center justify-center overflow-hidden min-h-[340px]">
                    <video id="webcam-live-video" autoplay playsinline class="w-full max-h-[380px] object-cover"></video>
                    <canvas id="webcam-canvas" class="hidden"></canvas>

                    <!-- Oval Guide for Passport Photo -->
                    <div class="absolute pointer-events-none inset-0 flex flex-col items-center justify-center">
                        <div class="w-52 h-64 border-2 border-dashed border-emerald-400/80 rounded-full" style="box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.4);">
                        </div>
                        <div class="absolute bottom-4 bg-black/60 backdrop-blur-xs text-[11px] font-bold text-white px-3 py-1 rounded-full border border-white/10">
                            Align Face in Center
                        </div>
                    </div>

                    <!-- Loading Spinner until stream starts -->
                    <div id="webcam-loading-spinner" class="absolute flex flex-col items-center justify-center text-emerald-400">
                        <div class="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                        <span class="text-xs font-bold text-slate-300">Starting Camera...</span>
                    </div>
                </div>

                <!-- Footer Controls -->
                <div class="p-4 bg-slate-950 flex items-center justify-between border-t border-slate-800/80 gap-3">
                    <button type="button" onclick="openMobileQrCaptureModal('${targetType}')" class="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white text-xs font-bold flex items-center gap-2 border border-slate-700 transition" title="Switch to Mobile Camera QR Code">
                        <i class="fa-solid fa-qrcode text-emerald-400"></i> Use Mobile Phone
                    </button>

                    <button type="button" id="btn-webcam-snapshot" onclick="takeDesktopWebcamSnapshot('${targetType}')" class="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition">
                        <i class="fa-solid fa-camera text-sm"></i> Capture Photo
                    </button>

                    <button type="button" onclick="closeDesktopWebcamModal()" class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 text-xs font-bold transition">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        try {
            const constraints = {
                video: {
                    facingMode: activeCameraFacing,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };
            activeWebcamStream = await navigator.mediaDevices.getUserMedia(constraints);
            const videoEl = document.getElementById('webcam-live-video');
            const spinner = document.getElementById('webcam-loading-spinner');
            if (videoEl) {
                videoEl.srcObject = activeWebcamStream;
                videoEl.onloadedmetadata = () => {
                    if (spinner) spinner.classList.add('hidden');
                };
            }
        } catch (err) {
            console.error("Webcam open error:", err);
            modal.remove();
            // Fallback directly to Mobile QR code if webcam access fails
            openMobileQrCaptureModal(targetType);
        }
    }
    window.openDesktopWebcamModal = openDesktopWebcamModal;

    function takeDesktopWebcamSnapshot(targetType = 'student_photo') {
        const video = document.getElementById('webcam-live-video');
        const canvas = document.getElementById('webcam-canvas');
        if (!video || !canvas) return;

        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

        closeDesktopWebcamModal();
        applyCapturedPhotoToForm(dataUrl, targetType);
        if (typeof showToast === 'function') {
            showToast('Webcam photo captured ✓');
        }
    }
    window.takeDesktopWebcamSnapshot = takeDesktopWebcamSnapshot;

    // --- 2. Desktop Mobile QR Code Modal ---
    function closeMobileQrCaptureModal() {
        if (activeQrSessionUnsubscribe) {
            try { activeQrSessionUnsubscribe(); } catch(e){}
            activeQrSessionUnsubscribe = null;
        }
        if (currentQrSessionId && window.firebaseAPI && window.db) {
            try {
                window.firebaseAPI.deleteDoc(window.firebaseAPI.doc(window.db, "camera_sync", currentQrSessionId)).catch(()=>{});
            } catch(e){}
            currentQrSessionId = null;
        }
        const modal = document.getElementById('mobile-qr-modal');
        if (modal) modal.remove();
    }
    window.closeMobileQrCaptureModal = closeMobileQrCaptureModal;

    async function openMobileQrCaptureModal(targetType = 'student_photo') {
        closeDesktopWebcamModal();
        closeMobileQrCaptureModal();

        const sessionId = 'cam_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        currentQrSessionId = sessionId;

        const targetMobileUrl = getMobileCameraSyncUrl(sessionId);

        const modal = document.createElement('div');
        modal.id = 'mobile-qr-modal';
        modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none';
        modal.innerHTML = `
            <div class="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl border border-slate-100 flex flex-col items-center animate-in zoom-in-95 duration-200">
                <!-- Header -->
                <div class="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mb-3 shadow-inner">
                    <i class="fa-solid fa-qrcode text-2xl"></i>
                </div>
                <h3 class="text-base font-black text-slate-800">Scan QR with Mobile Camera</h3>
                <p class="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
                    Apne mobile se yeh QR code scan karein. Phone me direct live camera open hoga aur photo capture karte hi form me automatically attach ho jayegi.
                </p>

                <!-- QR Code Display Box -->
                <div class="relative p-3.5 bg-slate-50 border-2 border-dashed border-emerald-400 rounded-2xl mb-4 flex flex-col items-center justify-center shadow-xs">
                    <canvas id="qr-code-canvas" class="rounded-xl"></canvas>
                    <img id="qr-code-fallback-img" class="hidden rounded-xl w-[200px] h-[200px]" alt="QR Code">
                    
                    <div class="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black">
                        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Live Real-time Sync Active
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="flex flex-col gap-2 w-full">
                    <button type="button" onclick="navigator.clipboard.writeText('${targetMobileUrl}').then(() => showToast('Mobile Camera Link Copied!'))" class="w-full py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition">
                        <i class="fa-solid fa-copy text-xs"></i> Copy Camera Link
                    </button>
                    
                    <button type="button" onclick="openDesktopWebcamModal('${targetType}')" class="w-full py-2 bg-transparent hover:bg-emerald-50 active:scale-95 text-emerald-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition">
                        <i class="fa-solid fa-video text-xs"></i> Try PC Webcam Instead
                    </button>

                    <button type="button" onclick="closeMobileQrCaptureModal()" class="w-full py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 font-bold text-xs rounded-xl transition mt-1">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Render QR Code using QRious if available, or fallback to QR API
        setTimeout(() => {
            const canvas = document.getElementById('qr-code-canvas');
            const fallbackImg = document.getElementById('qr-code-fallback-img');

            if (typeof QRious !== 'undefined' && canvas) {
                new QRious({
                    element: canvas,
                    value: targetMobileUrl,
                    size: 210,
                    level: 'H'
                });
            } else if (fallbackImg) {
                if (canvas) canvas.classList.add('hidden');
                fallbackImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=210x210&data=${encodeURIComponent(targetMobileUrl)}`;
                fallbackImg.classList.remove('hidden');
            }
        }, 50);

        // Start listening to Firestore for photo capture event
        if (window.firebaseAPI && window.db) {
            try {
                const { doc, onSnapshot, deleteDoc } = window.firebaseAPI;
                const docRef = doc(window.db, "camera_sync", sessionId);

                activeQrSessionUnsubscribe = onSnapshot(docRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        if (data && data.photoData) {
                            // Photo arrived from mobile!
                            if (activeQrSessionUnsubscribe) {
                                activeQrSessionUnsubscribe();
                                activeQrSessionUnsubscribe = null;
                            }
                            deleteDoc(docSnap.ref).catch(()=>{});
                            closeMobileQrCaptureModal();

                            applyCapturedPhotoToForm(data.photoData, targetType);

                            if (typeof showToast === 'function') {
                                showToast('<i class="fa-solid fa-check text-emerald-500 mr-1.5"></i> Photo captured from Mobile & attached ✓');
                            }
                        }
                    }
                });
            } catch (err) {
                console.warn("Firestore camera_sync snapshot error:", err);
            }
        }
    }
    window.openMobileQrCaptureModal = openMobileQrCaptureModal;

    // --- 3. Master Dispatcher (for forms) ---
    async function triggerSmartPhotoCapture(targetType = 'student_photo') {
        // Case A: Mobile device
        if (isMobileDevice()) {
            if (targetType === 'student_photo') {
                const input = document.getElementById('photo-capture');
                if (input) input.click();
            } else if (typeof targetType === 'string' && targetType.startsWith('custom-')) {
                const idx = targetType.replace('custom-', '');
                const input = document.getElementById(`blank-custom-img-capture-${idx}`);
                if (input) input.click();
            }
            return;
        }

        // Case B: Desktop PC
        const hasWebcam = await checkWebcamAvailable();
        if (hasWebcam) {
            openDesktopWebcamModal(targetType);
        } else {
            openMobileQrCaptureModal(targetType);
        }
    }
    window.triggerSmartPhotoCapture = triggerSmartPhotoCapture;

    function triggerSmartCustomPhotoCapture(idx) {
        triggerSmartPhotoCapture(`custom-${idx}`);
    }
    window.triggerSmartCustomPhotoCapture = triggerSmartCustomPhotoCapture;

    // --- 4. Direct Mobile Camera Receiver (when opened via QR scan on mobile) ---
    function checkAndLaunchDirectMobileCamera() {
        const params = new URLSearchParams(window.location.search);
        const isCam = params.has('session') || params.get('mode') === 'camera_sync' || params.has('cam');
        if (!isCam) return;

        const sessionId = params.get('session') || params.get('cam');
        const schoolCode = (params.get('school') || 'IDentify').toUpperCase();

        document.documentElement.classList.add('is-camera-sync-mode');

        const initUI = () => {
            // Remove splash screen immediately
            const splash = document.getElementById('initial-splash-screen');
            if (splash) splash.remove();

            // Set document title
            document.title = `${schoolCode} Live Camera`;

            // Create root container
            let root = document.getElementById('direct-mobile-camera-sync-root');
            if (!root) {
                root = document.createElement('div');
                root.id = 'direct-mobile-camera-sync-root';
                root.className = 'fixed inset-0 z-[999999] bg-[#0b0f19] text-white flex flex-col justify-between overflow-hidden select-none';
                document.body.appendChild(root);
            }

            root.innerHTML = `
                <!-- Top Header -->
                <header class="z-20 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
                            <i class="fa-solid fa-camera"></i>
                        </div>
                        <div>
                            <h1 class="text-xs font-black tracking-wide text-white">${schoolCode} Live Camera</h1>
                            <p class="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> Live PC Sync Active
                            </p>
                        </div>
                    </div>
                    <button type="button" id="direct-cam-flip-btn" class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 flex items-center justify-center text-white transition">
                        <i class="fa-solid fa-camera-rotate text-sm"></i>
                    </button>
                </header>

                <!-- Camera Viewport -->
                <main class="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
                    <video id="direct-cam-video" autoplay playsinline muted class="absolute inset-0 w-full h-full object-cover"></video>
                    <canvas id="direct-cam-canvas" class="hidden"></canvas>

                    <!-- Passport Guideline Overlay -->
                    <div id="direct-cam-guidelines" class="relative pointer-events-none z-10 w-64 h-80 flex flex-col items-center justify-center">
                        <div style="border: 2px dashed rgba(255,255,255,0.7); border-radius: 50% / 60%; box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);" class="w-56 h-72 relative flex items-center justify-center">
                            <div class="text-[11px] font-bold text-white/90 bg-black/60 px-3 py-1 rounded-full mb-24">
                                Fit Face Inside Frame
                            </div>
                        </div>
                    </div>

                    <!-- Direct Phone Camera Native Button (1-Tap for Native Camera App) -->
                    <div class="absolute top-4 left-1/2 -translate-x-1/2 z-20">
                        <button type="button" id="direct-cam-native-app-btn" class="px-4 py-2 bg-emerald-600/90 hover:bg-emerald-500 active:scale-95 backdrop-blur-md border border-white/20 rounded-full text-[11px] font-extrabold text-white flex items-center gap-2 shadow-xl transition">
                            <i class="fa-solid fa-camera text-white"></i> Open Phone Camera App
                        </button>
                    </div>

                    <!-- Captured Preview Overlay -->
                    <div id="direct-cam-preview" class="hidden absolute inset-0 z-30 bg-black flex flex-col items-center justify-center p-4">
                        <img id="direct-cam-preview-img" src="" alt="Captured Photo" class="max-h-[68vh] max-w-full rounded-2xl shadow-2xl object-contain border border-white/20">
                        <div class="flex items-center gap-3 mt-5 w-full max-w-xs">
                            <button type="button" id="direct-cam-retake-btn" class="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 border border-slate-700 transition">
                                <i class="fa-solid fa-arrow-rotate-left"></i> Retake
                            </button>
                            <button type="button" id="direct-cam-send-btn" class="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition">
                                <i class="fa-solid fa-paper-plane"></i> Send to PC
                            </button>
                        </div>
                    </div>

                    <!-- Syncing Progress Overlay -->
                    <div id="direct-cam-sync-overlay" class="hidden absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                        <div id="direct-cam-sync-spinner" class="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <div id="direct-cam-sync-success-icon" class="hidden w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 text-3xl mb-4 animate-bounce">
                            <i class="fa-solid fa-check"></i>
                        </div>
                        <h3 id="direct-cam-sync-title" class="text-base font-black tracking-wide text-white">Sending to Desktop PC...</h3>
                        <p id="direct-cam-sync-subtitle" class="text-xs text-slate-300 mt-2 max-w-xs leading-relaxed">
                            Photo is transferring directly into the student registration form on your PC.
                        </p>
                    </div>
                </main>

                <!-- Bottom Controls Bar -->
                <footer id="direct-cam-bottom-controls" class="z-20 pb-8 pt-4 px-6 flex items-center justify-around bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                    <!-- Native Camera & Gallery file inputs -->
                    <input type="file" id="direct-cam-native-file-input" accept="image/*" capture="environment" class="hidden">
                    <input type="file" id="direct-cam-gallery-file-input" accept="image/*" class="hidden">

                    <button type="button" id="direct-cam-gallery-btn" class="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 flex items-center justify-center text-white transition" title="Choose from Gallery">
                        <i class="fa-solid fa-image text-sm"></i>
                    </button>

                    <!-- Big Shutter Button -->
                    <button type="button" id="direct-cam-shutter-btn" style="box-shadow: 0 0 0 4px rgba(255,255,255,0.3), 0 0 20px rgba(16,185,129,0.4);" class="w-18 h-18 rounded-full bg-white flex items-center justify-center p-1.5 active:scale-90 transition-transform">
                        <div class="w-full h-full rounded-full bg-emerald-500 flex items-center justify-center text-white text-2xl shadow-inner">
                            <i class="fa-solid fa-camera"></i>
                        </div>
                    </button>

                    <button type="button" id="direct-cam-torch-btn" class="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 flex items-center justify-center text-white transition" title="Torch">
                        <i class="fa-solid fa-bolt text-sm"></i>
                    </button>
                </footer>
            `;

            // State & handlers
            let mediaStream = null;
            let currentFacing = 'environment';
            let torchOn = false;
            let currentPhotoData = null;

            async function startDirectStream() {
                if (mediaStream) {
                    try {
                        mediaStream.getTracks().forEach(t => t.stop());
                    } catch(e){}
                }
                const videoEl = document.getElementById('direct-cam-video');
                if (!videoEl) return;
                try {
                    mediaStream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            facingMode: { ideal: currentFacing },
                            width: { ideal: 1280 },
                            height: { ideal: 720 }
                        },
                        audio: false
                    });
                    videoEl.srcObject = mediaStream;
                } catch (e) {
                    console.warn("Direct stream ideal constraint failed, fallback to any video:", e);
                    try {
                        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                        videoEl.srcObject = mediaStream;
                    } catch (err) {
                        console.warn("Direct stream getUserMedia blocked, native camera input ready:", err);
                    }
                }
            }

            // Wire buttons
            const flipBtn = document.getElementById('direct-cam-flip-btn');
            if (flipBtn) {
                flipBtn.onclick = () => {
                    currentFacing = (currentFacing === 'environment') ? 'user' : 'environment';
                    startDirectStream();
                };
            }

            const torchBtn = document.getElementById('direct-cam-torch-btn');
            if (torchBtn) {
                torchBtn.onclick = async () => {
                    if (!mediaStream) return;
                    const track = mediaStream.getVideoTracks()[0];
                    if (!track) return;
                    try {
                        torchOn = !torchOn;
                        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
                        const icon = torchBtn.querySelector('i');
                        if (icon) {
                            icon.className = torchOn ? 'fa-solid fa-bolt text-amber-400' : 'fa-solid fa-bolt text-sm';
                        }
                    } catch(e){
                        console.warn("Torch not supported on this device");
                    }
                };
            }

            const nativeInput = document.getElementById('direct-cam-native-file-input');
            const galleryInput = document.getElementById('direct-cam-gallery-file-input');
            const nativeAppBtn = document.getElementById('direct-cam-native-app-btn');
            const galleryBtn = document.getElementById('direct-cam-gallery-btn');

            if (nativeAppBtn && nativeInput) {
                nativeAppBtn.onclick = () => nativeInput.click();
            }
            if (galleryBtn && galleryInput) {
                galleryBtn.onclick = () => galleryInput.click();
            }

            const handleFile = (file) => {
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    currentPhotoData = e.target.result;
                    showPreview(currentPhotoData);
                };
                reader.readAsDataURL(file);
            };

            if (nativeInput) nativeInput.onchange = (e) => handleFile(e.target.files[0]);
            if (galleryInput) galleryInput.onchange = (e) => handleFile(e.target.files[0]);

            const shutterBtn = document.getElementById('direct-cam-shutter-btn');
            if (shutterBtn) {
                shutterBtn.onclick = () => {
                    const video = document.getElementById('direct-cam-video');
                    const canvas = document.getElementById('direct-cam-canvas');
                    if (!video || !canvas) return;

                    const w = video.videoWidth || 1280;
                    const h = video.videoHeight || 720;
                    canvas.width = w;
                    canvas.height = h;

                    const ctx = canvas.getContext('2d');
                    if (currentFacing === 'user') {
                        ctx.translate(w, 0);
                        ctx.scale(-1, 1);
                    }
                    ctx.drawImage(video, 0, 0, w, h);
                    currentPhotoData = canvas.toDataURL('image/jpeg', 0.85);
                    showPreview(currentPhotoData);
                };
            }

            function showPreview(dataUrl) {
                const preview = document.getElementById('direct-cam-preview');
                const previewImg = document.getElementById('direct-cam-preview-img');
                const bottomControls = document.getElementById('direct-cam-bottom-controls');
                if (previewImg) previewImg.src = dataUrl;
                if (preview) preview.classList.remove('hidden');
                if (bottomControls) bottomControls.classList.add('hidden');
            }

            const retakeBtn = document.getElementById('direct-cam-retake-btn');
            if (retakeBtn) {
                retakeBtn.onclick = () => {
                    currentPhotoData = null;
                    const preview = document.getElementById('direct-cam-preview');
                    const bottomControls = document.getElementById('direct-cam-bottom-controls');
                    if (preview) preview.classList.add('hidden');
                    if (bottomControls) bottomControls.classList.remove('hidden');
                    if (nativeInput) nativeInput.value = '';
                    if (galleryInput) galleryInput.value = '';
                };
            }

            const sendBtn = document.getElementById('direct-cam-send-btn');
            if (sendBtn) {
                sendBtn.onclick = async () => {
                    if (!currentPhotoData || !sessionId) return;
                    sendBtn.disabled = true;

                    const syncOverlay = document.getElementById('direct-cam-sync-overlay');
                    const syncSpinner = document.getElementById('direct-cam-sync-spinner');
                    const syncSuccessIcon = document.getElementById('direct-cam-sync-success-icon');
                    const syncTitle = document.getElementById('direct-cam-sync-title');
                    const syncSubtitle = document.getElementById('direct-cam-sync-subtitle');

                    if (syncOverlay) syncOverlay.classList.remove('hidden');

                    try {
                        // Compress photo for lightning fast Firestore sync
                        const img = new Image();
                        img.src = currentPhotoData;
                        await new Promise(r => { img.onload = r; });
                        const maxDim = 1000;
                        let cw = img.width, ch = img.height;
                        if (cw > maxDim || ch > maxDim) {
                            if (cw > ch) { ch = Math.round((ch * maxDim) / cw); cw = maxDim; }
                            else { cw = Math.round((cw * maxDim) / ch); ch = maxDim; }
                        }
                        const rc = document.createElement('canvas');
                        rc.width = cw; rc.height = ch;
                        rc.getContext('2d').drawImage(img, 0, 0, cw, ch);
                        const compressed = rc.toDataURL('image/jpeg', 0.82);

                        // Ensure Firebase Firestore ready
                        let waitCount = 0;
                        while ((!window.db || !window.firebaseAPI || !window.firebaseAPI.setDoc) && waitCount < 20) {
                            await new Promise(r => setTimeout(r, 100));
                            waitCount++;
                        }

                        if (!window.db || !window.firebaseAPI || !window.firebaseAPI.setDoc) {
                            try {
                                const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js");
                                const { getAuth, signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js");
                                const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js");
                                const firebaseConfig = {
                                    apiKey: "AIzaSyBMZ3LUNSQubKjanv4MNyDNsvKwPmsKQY8",
                                    authDomain: "id3files.firebaseapp.com",
                                    projectId: "id3files",
                                    storageBucket: "id3files.firebasestorage.app",
                                    messagingSenderId: "839961631978",
                                    appId: "1:839961631978:web:4300cbe1fcb1461878cb93"
                                };
                                const app = initializeApp(firebaseConfig, "camera-sync-auto-" + Date.now());
                                const auth = getAuth(app);
                                const db = getFirestore(app);
                                await signInWithEmailAndPassword(auth, "public.identify.sync@gmail.com", "PublicSync#2026App");
                                window.db = db;
                                window.auth = auth;
                                window.firebaseAPI = { doc, setDoc, signInWithEmailAndPassword };
                            } catch(e) {
                                console.warn("Dynamic Firebase fallback notice:", e);
                            }
                        }

                        if (window.auth && (!window.auth.currentUser || !window.auth.currentUser.email) && window.firebaseAPI && window.firebaseAPI.signInWithEmailAndPassword) {
                            try {
                                await window.firebaseAPI.signInWithEmailAndPassword(window.auth, "public.identify.sync@gmail.com", "PublicSync#2026App");
                            } catch(e){}
                        }

                        if (window.db && window.firebaseAPI && window.firebaseAPI.setDoc && window.firebaseAPI.doc) {
                            const docRef = window.firebaseAPI.doc(window.db, "camera_sync", sessionId);
                            await window.firebaseAPI.setDoc(docRef, {
                                photoData: compressed,
                                status: "captured",
                                schoolCode: schoolCode,
                                timestamp: Date.now()
                            }, { merge: true });
                        } else {
                            throw new Error("Cloud database connecting... please retry in 2 seconds.");
                        }

                        if (syncSpinner) syncSpinner.classList.add('hidden');
                        if (syncSuccessIcon) syncSuccessIcon.classList.remove('hidden');
                        if (syncTitle) syncTitle.innerText = "Photo Sent to PC! ✓";
                        if (syncSubtitle) syncSubtitle.innerHTML = "Photo has been transferred directly into the form on your computer.<br><br><span class='text-emerald-400 font-bold'>You can close this tab now.</span>";

                        if (mediaStream) {
                            try { mediaStream.getTracks().forEach(t => t.stop()); } catch(e){}
                        }
                    } catch (err) {
                        console.error("Camera sync send error:", err);
                        alert("Error sending photo: " + (err.message || "Network issue. Please try again."));
                        if (syncOverlay) syncOverlay.classList.add('hidden');
                        sendBtn.disabled = false;
                    }
                };
            }

            // Start stream
            startDirectStream();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initUI);
        } else {
            initUI();
        }
    }
    window.checkAndLaunchDirectMobileCamera = checkAndLaunchDirectMobileCamera;

    // Auto-check on script load
    checkAndLaunchDirectMobileCamera();

})();
