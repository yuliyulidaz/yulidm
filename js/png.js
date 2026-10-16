/* Encode PNG scanlines incrementally so a long conversation never needs one
 * browser canvas taller than the platform canvas limit. fflate supplies zlib. */
(function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    function chunk(type, data) {
        const bytes = new Uint8Array(data.length + 12);
        const view = new DataView(bytes.buffer);
        view.setUint32(0, data.length);
        bytes.set(new TextEncoder().encode(type), 4);
        bytes.set(data, 8);
        let crc = 0xffffffff;
        for (let i = 4; i < bytes.length - 4; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
        view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
        return bytes;
    }
    window.ConversationPNG = class {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.rows = 0;
            const header = new Uint8Array(13);
            const view = new DataView(header.buffer);
            view.setUint32(0, width);
            view.setUint32(4, height);
            header[8] = 8; // 8 bits per channel
            header[9] = 6; // RGBA
            this.parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header)];
            this.encoder = new fflate.Zlib({ level: 6 }, data => {
                if (data.length) this.parts.push(chunk('IDAT', data));
            });
        }
        append(canvas) {
            if (canvas.width !== this.width || this.rows + canvas.height > this.height) {
                throw new Error('PNG tile dimensions do not match');
            }
            const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            const stride = this.width * 4;
            // Sub filter compresses flat backgrounds and text well without retaining earlier tiles.
            const row = new Uint8Array(stride + 1);
            row[0] = 1;
            for (let y = 0; y < canvas.height; y++) {
                const offset = y * stride;
                for (let x = 0; x < stride; x++) {
                    row[x + 1] = (rgba[offset + x] - (x >= 4 ? rgba[offset + x - 4] : 0)) & 255;
                }
                this.rows++;
                this.encoder.push(row, this.rows === this.height);
            }
        }
        finish() {
            if (this.rows !== this.height) throw new Error('PNG is incomplete');
            return new Blob([...this.parts, chunk('IEND', new Uint8Array())], { type: 'image/png' });
        }
    };
})();
