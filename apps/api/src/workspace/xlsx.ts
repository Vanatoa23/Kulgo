import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Minimal, zero-dependency OOXML (.xlsx) reader & writer for Kulgo supplier
 * onboarding and product catalogue spreadsheets.
 *
 * Supports reading single-sheet or first-sheet standard .xlsx files (both
 * sharedStrings.xml and inlineStr cells) and writing valid .xlsx files that
 * open cleanly in Excel, LibreOffice Calc, and Google Sheets.
 */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|lt|gt|quot|apos|amp);/g,
    (match, dec, hex) => {
      if (dec !== undefined) {
        const cp = Number.parseInt(dec, 10);
        if (
          Number.isInteger(cp) &&
          cp >= 0 &&
          cp <= 0x10ffff &&
          !(cp >= 0xd800 && cp <= 0xdfff)
        ) {
          return String.fromCodePoint(cp);
        }
        return "\uFFFD";
      }
      if (hex !== undefined) {
        const cp = Number.parseInt(hex, 16);
        if (
          Number.isInteger(cp) &&
          cp >= 0 &&
          cp <= 0x10ffff &&
          !(cp >= 0xd800 && cp <= 0xdfff)
        ) {
          return String.fromCodePoint(cp);
        }
        return "\uFFFD";
      }
      switch (match) {
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        case "&amp;":
          return "&";
        default:
          return match;
      }
    },
  );
}

function columnIndexToLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columnLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i += 1) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

interface ZipEntryInput {
  name: string;
  data: Buffer;
}

function buildZip(entries: readonly ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const uncompressed = entry.data;
    const compressed = deflateRawSync(uncompressed);
    const crc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

const MAX_ZIP_ENTRIES = 64;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

function extractZipEntries(zipBuffer: Buffer): Map<string, Buffer> {
  // Locate End of Central Directory (EOCD)
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minOffset; i -= 1) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("Invalid XLSX file: missing ZIP end-of-central-directory");
  }

  const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new Error(`Invalid XLSX file: too many ZIP entries (${entryCount})`);
  }
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map<string, Buffer>();
  let totalUncompressed = 0;

  let pos = centralOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (pos + 46 > zipBuffer.length || zipBuffer.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error("Invalid XLSX file: corrupt ZIP central directory");
    }
    const method = zipBuffer.readUInt16LE(pos + 10);
    const compressedSize = zipBuffer.readUInt32LE(pos + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(pos + 24);
    const nameLen = zipBuffer.readUInt16LE(pos + 28);
    const extraLen = zipBuffer.readUInt16LE(pos + 30);
    const commentLen = zipBuffer.readUInt16LE(pos + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(pos + 42);
    const name = zipBuffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    pos += 46 + nameLen + extraLen + commentLen;

    if (
      localHeaderOffset + 30 > zipBuffer.length ||
      zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error("Invalid XLSX file: corrupt ZIP local header");
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;

    if (dataStart + compressedSize > zipBuffer.length) {
      throw new Error("Invalid XLSX file: entry data exceeds buffer length");
    }

    const isAllowed =
      name === "xl/sharedStrings.xml" ||
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      /^xl\/worksheets\/[^/]+\.xml$/i.test(name);

    if (!isAllowed) {
      continue;
    }

    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(`Invalid XLSX file: entry ${name} exceeds uncompressed size limit`);
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error("Invalid XLSX file: total uncompressed size limit exceeded");
    }

    const rawData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.set(name, Buffer.from(rawData));
    } else if (method === 8) {
      entries.set(
        name,
        inflateRawSync(rawData, { maxOutputLength: MAX_ENTRY_UNCOMPRESSED_BYTES }),
      );
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} in XLSX`);
    }
  }

  return entries;
}

export function buildXlsxBuffer(
  sheetName: string,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): Buffer {
  const safeSheetName = sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1";

  const sheetRowsXml = rows
    .map((row, rowIdx) => {
      const rNum = rowIdx + 1;
      const cellsXml = row
        .map((cell, colIdx) => {
          const ref = `${columnIndexToLetters(colIdx)}${rNum}`;
          const text = escapeXml(cell ?? "");
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
        })
        .join("");
      return `<row r="${rNum}">${cellsXml}</row>`;
    })
    .join("");

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRowsXml}</sheetData>
</worksheet>`;

  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
  ]);
}

