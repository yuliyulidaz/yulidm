// State
let messages = [];
let isDayMode = false;
let selectedMessageId = null;
let isLinkMenuOpen = false;
let isPhotoMenuOpen = false;
let defaultAvatarUrl = ''; // Store generated avatar
let deletedMessageBackup = null; // For Undo
let undoTimeout = null;
let readReceipt = null; // { messageId: number, text: string } or null

// DOM Elements
const chatArea = document.getElementById('chat-area');
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const inputChatWidth = document.getElementById('input-chat-width');
const widthDisplay = document.getElementById('width-display'); // New element
const captureArea = document.getElementById('capture-area');
const chatRoot = document.getElementById('chat-root');

// Header Elements
const headerAvatar = document.getElementById('header-avatar');
const headerName = document.getElementById('header-name');

// Helper: Generate Avatar
function generateAvatar(text) {
    if (!text) return '';

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#6c757d'; // Default gray
    ctx.fillRect(0, 0, 100, 100);

    // Text Processing
    let displayText = '';
    // Basic regex for CJK (Korean, Japanese, Chinese)
    const cjkRegex = /[\u3131-\uD79D\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;

    if (cjkRegex.test(text)) {
        displayText = text.charAt(0);
    } else {
        displayText = text.substring(0, 2);
    }

    // Draw Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayText, 50, 50);

    return canvas.toDataURL();
}

// Image Upload & Crop Logic
const hiddenFileInput = document.getElementById('hidden-file-input');
const cropModal = document.getElementById('crop-modal');
const cropImage = document.getElementById('crop-image');
const btnCropConfirm = document.getElementById('btn-crop-confirm');
const btnCropCancel = document.getElementById('btn-crop-cancel');

let currentUploadCallback = null;
let currentCropper = null;
let currentTargetType = 'avatar'; // 'avatar' or 'link'
let isCustomAvatar = false;

hiddenFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && currentUploadCallback) {
        const reader = new FileReader();
        reader.onload = (event) => {
            // Open Modal instead of direct apply
            openCropModal(event.target.result);
            hiddenFileInput.value = ''; // Reset
        };
        reader.readAsDataURL(file);
    }
});

function triggerFileUpload(callback, type = 'avatar') {
    currentUploadCallback = callback;
    currentTargetType = type;
    hiddenFileInput.click();
}

function openCropModal(imageSrc) {
    cropImage.src = imageSrc;
    cropModal.style.display = 'flex';

    if (currentCropper) {
        currentCropper.destroy();
    }

    const ratio = currentTargetType === 'avatar' ? 1 :
        currentTargetType === 'photo' ? NaN : 1.85; // NaN = Free aspect ratio for photos

    currentCropper = new Cropper(cropImage, {
        aspectRatio: ratio,
        viewMode: 1,
        autoCropArea: 1,
    });
}

function closeCropModal() {
    cropModal.style.display = 'none';
    if (currentCropper) {
        currentCropper.destroy();
        currentCropper = null;
    }
}

btnCropCancel.addEventListener('click', () => {
    closeCropModal();
    currentUploadCallback = null;
});

btnCropConfirm.addEventListener('click', () => {
    if (currentCropper && currentUploadCallback) {
        // dimensions logic
        let width, height;

        if (currentTargetType === 'avatar') {
            width = 300; height = 300;
        } else if (currentTargetType === 'photo') {
            width = 1200; height = 1200; // High quality for photos (max dimension)
        } else {
            width = 600; height = 324; // Link default
        }

        const canvas = currentCropper.getCroppedCanvas({
            width: width,
            height: height,
            imageSmoothingQuality: 'high'
        });

        currentUploadCallback(canvas.toDataURL('image/jpeg', 0.9)); // High quality JPEG
        closeCropModal();
        currentUploadCallback = null;
    }
});


// Global function for Link Images (called from inline HTML)
window.uploadLinkImage = function (id) {
    triggerFileUpload((base64Url) => {
        updateLink(id, 'image', base64Url);
        render();
    }, 'link');
};

