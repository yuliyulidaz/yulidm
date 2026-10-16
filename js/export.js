(function () {
    const button = document.getElementById('btn-export');
    let exporting = false;

    button.addEventListener('click', async () => {
        if (exporting) return;
        exporting = true;
        const editor = document.querySelector('.app-container');
        const wasInert = editor.inert;
        editor.inert = true; // Keep the conversation stable between rendering tiles.
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        const originalContent = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            await document.fonts.ready;
            const element = document.getElementById('capture-area');
            await Promise.all([...element.querySelectorAll('img')].map(image => image.decode()));
            const style = getComputedStyle(element);
            const width = element.clientWidth;
            // Capture conversation + original padding, without the editor action bar.
            const actionBar = element.querySelector('.floating-action-bar');
            const barStyle = getComputedStyle(actionBar);
            const editorHeight = actionBar.getBoundingClientRect().height +
                parseFloat(barStyle.marginTop) + parseFloat(barStyle.marginBottom);
            const height = Math.ceil(document.getElementById('chat-root').getBoundingClientRect().height -
                editorHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
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
                        const clone = document.getElementById('capture-area');
                        Object.assign(clone.style, {
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
            link.download = `chat-export-${Date.now()}.png`;
            link.href = url;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (error) {
            console.error('Export failed:', error);
            alert('이미지 저장 실패: ' + error.message);
        } finally {
            exporting = false;
            editor.inert = wasInert;
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.title = '이미지 저장';
            button.innerHTML = originalContent;
        }
    });
})();
