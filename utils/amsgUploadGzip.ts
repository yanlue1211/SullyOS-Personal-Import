// WebKit can resolve a gzip stream before it has emitted the complete trailer.
const crcTable = Uint32Array.from({ length: 256 }, (_, initial) => {
  let crc = initial;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

function validGzip(bytes: Uint8Array, input: Uint8Array): boolean {
  if (bytes.byteLength < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) return false;
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.byteLength - 8, 8);
  if (trailer.getUint32(4, true) !== input.byteLength >>> 0) return false;
  let crc = 0xffffffff;
  for (const byte of input) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return trailer.getUint32(0, true) === ((crc ^ 0xffffffff) >>> 0);
}

export async function gzipAmsgUpload(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'function') {
    try {
      const stream = new CompressionStream('gzip');
      const writer = stream.writable.getWriter();
      const read = new Response(stream.readable).arrayBuffer();
      const write = writer.write(input as BufferSource).then(() => writer.close());
      const [buffer] = await Promise.all([read, write]);
      const compressed = new Uint8Array(buffer);
      if (validGzip(compressed, input)) return compressed;
    } catch {
      // Fall back to the JS codec if native compression threw or emitted a bad stream.
    }
  }

  const { gzipSync } = await import('fflate');
  return gzipSync(input);
}