// Global function for Message Images
window.uploadImageForMessage = function (id) {
    triggerFileUpload((base64Url) => {
        const msg = messages.find(m => m.id === id);
        if (msg) {
            msg.imageUrl = base64Url;
            render();
        }
    }, 'photo'); // Use 'photo' type for high quality
};

// Initialization
function init() {
    // Add default welcome message
    // Add default welcome message
    addMessage('text', 'left', '말풍선을 클릭하여 수정하세요.\n하단메뉴에서 화살표를 눌러 말풍선을 추가하세요.');

    // Clear header placeholders explicitly
    headerName.innerHTML = '';
    document.querySelector('.header-username').innerHTML = '';

    // Initial Default Avatar
    updateDefaultAvatar();

    // Header Avatar Click Upload
    headerAvatar.addEventListener('click', () => {
        triggerFileUpload((base64Url) => {
            isCustomAvatar = true;
            defaultAvatarUrl = base64Url; // Update "default" to this new image so it persists
            headerAvatar.style.backgroundImage = `url('${base64Url}')`;
            headerAvatar.classList.remove('empty-state'); // Remove camera icon
            updateAllLeftAvatars(); // Sync to existing messages
        }, 'avatar');
    });

    // Validating header name input for avatar generation
    headerName.addEventListener('input', () => {
        if (!isCustomAvatar) {
            updateDefaultAvatar();
        }
    });

    // Theme & Settings
    const btnSettings = document.getElementById('btn-settings');
    const settingsMenu = document.getElementById('settings-menu');
    const btnThemeToggle = document.getElementById('btn-theme-toggle');

    // Color Theme Logic
    const btnColorToggle = document.getElementById('btn-color-toggle');
    const colorPalette = document.getElementById('color-palette');
    const colorCircles = document.querySelectorAll('.color-circle');

    btnSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('open');
    });

    btnThemeToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTheme();
    });

    btnColorToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        colorPalette.classList.toggle('hidden');
        // Hide others
        widthPalette.classList.add('hidden');
    });

    colorCircles.forEach(circle => {
        circle.addEventListener('click', (e) => {
            e.stopPropagation();
            const theme = circle.getAttribute('data-theme');
            applyTheme(theme);

            // Active State UI
            colorCircles.forEach(c => c.classList.remove('active'));
            circle.classList.add('active');
        });
    });

    // Width Control Logic
    const btnWidthToggle = document.getElementById('btn-width-toggle');
    const widthPalette = document.getElementById('width-palette');
    const widthBtns = document.querySelectorAll('.width-btn');

    btnWidthToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        widthPalette.classList.toggle('hidden');
        // Hide others
        colorPalette.classList.add('hidden');
    });

    widthBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const width = btn.getAttribute('data-width');
            const previewArea = document.querySelector('.canvas-container');
            // Note: In index.html, capture-area ID moved to canvas-container or similar? 
            // Let's check capture-area definition. 
            // Previous code used: captureArea.style.width = width + 'px'; (line 238)
            // So we use captureArea.
            if (captureArea) {
                captureArea.style.width = width + 'px';
            }

            // Visual feedback
            widthBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Make sure we close width palette on global click (Line 247 needs update)

    // Global click to deselect & close menus
    document.addEventListener('click', (e) => {
        // Close Settings Menu (and palette)
        if (!e.target.closest('#btn-settings') && !e.target.closest('#settings-menu')) {
            settingsMenu.classList.remove('open');
            colorPalette.classList.add('hidden'); // Also hide palette when closing main menu
            widthPalette.classList.add('hidden');
        }

        if (!e.target.closest('.message-row') && !e.target.closest('.glass-btn') && !e.target.closest('.popover-btn')) {
            if (selectedMessageId !== null) {
                selectedMessageId = null;
                render();
            }
        }
    });

    render();

    // Initialize default theme (Optional, set Ocean as active)
    const defaultThemeCircle = document.querySelector('.color-circle[data-theme="ocean"]');
    if (defaultThemeCircle) defaultThemeCircle.classList.add('active');

    // Initialize Default Width (375px)
    const defaultWidthBtn = document.querySelector('.width-btn[data-width="375"]');
    if (defaultWidthBtn) {
        defaultWidthBtn.click(); // This will set the width and visual active state
        // Re-hide palette if click opened something or just to be safe? 
        // The width btn logic just sets width, doesn't toggle palette visibility.
        // But the parent logic (toggle button) handles palette visibility.
        // We just simulate clicking the "1" button.
    } else {
        // Fallback checks
        if (captureArea) captureArea.style.width = '375px';
    }

    // Status Menu Logic
    initStatusMenu();
}

