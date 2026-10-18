import { createReassembler, decodeAll, keyOf, segment } from "./bmap.js";

export const BMAP_SERVICE = "0000febe-0000-1000-8000-00805f9b34fb";
export const BMAP_SERVICE_APK = "0000febe-0000-0000-0000-000000000000";
export const CHAR_SECURE = "c65b8f2f-aee2-4c89-b758-bc4892d6f2d8";
export const CHAR_PLAIN = "d417c028-9818-4354-99d1-2ac09d074591";

const SERVICES = [BMAP_SERVICE_APK, BMAP_SERVICE];

const NAME_FILTERS = [
  { namePrefix: "Bose" },
  { namePrefix: "LE-Bose" },
  { namePrefix: "LE-QC" },
  { namePrefix: "QC" },
  { namePrefix: "QuietComfort" },
  { namePrefix: "SoundLink" },
  { services: [BMAP_SERVICE] },
  { services: [BMAP_SERVICE_APK] },
];

export function createBoseCodec() {
  let reassembler = createReassembler();
  return {
    id: "bose",
    ble: true,
    filters: NAME_FILTERS,
    services: SERVICES,
    chars: [CHAR_SECURE, CHAR_PLAIN],
    reset() {
      reassembler = createReassembler();
    },
    // SPP 自己就是整包流，BLE 上要按 20 字节切片
    chunks(bytes, link) {
      return link === "spp" ? [bytes] : segment(bytes);
    },
    parse(chunk, link) {
      const assembled = link === "spp" ? chunk : reassembler.push(chunk);
      return assembled ? decodeAll(assembled) : [];
    },
    key(packet) {
      return keyOf(packet);
    },
    header(bytes) {
      return decodeAll(bytes)[0];
    },
  };
}
