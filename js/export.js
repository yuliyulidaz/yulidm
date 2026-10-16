(function () {
    const button = document.getElementById('btn-export');
    const menu = document.getElementById('download-menu');
    const toolbar = document.getElementById('export-selection-toolbar');
    const saveSelection = document.getElementById('export-selection-save');
    const picked = new Set();
    let selecting = false;
    let exporting = false;

    function closeMenu() {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }
    function updateSelection() {
        document.getElementById('export-selection-count').textContent = picked.size ?
            `${picked.size}개 대화 선택됨` : '저장할 대화를 선택하세요';
        saveSelection.textContent = `선택 저장 (${picked.size})`;
        saveSelection.disabled = picked.size === 0;
    }
    function endSelection() {
        selecting = false;
        document.body.classList.remove('export-selecting');
        toolbar.hidden = true;
        document.querySelectorAll('.message-row').forEach(row => {
            row.classList.remove('export-picked');
            row.removeAttribute('role');
            row.removeAttribute('aria-checked');
            row.removeAttribute('tabindex');
        });
        document.querySelectorAll('[data-export-editable]').forEach(e => {
            e.setAttribute('contenteditable', e.dataset.exportEditable);
            delete e.dataset.exportEditable;
        });
        picked.clear();
    }
    button.addEventListener('click', () => {
        if (exporting) return;
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) document.getElementById('download-all').focus();
    });
    document.addEventListener('click', event => {
        if (!event.target.closest('#download-menu, #btn-export')) closeMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !exporting) {
            closeMenu();
            endSelection();
            button.focus();
        }
    });
    function selectRow(event) {
        if (!selecting || exporting) return;
        if (event.type === 'keydown' && ![' ', 'Enter'].includes(event.key)) return;
        const row = event.target.closest('#capture-area .message-row');
        if (!row) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const id = row.dataset.messageId;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        row.classList.toggle('export-picked', picked.has(id));
        row.setAttribute('aria-checked', String(picked.has(id)));
        row.focus({ preventScroll: true });
        updateSelection();
    }
    document.addEventListener('click', selectRow, true);
    document.addEventListener('keydown', selectRow, true);
    document.getElementById('download-selection').addEventListener('click', () => {
        closeMenu();
        if (selecting) return;
        selecting = true;
        document.body.classList.add('export-selecting');
        document.getElementById('settings-menu').classList.remove('open');
        document.querySelectorAll('#capture-area [contenteditable]').forEach(e => {
            e.dataset.exportEditable = e.getAttribute('contenteditable');
            e.contentEditable = 'false';
        });
        document.querySelectorAll('#capture-area .message-row').forEach(row => {
            row.setAttribute('role', 'checkbox');
            row.setAttribute('aria-checked', 'false');
            row.tabIndex = 0;
        });
        toolbar.hidden = false;
        updateSelection();
    });
    document.getElementById('export-selection-cancel').addEventListener('click', () => {
        endSelection();
        button.focus();
    });
    document.getElementById('download-all').addEventListener('click', () => {
        closeMenu();
        endSelection();
        exportConversation();
    });
    saveSelection.addEventListener('click', () => {
        if (picked.size) exportConversation(new Set(picked));
    });

    async function exportConversation(selection = null) {
        if (exporting) return;
        exporting = true;
        const editor = document.querySelector('.app-container');
        const wasInert = editor.inert;
        editor.inert = true; // Keep the conversation stable between rendering tiles.
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const originalContent = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        let snapshot;
        try {
            await document.fonts.ready;
            const source = document.getElementById('capture-area');
            await Promise.all([...source.querySelectorAll('img')].map(image => image.decode()));
            const width = source.clientWidth;
            snapshot = source.cloneNode(true);
            snapshot.id = 'export-capture';
            // Measure only the saved rows in an isolated full-height snapshot.
            // The live editor keeps its scroll position and editable state.
            Object.assign(snapshot.style, {
                position: 'absolute', left: '-100000px', top: '0',
                width: `${width}px`, minWidth: '0', boxSizing: 'border-box',
                height: 'auto', maxHeight: 'none', overflow: 'visible', transition: 'none'
            });
            snapshot.querySelectorAll('.floating-action-bar, .message-options-popover').forEach(e => e.remove());
            snapshot.querySelectorAll('[data-message-id]').forEach(row => {
                if (selection && !selection.has(row.dataset.messageId)) row.remove();
                row.classList.remove('export-picked', 'selected');
                row.removeAttribute('role');
                row.removeAttribute('aria-checked');
                row.removeAttribute('tabindex');
            });
            // Reconnect bubble corners for the saved sequence, including nonadjacent picks.
            const rows = [...snapshot.querySelectorAll('.message-row')];
            rows.forEach((row, i) => {
                const bubble = row.querySelector('.message');
                if (!bubble) return;
                const sameTextSide = other => other && bubble.hasAttribute('contenteditable') &&
                    other.querySelector('.message[contenteditable]') &&
                    other.classList.contains('sent-row') === row.classList.contains('sent-row');
                const prev = sameTextSide(rows[i - 1]), next = sameTextSide(rows[i + 1]);
                bubble.classList.remove('group-top', 'group-middle', 'group-end');
                if (prev || next) bubble.classList.add(prev ? (next ? 'group-middle' : 'group-end') : 'group-top');
                row.style.marginBottom = next ? '2px' : '10px';
                const avatar = row.querySelector('.avatar-small');
                if (avatar) avatar.style.visibility = next ? 'hidden' : 'visible';
            });
            snapshot.querySelectorAll('[contenteditable]').forEach(e => e.removeAttribute('contenteditable'));
            document.body.appendChild(snapshot);
            const element = snapshot;
            const height = Math.ceil(element.getBoundingClientRect().height);
            const scale = 2;
            const png = new ConversationPNG(width * scale, height * scale);
            // Small canvases bound peak pixel memory, including for PNGs over 32767px tall.
            const tileHeight = 2048;
            for (let y = 0; y < height; y += tileHeight) {
                const canvas = await html2canvas(element, {
                    scale,
                    width,
                    height: Math.min(tileHeight, height - y),
                    y,
                    scrollX: 0,
                    scrollY: 0,
                    backgroundColor: null,
                    useCORS: true,
                    allowTaint: false,
                    logging: false,
                    onclone(document) {
                        document.body.classList.remove('export-selecting');
                        const clone = document.getElementById('export-capture');
                        Object.assign(clone.style, {
                            position: 'absolute',
                            left: '0',
                            top: '0',
                            width: `${width}px`,
                            minWidth: '0',
                            boxSizing: 'border-box',
                            height: 'auto',
                            maxHeight: 'none',
                            overflow: 'visible',
                            transition: 'none'
                        });
                        clone.scrollTop = 0;
                        clone.scrollLeft = 0;
                        document.querySelectorAll('.floating-action-bar, .message-options-popover').forEach(e => e.remove());
                        document.querySelectorAll('[contenteditable]').forEach(e => e.blur());
                    },
                    ignoreElements: e => e.classList.contains('floating-action-bar') ||
                        e.classList.contains('message-options-popover') ||
                        e.classList.contains('floating-save-btn')
                });
                png.append(canvas);
                canvas.width = canvas.height = 0;
                // Give the browser a chance to paint progress between tiles.
                button.title = `이미지 저장 중 ${Math.min(100, Math.round((y + tileHeight) / height * 100))}%`;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            const url = URL.createObjectURL(png.finish());
            const link = document.createElement('a');
            link.download = `chat-${selection ? 'selection' : 'export'}-${Date.now()}.png`;
            link.href = url;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            if (selection) endSelection();
        } catch (error) {
            console.error('Export failed:', error);
            alert('이미지 저장 실패: ' + error.message);
        } finally {
            if (snapshot) snapshot.remove();
            exporting = false;
            editor.inert = wasInert;
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.title = '이미지 저장';
            button.innerHTML = originalContent;
        }
    }
})();