function initStatusMenu() {
    const headerUsername = document.getElementById('header-username');
    const statusMenu = document.getElementById('status-options-menu');
    const statusItems = document.querySelectorAll('.status-item');

    // Toggle Menu
    headerUsername.addEventListener('click', (e) => {
        e.stopPropagation();
        statusMenu.classList.toggle('hidden');
    });

    // Close menu when clicking outside (handled by global listener already, adding specific check)
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#header-username') && !e.target.closest('#status-options-menu')) {
            statusMenu.classList.add('hidden');
        }
    });

    // Handle Item Selection
    statusItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const type = item.getAttribute('data-type');
            handleStatusSelection(type);
            statusMenu.classList.add('hidden');
        });
    });
}

function handleStatusSelection(type) {
    const headerUsername = document.getElementById('header-username');
    const headerAvatar = document.getElementById('header-avatar');

    let text = '';
    let showDot = false;

    if (type === 'active-now') {
        text = 'Active now';
        showDot = true;
    } else if (type === 'active-m') {
        const n = prompt('몇 분 전인지 숫자를 입력하세요 (예: 5)', '5');
        if (n) text = `Active ${n}m ago`;
        else return; // Cancel
    } else if (type === 'active-h') {
        const n = prompt('몇 시간 전인지 숫자를 입력하세요 (예: 2)', '2');
        if (n) text = `Active ${n}h ago`;
        else return; // Cancel
    } else if (type === 'active-today') {
        text = 'Active Today';
    } else if (type === 'active-yesterday') {
        text = 'Active Yesterday';
    } else if (type === 'typing') {
        text = 'Typing...';
        showDot = true;
    } else if (type === 'custom') {
        const input = prompt('상태 메시지를 입력하세요');
        if (input !== null) text = input; // Allow empty string to clear
        else return;
    }

    // Apply Text
    headerUsername.innerText = text;

    // Apply Green Dot
    if (showDot) {
        headerAvatar.classList.add('online');
    } else {
        headerAvatar.classList.remove('online');
    }
}

function applyTheme(themeName) {
    const root = document.documentElement;
    let gradient = '';

    switch (themeName) {
        case 'ocean': gradient = 'linear-gradient(45deg, #0062ff, #00c6ff)'; break;
        case 'berry': gradient = 'linear-gradient(45deg, #ff7eb3, #ff758c)'; break;
        case 'purple': gradient = 'linear-gradient(45deg, #654ea3, #eaafc8)'; break;
        case 'indigo': gradient = '#485aff'; break; // Solid Blue
        case 'instagram': gradient = 'linear-gradient(135deg, #a740e0 0%, #f04e76 100%)'; break;
        default: gradient = 'linear-gradient(45deg, #0062ff, #00c6ff)';
    }

    root.style.setProperty('--sent-bubble-bg', gradient);
}

function updateDefaultAvatar() {
    const text = headerName.innerText.trim();
    if (text) {
        defaultAvatarUrl = generateAvatar(text);
    } else {
        defaultAvatarUrl = ''; // Or some blank placeholder
    }

    // always apply default avatar since custom input is removed
    headerAvatar.style.backgroundImage = defaultAvatarUrl ? `url('${defaultAvatarUrl}')` : '';

    // Toggle Empty State Class for Camera Icon
    if (!text && !defaultAvatarUrl) {
        headerAvatar.classList.add('empty-state');
    } else {
        headerAvatar.classList.remove('empty-state');
    }

    // Sync to all existing messages
    updateAllLeftAvatars();
}


