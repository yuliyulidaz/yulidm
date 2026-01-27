(function () {
    const btnExport = document.getElementById('btn-export');

    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            console.log("Export started...");
            const element = document.getElementById('capture-area');

            if (!element) {
                alert("Error: Capture area not found!");
                return;
            }

            if (typeof html2canvas === 'undefined') {
                alert("Error: html2canvas library is not loaded!");
                return;
            }

            // Visual feedback
            const originalContent = btnExport.innerHTML;
            btnExport.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            btnExport.style.pointerEvents = 'none';

            try {
                // Slight delay to allow UI to update
                await new Promise(resolve => setTimeout(resolve, 100));

                const canvas = await html2canvas(element, {
                    scale: 2,
                    backgroundColor: null,
                    useCORS: true,
                    logging: true, // Enable logging to see html2canvas errors in console
                    allowTaint: true, // Try allowing taint
                    ignoreElements: (element) => {
                        return element.classList.contains('floating-save-btn') ||
                            element.classList.contains('floating-action-bar');
                    }
                });

                console.log("Canvas created, generating URL...");
                const link = document.createElement('a');
                link.download = `chat-export-${Date.now()}.png`;
                link.href = canvas.toDataURL("image/png");
                document.body.appendChild(link); // Append to body for Firefox support
                link.click();
                document.body.removeChild(link);

            } catch (err) {
                console.error("Export failed:", err);
                alert("이미지 저장 실패: " + err.message);
            } finally {
                btnExport.innerHTML = originalContent;
                btnExport.style.pointerEvents = 'auto';
            }
        });
    } else {
        console.error("Export button not found during initialization");
    }
})();