function parseSharedStrings(xml: string): string[] {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  const strings: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRe.exec(cleaned)) !== null) {
    const inner = siMatch[1] ?? "";
    const parts: string[] = [];
    const tRe = /<t\b([^>]*?)(?:\/>|>([\s\S]*?)<\/t>)/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tRe.exec(inner)) !== null) {
      const body = tMatch[2] ?? "";
      parts.push(decodeXmlEntities(body));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

export function parseXlsxBuffer(buffer: Buffer): string[][] {
  const entries = extractZipEntries(buffer);

  const sharedStringsBuf = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsBuf
    ? parseSharedStrings(sharedStringsBuf.toString("utf8"))
    : [];

  const workbookBuf = entries.get("xl/workbook.xml");
  const relsBuf = entries.get("xl/_rels/workbook.xml.rels");

  let sheetPath = "";
  if (workbookBuf && relsBuf) {
    const wbXml = workbookBuf.toString("utf8");
    const relsXml = relsBuf.toString("utf8");

    const relMap = new Map<string, string>();
    const relRe = /<Relationship\b([^>]*)\/>/g;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relRe.exec(relsXml)) !== null) {
      const attrs = relMatch[1] ?? "";
      const idMatch = /\bId="([^"]+)"/.exec(attrs);
      const targetMatch = /\bTarget="([^"]+)"/.exec(attrs);
      if (idMatch && targetMatch) {
        relMap.set(idMatch[1]!, targetMatch[1]!);
      }
    }

    const sheetRe = /<sheet\b([^>]*)\/>/g;
    let sheetMatch: RegExpExecArray | null;
    let firstRid = "";
    while ((sheetMatch = sheetRe.exec(wbXml)) !== null) {
      const attrs = sheetMatch[1] ?? "";
      const ridMatch = /\br:id="([^"]+)"/.exec(attrs);
      if (ridMatch) {
        firstRid = ridMatch[1]!;
        break;
      }
    }

    if (firstRid && relMap.has(firstRid)) {
      let target = relMap.get(firstRid)!;
      if (target.startsWith("/")) {
        sheetPath = target.slice(1);
      } else if (target.startsWith("worksheets/")) {
        sheetPath = `xl/${target}`;
      } else if (target.startsWith("xl/")) {
        sheetPath = target;
      } else {
        sheetPath = `xl/${target}`;
      }
    }
  }

  const sheetBuf =
    (sheetPath ? entries.get(sheetPath) : undefined) ??
    entries.get("xl/worksheets/sheet1.xml") ??
    Array.from(entries.entries())
      .filter(([k]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
      .sort(([a], [b]) => {
        const numA = Number.parseInt(a.replace(/\D/g, ""), 10) || 0;
        const numB = Number.parseInt(b.replace(/\D/g, ""), 10) || 0;
        return numA - numB;
      })[0]?.[1];

  if (!sheetBuf) {
    throw new Error("Invalid XLSX file: no worksheet found");
  }

  const sheetXml = sheetBuf.toString("utf8");
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    if (rows.length >= 1506) {
      break;
    }
    const rowInner = rowMatch[1] ?? "";
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRe.exec(rowInner)) !== null) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";

      const refMatch = /\br="([A-Z]+)\d+"/i.exec(attrs);
      if (refMatch && refMatch[1]!.length > 3) {
        throw new Error(
          "XLSX column index exceeds maximum supported columns (128)",
        );
      }
      const colIdx = refMatch
        ? columnLettersToIndex(refMatch[1]!.toUpperCase())
        : cells.length;
      if (colIdx >= 128) {
        throw new Error(
          "XLSX column index exceeds maximum supported columns (128)",
        );
      }

      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const cellType = typeMatch?.[1] ?? "";

      let value = "";
      if (cellType === "inlineStr") {
        const parts: string[] = [];
        const tRe = /<t\b([^>]*?)(?:\/>|>([\s\S]*?)<\/t>)/g;
        let tMatch: RegExpExecArray | null;
        while ((tMatch = tRe.exec(body)) !== null) {
          const tBody = tMatch[2] ?? "";
          parts.push(decodeXmlEntities(tBody));
        }
        value = parts.join("");
      } else {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        const rawV = vMatch ? decodeXmlEntities(vMatch[1] ?? "") : "";
        if (cellType === "s") {
          const idx = Number.parseInt(rawV, 10);
          value = Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length ? (sharedStrings[idx] ?? "") : "";
        } else if (cellType === "b") {
          value = rawV === "1" ? "true" : "false";
        } else {
          value = rawV;
        }
      }

      while (cells.length < colIdx) {
        cells.push("");
      }
      cells[colIdx] = value;
    }

    if (cells.some((c) => c.trim().length > 0)) {
      rows.push(cells);
    }
  }

  return rows;
}