function updateAllLeftAvatars() {
    if (!defaultAvatarUrl) return;
    let changed = false;
    messages.forEach(msg => {
        if (msg.side === 'left') {
            msg.avatar = defaultAvatarUrl;
            changed = true;
        }
    });
    if (changed) render();
}

function toggleTheme() {
    isDayMode = !isDayMode;
    document.body.classList.toggle('day-mode'); // Apply globally
    const btnThemeToggle = document.getElementById('btn-theme-toggle');

    if (isDayMode) {
        btnThemeToggle.innerHTML = '<i class="far fa-sun"></i>'; // Outline Sun
        // Styles handled by CSS class body.day-mode
    } else {
        btnThemeToggle.innerHTML = '<i class="fas fa-moon"></i>';
        // Styles handled by CSS default
    }
}

// Data Manipulation
function addMessage(type, side = null, content = '...') {
    // Clear Read Receipt when adding new message
    readReceipt = null;

    let avatarUrl = null;
    if (side === 'left') {
        avatarUrl = defaultAvatarUrl; // Use generated avatar
    }

    const newMessage = {
        id: Date.now(),
        type: type,
        side: side,
        content: content,
        avatar: avatarUrl,
        imageUrl: type === 'image' ? null : undefined, // Initialize for image type
        linkData: type === 'link' ? {
            title: '링크 제목',
            domain: 'DOMAIN.COM',
            image: ''
        } : null
    };

    if (type === 'timestamp') {
        const now = new Date();
        const timeString = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
        newMessage.content = `Today ${timeString}`;
    }

    messages.push(newMessage);
    selectedMessageId = newMessage.id;

    render();

    // Auto scroll
    setTimeout(() => {
        const container = document.querySelector('.canvas-container');
        if (container) container.scrollTop = container.scrollHeight;
    }, 50);
}



function deleteMessage(id) {
    // Immediate delete with Undo
    const index = messages.findIndex(m => m.id === id);
    if (index === -1) return;

    // Backup
    deletedMessageBackup = {
        item: messages[index],
        index: index
    };

    // Remove
    messages.splice(index, 1);
    selectedMessageId = null;
    render();

    // Show Toast
    showUndoToast();
}

function showUndoToast() {
    // Remove existing toast if any
    const existingToast = document.getElementById('undo-toast');
    if (existingToast) existingToast.remove();
    if (undoTimeout) clearTimeout(undoTimeout);

    const toast = document.createElement('div');
    toast.id = 'undo-toast';

    // Applying styles directly to ensure visibility
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '50px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#222',
        color: 'white',
        padding: '14px 24px',
        borderRadius: '50px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        zIndex: '9999999',
        minWidth: '280px',
        justifyContent: 'space-between',
        fontSize: '14px',
        border: '1px solid rgba(255,255,255,0.2)',
        fontFamily: "'Inter', sans-serif"
    });

    toast.innerHTML = `
        <span style="font-weight:600;">메시지가 삭제되었습니다.</span>
        <button id="btn-undo" style="background:none; border:none; color:#0095f6; font-weight:700; cursor:pointer; font-size:14px; padding:0;">실행 취소</button>
    `;

    document.body.appendChild(toast);

    // Attach click listener directly
    toast.querySelector('#btn-undo').onclick = undoDelete;

    // Auto dismiss
    undoTimeout = setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        deletedMessageBackup = null;
    }, 4000); // 4 seconds
}

function undoDelete() {
    if (deletedMessageBackup) {
        messages.splice(deletedMessageBackup.index, 0, deletedMessageBackup.item);
        render();

        const toast = document.getElementById('undo-toast');
        if (toast) toast.remove();
        if (undoTimeout) clearTimeout(undoTimeout);
        deletedMessageBackup = null;
    }
}

function moveMessage(index, direction) {
    if (direction === -1 && index > 0) {
        [messages[index], messages[index - 1]] = [messages[index - 1], messages[index]];
    } else if (direction === 1 && index < messages.length - 1) {
        [messages[index], messages[index + 1]] = [messages[index + 1], messages[index]];
    }
    render();
}

function updateContent(id, newContent) {
    const msg = messages.find(m => m.id === id);
    if (msg) msg.content = newContent;
}

