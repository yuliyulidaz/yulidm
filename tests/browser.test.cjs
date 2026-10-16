const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const fs = require('node:fs/promises');
const path = require('node:path');

function fixture(width = 800, height = 400, solid = false) {
    const png = new PNG({ width, height });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const color = solid ? [255, 0, 255] : x < 200 ? [255, 0, 0] : x < 600 ? [0, 255, 0] : [0, 0, 255];
        png.data.set([...color, 255], i);
    }
    return PNG.sync.write(png);
}

function avatarFixture() {
    const png = new PNG({ width: 300, height: 300 });
    for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) {
        const i = (y * 300 + x) * 4;
        const value = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 ? 255 : 0;
        png.data.set([value, 128, 255 - value, 255], i);
    }
    return PNG.sync.write(png);
}

// The app must make no Internet requests, even with all nonlocal traffic blocked.
test('offline photo crops, existing controls, and complete high-resolution long PNG', { timeout: 180000 }, async () => {
    const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], {
        cwd: path.resolve(__dirname, '..'), stdio: 'ignore'
    });
    let browser;
    try {
        for (let n = 0; ; n++) {
            try { const r = await fetch('http://127.0.0.1:8765'); if (r.ok) break; } catch {}
            if (n > 50) throw Error('Test server did not start');
            await new Promise(r => setTimeout(r, 50));
        }
        browser = await chromium.launch({
            ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
            args: ['--no-sandbox']
        });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
        const errors = [], external = [], badResponses = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
        page.on('response', r => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });
        await page.route('**/*', route => {
            const url = route.request().url();
            if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:8765/')) {
                external.push(url); return route.abort();
            }
            return route.continue();
        });
        await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('.message-row').count(), 1);
        assert.equal(await page.locator('#btn-theme-toggle i').getAttribute('class'), 'far fa-sun');
        assert.deepEqual(await page.evaluate(() => [typeof html2canvas, typeof Cropper, typeof fflate]), ['function', 'function', 'object']);
        await page.locator('#btn-add-right').click();
        await page.locator('.sent[contenteditable]').fill('기존 말풍선 편집');
        await page.locator('#btn-add-time').click();
        assert.equal(await page.locator('.time-stamp').count(), 1);
        await page.locator('#btn-add-link').click();
        await page.locator('#btn-link-left').click();
        assert.equal(await page.locator('.link-preview').count(), 1);
        await page.locator('.link-title').fill('링크 제목 유지');
        // Actual file chooser and crop UI; the green central rectangle is a measurable crop.
        await page.locator('#btn-add-photo').click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('#btn-photo-right').click();
        await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: fixture() });
        await page.waitForFunction(() => currentCropper && !document.getElementById('btn-crop-confirm').disabled);
        const handle = page.locator('.cropper-point.point-se');
        const bounds = await handle.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down(); await page.mouse.move(bounds.x - 80, bounds.y - 40, { steps: 5 }); await page.mouse.up();
        await page.evaluate(() => currentCropper.setData({ x: 200, y: 100, width: 400, height: 200, rotate: 0, scaleX: 1, scaleY: 1 }));
        await page.locator('#btn-crop-confirm').click();
        const photo = page.locator('.sent.image-message img');
        await photo.evaluate(image => image.decode());
        const cropped = PNG.sync.read(Buffer.from((await photo.getAttribute('src')).split(',')[1], 'base64'));
        assert.equal(cropped.width, 400); assert.equal(cropped.height, 200);
        assert.deepEqual([...cropped.data.subarray(0, 4)], [0, 255, 0, 255]);
        assert.ok((await photo.boundingBox()).width > 100);
        assert.equal(await page.locator('.photo-placeholder').count(), 0);
        assert.equal(await page.locator('#btn-photo-right').count(), 0);
        // Cancel a replacement without losing the earlier crop, then reselect the same file.
        const before = await photo.getAttribute('src');
        const replacement = page.waitForEvent('filechooser'); await photo.click();
        await (await replacement).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: fixture() });
        await page.waitForFunction(() => currentCropper && !document.getElementById('btn-crop-confirm').disabled);
        await page.locator('#btn-crop-cancel').click();
        assert.equal(await photo.getAttribute('src'), before);
        // The avatar and link crop workflows still use their constrained ratios.
        for (const selector of ['#header-avatar', '.link-image']) {
            const file = page.waitForEvent('filechooser'); await page.locator(selector).click();
            await (await file).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: selector === '#header-avatar' ? avatarFixture() : fixture() });
            await page.waitForFunction(() => currentCropper && !document.getElementById('btn-crop-confirm').disabled);
            await page.locator('#btn-crop-confirm').click();
        }
        assert.match(await page.locator('#header-avatar').getAttribute('style'), /data:image\/png/);
        assert.match(await page.locator('.link-image').getAttribute('style'), /data:image\/png/);
        // Delete/undo/reorder retain the photo and unique message IDs.
        await page.evaluate(() => { deleteMessage(messages[1].id); undoDelete(); moveMessage(1, 1); });
        assert.ok((await page.locator('#chat-area').innerText()).includes('기존 말풍선 편집'));
        await page.locator('#btn-settings').click(); await page.locator('#btn-theme-toggle').click();
        assert.equal(await page.locator('body').evaluate(e => e.classList.contains('day-mode')), true);
        assert.equal(await page.locator('#btn-theme-toggle i').getAttribute('class'), 'fas fa-moon');
        assert.equal(await page.locator('#btn-theme-toggle').getAttribute('aria-label'), '다크 모드로 전환');
        await page.locator('#btn-width-toggle').click(); await page.locator('[data-width="520"]').click();
        await page.waitForTimeout(350); // Complete the existing width transition before measuring export.

        // Short export: both dark and light backgrounds, preserved photo pixels, editor UI excluded.
        async function download(name) {
            const event = page.waitForEvent('download', { timeout: 120000 });
            await page.locator('#btn-export').click();
            await page.locator('#download-all').click();
            const item = await event;
            await fs.mkdir('test-results', { recursive: true });
            const target = path.resolve('test-results', name);
            await item.saveAs(target);
            await page.waitForFunction(() => !document.getElementById('btn-export').disabled);
            return PNG.sync.read(await fs.readFile(target));
        }
        const light = await download('light.png');
        assert.deepEqual([...light.data.subarray((20 * light.width + 20) * 4, (20 * light.width + 20) * 4 + 4)], [255, 255, 255, 255]);
        await page.locator('#btn-settings').click(); await page.locator('#btn-theme-toggle').click();
        assert.equal(await page.locator('#btn-theme-toggle i').getAttribute('class'), 'far fa-sun');
        const iconReferences = await page.evaluate(async () => {
            const capture = document.getElementById('capture-area');
            const root = capture.getBoundingClientRect();
            return Promise.all([...capture.querySelectorAll('.header-right svg')].map(async svg => {
                const bounds = svg.getBoundingClientRect();
                const vector = svg.cloneNode(true);
                vector.setAttribute('width', '48'); vector.setAttribute('height', '48');
                vector.style.color = getComputedStyle(svg).color;
                const image = new Image();
                image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(vector));
                await image.decode();
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
                const context = canvas.getContext('2d');
                context.fillStyle = '#121212'; context.fillRect(0, 0, 48, 48); context.drawImage(image, 0, 0);
                return { x: Math.round((bounds.left - root.left + capture.scrollLeft) * 2),
                    y: Math.round((bounds.top - root.top + capture.scrollTop) * 2), data: canvas.toDataURL() };
            }));
        });
        const avatarReferences = await page.evaluate(async () => {
            const capture = document.getElementById('capture-area');
            const root = capture.getBoundingClientRect();
            return Promise.all([...capture.querySelectorAll('#header-avatar, .avatar-small')].filter(e => getComputedStyle(e).visibility !== 'hidden').map(async avatar => {
                const bounds = avatar.getBoundingClientRect();
                const image = new Image();
                image.src = getComputedStyle(avatar).backgroundImage.slice(4, -1).replace(/^['"]|['"]$/g, '');
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = bounds.width * 2; canvas.height = bounds.height * 2;
                const x = (bounds.left - root.left + capture.scrollLeft) * 2;
                const y = (bounds.top - root.top + capture.scrollTop) * 2;
                canvas.getContext('2d').drawImage(image, x - Math.round(x), y - Math.round(y), canvas.width, canvas.height);
                return { x: Math.round((bounds.left - root.left + capture.scrollLeft) * 2),
                    y: Math.round((bounds.top - root.top + capture.scrollTop) * 2), data: canvas.toDataURL() };
            }));
        });
        const dark = await download('dark.png');
        for (const avatar of avatarReferences) {
            const reference = PNG.sync.read(Buffer.from(avatar.data.split(',')[1], 'base64'));
            let difference = 0, count = 0;
            // Compare inside the circle, leaving antialiased boundary pixels out.
            for (let y = 0; y < reference.height; y++) for (let x = 0; x < reference.width; x++) {
                if (Math.hypot(x - reference.width / 2, y - reference.height / 2) > reference.width / 2 - 8) continue;
                for (let c = 0; c < 3; c++) {
                    difference += Math.abs(reference.data[(y * reference.width + x) * 4 + c] - dark.data[((avatar.y + y) * dark.width + avatar.x + x) * 4 + c]); count++;
                }
            }
            console.log(`Avatar export pixel difference: ${(difference / count).toFixed(3)}`);
            assert.ok(difference / count < 1, 'Avatar must be sampled directly at the output resolution');
        }
        for (const icon of iconReferences) {
            const reference = PNG.sync.read(Buffer.from(icon.data.split(',')[1], 'base64'));
            let difference = 0;
            for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
                for (let c = 0; c < 3; c++) difference += Math.abs(reference.data[(y * 48 + x) * 4 + c] - dark.data[((icon.y + y) * dark.width + icon.x + x) * 4 + c]);
            }
            const mean = difference / (48 * 48 * 3);
            console.log(`SVG export pixel difference: ${mean.toFixed(3)}`);
            assert.ok(mean < 1, 'Exported icon must match a vector rendered directly at 48px');
        }
        assert.deepEqual([...dark.data.subarray((20 * dark.width + 20) * 4, (20 * dark.width + 20) * 4 + 4)], [18, 18, 18, 255]);

        const marker = 'data:image/png;base64,' + fixture(200, 100, true).toString('base64');
        await page.evaluate(marker => {
            for (let i = 0; i < 200; i++) messages.push({ id: nextMessageId++, type: 'text', side: i % 2 ? 'left' : 'right', content: `대화 ${i}\n전체 대화 저장 확인\n세 번째 줄\n네 번째 줄`, avatar: defaultAvatarUrl });
            messages.push({ id: nextMessageId++, type: 'image', side: 'left', imageUrl: marker, avatar: defaultAvatarUrl });
            selectedMessageId = messages[messages.length - 1].id;
            render();
        }, marker);
        await page.locator('.image-message img').last().evaluate(image => image.decode());
        const dimensions = await page.evaluate(() => {
            const e = document.getElementById('capture-area'); e.scrollTop = e.scrollHeight;
            const s = getComputedStyle(e);
            const bar = e.querySelector('.floating-action-bar');
            const bs = getComputedStyle(bar);
            const editorHeight = bar.getBoundingClientRect().height + parseFloat(bs.marginTop) + parseFloat(bs.marginBottom);
            return { width: e.clientWidth * 2, height: Math.ceil(document.getElementById('chat-root').getBoundingClientRect().height - editorHeight + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom)) * 2, scroll: e.scrollTop, maxHeight: s.maxHeight };
        });
        assert.ok(dimensions.height > 32767, `Must exercise the tall-canvas boundary: ${dimensions.height}`);
        const long = await download('long-conversation.png');
        assert.equal(long.width, dimensions.width); assert.equal(long.height, dimensions.height);
        let markerPixels = 0;
        for (let y = long.height - 400; y < long.height; y++) for (let x = 0; x < long.width; x++) {
            const i = (y * long.width + x) * 4;
            if (long.data[i] === 255 && long.data[i + 1] === 0 && long.data[i + 2] === 255 && long.data[i + 3] === 255) markerPixels++;
        }
        assert.ok(markerPixels > 10000, `Final photo must be visible at the bottom: ${markerPixels}`);
        // Every tile boundary has opaque conversation pixels; no transparent seams.
        for (let y = 4096; y < long.height; y += 4096) {
            assert.equal(long.data[(y * long.width + 20) * 4 + 3], 255);
        }
        assert.deepEqual(await page.evaluate(() => {
            const e = document.getElementById('capture-area'); return { scroll: e.scrollTop, maxHeight: getComputedStyle(e).maxHeight };
        }), { scroll: dimensions.scroll, maxHeight: dimensions.maxHeight });
        assert.equal(await page.evaluate(() => new Set(messages.map(m => m.id)).size === messages.length), true);
        // Narrow screens retain the chosen chat width and expose both ends via horizontal scroll.
        await page.setViewportSize({ width: 375, height: 800 });
        const horizontal = await page.locator('.app-container').evaluate(e => {
            e.scrollLeft = 0;
            return { client: e.clientWidth, scroll: e.scrollWidth };
        });
        assert.ok(horizontal.scroll > horizontal.client);
        assert.ok((await page.locator('#btn-settings').boundingBox()).x >= 0);
        await page.locator('.app-container').evaluate(e => { e.scrollLeft = e.scrollWidth; });
        const rightButton = await page.locator('#btn-export').boundingBox();
        assert.ok(rightButton.x >= 0 && rightButton.x + rightButton.width <= 375);
        assert.equal(await page.locator('#capture-area').evaluate(e => e.clientWidth * 2), dimensions.width);

        // Selection is explicit, reversible, keyboard accessible, and does not edit messages.
        await page.locator('#btn-export').click();
        await page.locator('#download-selection').click();
        assert.equal(await page.locator('#export-selection-save').isDisabled(), true);
        await page.locator('.message-row').first().click();
        await page.locator('.message-row').first().press('Space');
        assert.equal(await page.locator('#export-selection-save').isDisabled(), true);
        await page.locator('#export-selection-cancel').click();
        assert.equal(await page.locator('.export-picked').count(), 0);
        assert.equal(await page.locator('.sent[contenteditable="true"]').count() > 0, true);
        await page.locator('#btn-export').click();
        await page.locator('#download-selection').click();
        await page.locator('.message-row').first().click();
        const photoRow = page.locator('.message-row').filter({ has: page.locator('.sent.image-message') }).first();
        await photoRow.click();
        assert.equal(await page.locator('.export-picked').count(), 2);
        assert.equal(await page.locator('#export-selection-save').innerText(), '선택 저장 (2)');
        const originalRows = await page.locator('#capture-area .message-row').count();
        const selectionDownload = page.waitForEvent('download');
        await page.locator('#export-selection-save').click();
        const selectedFile = await selectionDownload;
        assert.match(selectedFile.suggestedFilename(), /^chat-selection-/);
        await selectedFile.saveAs('test-results/selection.png');
        await page.waitForFunction(() => !document.getElementById('btn-export').disabled);
        const selectedImage = PNG.sync.read(await fs.readFile('test-results/selection.png'));
        assert.equal(selectedImage.width, dimensions.width);
        assert.ok(selectedImage.height < 1500 && selectedImage.height > 300);
        let green = 0, magenta = 0, selectionBlue = 0;
        for (let i = 0; i < selectedImage.data.length; i += 4) {
            const [r, g, b] = selectedImage.data.subarray(i, i + 3);
            if (r === 0 && g === 255 && b === 0) green++;
            if (r === 255 && g === 0 && b === 255) magenta++;
            if (r === 0 && g === 149 && b === 246) selectionBlue++;
        }
        assert.ok(green > 10000, 'Selected cropped photo must be saved');
        assert.equal(magenta, 0, 'Unselected final photo must not be saved');
        assert.equal(selectionBlue, 0, 'Selection outline must not be saved');
        assert.equal(await page.locator('#capture-area .message-row').count(), originalRows);
        assert.equal(await page.locator('#export-selection-toolbar').isHidden(), true);
        assert.equal(await page.locator('[data-export-editable]').count(), 0);
        assert.equal(await page.locator('#export-capture').count(), 0);
        await page.screenshot({ path: 'test-results/editor.png' });
        assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(badResponses, []);
        console.log(`Verified offline PNG ${long.width}×${long.height}, bottom marker ${markerPixels} pixels.`);
    } finally {
        if (browser) await browser.close();
        server.kill();
        if (server.exitCode === null) await once(server, 'exit');
    }
});
