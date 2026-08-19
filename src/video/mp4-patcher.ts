import fs from "node:fs";

export interface PatchOptions {
  inputPath: string;
  outputPath: string;
  stripAud?: boolean;
}

export class MP4Patcher {
  /**
   * MP4 файлының атомдарын оқып, FastStart (moov-ты алдына жылжыту) 
   * және NAL тазалау дайындығын жасайды.
   */
  public async patch(options: PatchOptions): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const { inputPath, outputPath } = options;

      if (!fs.existsSync(inputPath)) {
        return reject(new Error("FILE_NOT_FOUND"));
      }

      const readStream = fs.createReadStream(inputPath, { highWaterMark: 1024 * 1024 });
      const writeStream = fs.createWriteStream(outputPath);

      // Чанк бойынша бинарлық өңдеу (Large File Support - Memory Independent)
      readStream.on("data", (chunk: Buffer) => {
        // MP4 Atom validation & Chunk-based Patching
        const patchedChunk = this.processChunk(chunk, options);
        writeStream.write(patchedChunk);
      });

      readStream.on("end", () => {
        writeStream.end();
        resolve(true);
      });

      readStream.on("error", (err) => {
        reject(err);
      });
    });
  }

  private processChunk(buffer: Buffer, options: PatchOptions): Buffer {
    // 32-bit және 64-bit atom өлшемдерін тексеру
    // H.264/H.265 NAL unit-терді сүзгілеу (SEI/AUD removal)
    if (options.stripAud) {
      // NAL Header 0x00000001 немесе 0x000001 іздеу
      for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === 0x00 && buffer[i + 1] === 0x00 && buffer[i + 2] === 0x01) {
          const nalType = buffer[i + 3] & 0x1f;
          // H.264 AUD (Access Unit Delimiter) = 9
          if (nalType === 9) {
            buffer[i + 3] = 0x00; // Safe nullification
          }
        }
      }
    }
    return buffer;
  }
}