function updateLink(id, field, value) {
    const msg = messages.find(m => m.id === id);
    if (msg && msg.linkData) {
        msg.linkData[field] = value;
    }
}

function selectMessage(id) {
    if (selectedMessageId !== id) {
        selectedMessageId = id;
        render();
    }
}

// Render Logic
function render() {
    chatArea.innerHTML = '';

    // Render Messages
    messages.forEach((msg, index) => {
        const prev = messages[index - 1];
        const next = messages[index + 1];

        // Logical checks for grouping
        const isSamePrev = prev && prev.side === msg.side && prev.type === 'text' && msg.type === 'text';
        const isSameNext = next && next.side === msg.side && next.type === 'text' && msg.type === 'text';

        // Debug
        // console.log(`Msg ${index}: Prev=${isSamePrev}, Next=${isSameNext}`);

        const row = document.createElement('div');
        row.className = 'message-row';
        if (msg.side === 'right') {
            row.classList.add('sent-row');
            row.style.justifyContent = 'flex-end';
        }

        if (msg.id === selectedMessageId) {
            row.classList.add('selected');
        }

        row.onclick = (e) => {
            if (selectedMessageId === msg.id && e.target.isContentEditable) {
                e.stopPropagation();
                return;
            }
            e.stopPropagation();
            selectMessage(msg.id);
        };

        // Check if it's the last message and sent by 'right' side
        const isLastMessage = index === messages.length - 1;
        const isRightSide = msg.side === 'right';

        // Popover
        const popover = document.createElement('div');
        popover.className = 'message-options-popover';

        // Add Eye Icon for Last Right Message
        let readReceiptBtn = '';
        if (isLastMessage && isRightSide) {
            readReceiptBtn = `<button class="popover-btn" onclick="openReadReceiptMenu(${msg.id})" title="읽음 표시"><i class="far fa-eye"></i></button>`;
        }

        popover.innerHTML = `
            ${readReceiptBtn}
            <button class="popover-btn" onclick="moveMessage(${index}, -1)" title="위로"><i class="fas fa-arrow-up"></i></button>
            <button class="popover-btn" onclick="moveMessage(${index}, 1)" title="아래로"><i class="fas fa-arrow-down"></i></button>
            <button class="popover-btn delete" onclick="deleteMessage(${msg.id})" title="삭제"><i class="fas fa-trash"></i></button>
        `;
        popover.onclick = (e) => e.stopPropagation();
        row.appendChild(popover);

        // Content
        if (msg.type === 'timestamp') {
            const el = document.createElement('div');
            el.className = 'time-stamp';
            el.contentEditable = true;
            el.textContent = msg.content;
            el.oninput = (e) => updateContent(msg.id, e.target.innerText);

            row.style.justifyContent = 'center';
            row.style.marginBottom = '24px';
            row.appendChild(el);
            chatArea.appendChild(row);
            return;
        }

        if (msg.side === 'left') {
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar-small';
            avatarDiv.style.backgroundImage = `url('${msg.avatar}')`;
            if (isSameNext) avatarDiv.style.visibility = 'hidden';
            row.appendChild(avatarDiv);
        }

        const bubble = document.createElement('div');
        bubble.className = `message ${msg.side === 'left' ? 'received' : 'sent'}`;

        if (msg.type === 'link') {
            bubble.style.padding = '0';
            bubble.style.overflow = 'hidden';
            bubble.style.background = 'none';
            bubble.style.whiteSpace = 'normal';   // Fix vertical alignment
            bubble.style.display = 'flex';        // Fix vertical alignment
            bubble.style.width = 'fit-content';

            bubble.innerHTML = `
             <div class="link-preview">
                <div class="link-image" style="background-image: url('${msg.linkData.image || ''}'); background-color: #333; position:relative; cursor:pointer;" onclick="window.uploadLinkImage(${msg.id})">
                     <div style="position:absolute; inset:0; display:flex; justify-content:center; align-items:center; opacity:0; transition:opacity 0.2s; background:rgba(0,0,0,0.3);" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0">
                        <i class="fas fa-camera" style="font-size:24px; color:white; drop-shadow:0 2px 4px rgba(0,0,0,0.5);"></i>
                    </div>
                </div>
                <div class="link-info">
                    <div class="link-title" contenteditable="true" oninput="updateLink(${msg.id}, 'title', this.innerText)">${msg.linkData.title}</div>
                    <div class="link-domain" contenteditable="true" oninput="updateLink(${msg.id}, 'domain', this.innerText)">${msg.linkData.domain}</div>
                </div>
             </div>
             `;
        } else {
            bubble.contentEditable = true;
            bubble.innerText = msg.content;
            bubble.oninput = (e) => updateContent(msg.id, e.target.innerText);
        }

        if (msg.side === 'left') {
            if (!isSamePrev && isSameNext) bubble.classList.add('group-top');
            else if (isSamePrev && isSameNext) bubble.classList.add('group-middle');
            else if (isSamePrev && !isSameNext) bubble.classList.add('group-end');
        } else {
            if (!isSamePrev && isSameNext) bubble.classList.add('group-top');
            else if (isSamePrev && isSameNext) bubble.classList.add('group-middle');
            else if (isSamePrev && !isSameNext) bubble.classList.add('group-end');
        }

        if (!isSameNext) row.style.marginBottom = '10px';
        else row.style.marginBottom = '2px';

        bubble.style.marginBottom = '0'; /* Reset internal bubble margin */

        row.appendChild(bubble);

        if (readReceipt && readReceipt.messageId === msg.id) {
            // Create a separate row for the receipt to ensure it sits below
            const receiptRow = document.createElement('div');
            receiptRow.className = 'read-receipt-row';
            receiptRow.innerHTML = `<div class="read-receipt-text">${readReceipt.text}</div>`;

            // Append message row first
            chatArea.appendChild(row);
            // Then receipt row
            chatArea.appendChild(receiptRow);
        } else {
            chatArea.appendChild(row);
        }
    });

    renderActionBar();
}

function renderActionBar() {
    // Remove existing action bar if any
    const existingBar = document.querySelector('.floating-action-bar');
    if (existingBar) existingBar.remove();

    // Render Floating Action Bar at the end
    const actionBar = document.createElement('div');
    actionBar.className = 'floating-action-bar';
    actionBar.setAttribute('data-html2canvas-ignore', 'true');

    // Link/Photo Menu HTML (Conditional)
    const linkMenuHtml = isLinkMenuOpen ? `
        <div class="link-side-menu">
            <button class="glass-btn small-btn" id="btn-link-left" title="왼쪽 링크"><i class="fas fa-arrow-left"></i></button>
            <button class="glass-btn small-btn" id="btn-link-right" title="오른쪽 링크"><i class="fas fa-arrow-right"></i></button>
        </div>
    ` : '';

    const photoMenuHtml = isPhotoMenuOpen ? `
        <div class="link-side-menu" style="left: calc(50% + 70px);"> <!-- Offset for photo button (Centered) -->
            <button class="glass-btn small-btn" id="btn-photo-left" title="왼쪽 사진"><i class="fas fa-arrow-left"></i></button>
            <button class="glass-btn small-btn" id="btn-photo-right" title="오른쪽 사진"><i class="fas fa-arrow-right"></i></button>
        </div>
    ` : '';

    actionBar.innerHTML = `
        ${linkMenuHtml}
        ${photoMenuHtml}
        <button class="glass-btn" id="btn-add-left" title="왼쪽 대화 추가"><i class="fas fa-arrow-left"></i></button>
        <button class="glass-btn" id="btn-add-time" title="시간 추가"><i class="far fa-clock"></i></button>
        <button class="glass-btn" id="btn-add-link" title="링크 추가" style="${isLinkMenuOpen ? 'background:rgba(255,255,255,0.3)' : ''}"><i class="fas fa-link"></i></button>
        <button class="glass-btn" id="btn-add-photo" title="사진 추가" style="${isPhotoMenuOpen ? 'background:rgba(255,255,255,0.3)' : ''}"><i class="far fa-image"></i></button>
        <button class="glass-btn" id="btn-add-right" title="오른쪽 대화 추가"><i class="fas fa-arrow-right"></i></button>
    `;
    chatArea.appendChild(actionBar);

    // Attach listeners
    actionBar.querySelector('#btn-add-left').addEventListener('click', () => {
        isLinkMenuOpen = false; isPhotoMenuOpen = false;
        addMessage('text', 'left');
    });
    actionBar.querySelector('#btn-add-time').addEventListener('click', () => {
        isLinkMenuOpen = false; isPhotoMenuOpen = false;
        addMessage('timestamp');
    });
    actionBar.querySelector('#btn-add-right').addEventListener('click', () => {
        isLinkMenuOpen = false; isPhotoMenuOpen = false;
        addMessage('text', 'right');
    });

    // Link Button Toggle
    actionBar.querySelector('#btn-add-link').addEventListener('click', (e) => {
        e.stopPropagation();
        isLinkMenuOpen = !isLinkMenuOpen;
        isPhotoMenuOpen = false; // Close other
        renderActionBar(); // Only re-render action bar
    });

    // Photo Button Toggle
    actionBar.querySelector('#btn-add-photo').addEventListener('click', (e) => {
        e.stopPropagation();
        isPhotoMenuOpen = !isPhotoMenuOpen;
        isLinkMenuOpen = false; // Close other
        renderActionBar(); // Only re-render action bar
    });

    // Sub-buttons listeners (if open)
    if (isLinkMenuOpen) {
        actionBar.querySelector('#btn-link-left').addEventListener('click', (e) => {
            e.stopPropagation();
            addMessage('link', 'left');
            isLinkMenuOpen = false;
        });
        actionBar.querySelector('#btn-link-right').addEventListener('click', (e) => {
            e.stopPropagation();
            addMessage('link', 'right');
            isLinkMenuOpen = false;
        });
    }

    if (isPhotoMenuOpen) {
        actionBar.querySelector('#btn-photo-left').addEventListener('click', (e) => {
            e.stopPropagation();
            addMessage('image', 'left');
            isPhotoMenuOpen = false;
        });
        actionBar.querySelector('#btn-photo-right').addEventListener('click', (e) => {
            e.stopPropagation();
            addMessage('image', 'right');
            isPhotoMenuOpen = false;
        });
    }
}

window.moveMessage = moveMessage;
window.deleteMessage = deleteMessage;
window.updateLink = updateLink;
window.render = render;
window.undoDelete = undoDelete;

window.openReadReceiptMenu = function (id) {
    const existingMenu = document.getElementById('rr-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'rr-menu';
    menu.className = 'status-menu'; // Re-use styling
    menu.style.position = 'fixed';
    menu.style.top = '50%';
    menu.style.left = '50%';
    menu.style.transform = 'translate(-50%, -50%)';

    menu.innerHTML = `
        <div class="status-item" onclick="setReadReceipt(${id}, 'seen')">Seen</div>
        <div class="status-item" onclick="setReadReceipt(${id}, 'seen-m')">Seen N m ago</div>
        <div class="status-item" onclick="setReadReceipt(${id}, 'seen-h')">Seen N h ago</div>
        <div class="status-item" onclick="setReadReceipt(${id}, 'delivered')">Delivered</div>
        <div class="status-item" onclick="this.parentElement.remove()" style="color:#aaa; justify-content:center;">Cancel</div>
    `;

    document.body.appendChild(menu);
}

window.setReadReceipt = function (id, type) { // Global wrapper
    const text = getReadReceiptText(type);
    if (text) {
        readReceipt = { messageId: id, text: text };
        render();
    }
    const menu = document.getElementById('rr-menu');
    if (menu) menu.remove();
}

function getReadReceiptText(type) {
    if (type === 'seen') return 'Seen';
    if (type === 'delivered') return 'Delivered';
    if (type === 'seen-m') {
        const n = prompt('몇 분 전?', '5');
        return n ? `Seen ${n}m ago` : null;
    }
    if (type === 'seen-h') {
        const n = prompt('몇 시간 전?', '1');
        return n ? `Seen ${n}h ago` : null;
    }
    return null;
}

init();
