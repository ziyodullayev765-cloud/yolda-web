/**
 * Shared between /api/order (building the initial Telegram message) and
 * /api/telegram (rebuilding it as the order's status changes) — one source
 * of truth for the cargo-details header and the status footer, so the two
 * never drift out of sync with each other.
 */

export const CARGO = {
  GENERAL: { label: 'Umumiy yuk', emoji: '📦', mult: 1.0 },
  FOOD: { label: 'Oziq-ovqat', emoji: '🍞', mult: 1.15 },
  CONSTRUCTION: { label: 'Qurilish materiallari', emoji: '🧱', mult: 1.2 },
  FURNITURE: { label: 'Mebel', emoji: '🛋️', mult: 1.25 },
  ELECTRONICS: { label: 'Elektronika', emoji: '📺', mult: 1.4 },
  AGRICULTURE: { label: 'Qishloq xo‘jaligi mahsulotlari', emoji: '🌾', mult: 1.1 },
  CLOTHING: { label: 'Kiyim-kechak', emoji: '👕', mult: 1.05 },
  MACHINERY: { label: 'Texnika / mashinalar', emoji: '⚙️', mult: 1.35 },
  DOCUMENTS: { label: 'Hujjatlar', emoji: '📄', mult: 0.9 },
  PERISHABLE: { label: 'Tez buziluvchi', emoji: '🧊', mult: 1.3 },
  FRAGILE: { label: 'Qimmatbaho / mo‘rt', emoji: '💎', mult: 1.5 },
  HEAVY: { label: 'Og‘ir texnika', emoji: '🏗', mult: 1.4 },
  OTHER: { label: 'Boshqa', emoji: '📦', mult: 1.1 },
};

export const TRUCK_LABELS = {
  ISUZU: 'Isuzu', GAZEL: 'Gazel', FURGON: 'Furgon', YARIM_TREYLER: 'Yarim treyler',
  SAMOSVAL: 'Samosval', BOSHQA: 'Boshqa',
};

/**
 * Buyurtma bosqichlari. PICKING_UP va LOADED oraliq bosqichlar:
 * ilgari haydovchi «Yo'lga chiqdim» deganda yuk beruvchi uni yukni
 * olishga ketyaptimi yoki yuk bilan ketyaptimi, bilmasdi.
 *
 * Eski buyurtmalarda bu bosqichlar yo'q — ular DRIVER_FOUND dan
 * to'g'ridan-to'g'ri ON_THE_WAY ga o'tgan va shundayligicha qoladi.
 */
export const STATUS_LABELS = {
  NEW: 'Yangi',
  DRIVER_FOUND: 'Haydovchi tanlandi',
  PICKING_UP: 'Yuklashga ketmoqda',
  LOADED: 'Yuklandi',
  ON_THE_WAY: "Yo'lda",
  DELIVERED: 'Yetkazildi',
  CANCELLED: 'Bekor qilindi',
};

/** Kuzatish chizig'idagi tartib (CANCELLED bu chiziqdan chiqib ketish). */
export const STATUS_FLOW = ['NEW', 'DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY', 'DELIVERED'];

/**
 * Zanjirdagi keyingi bosqich, yoki null (oxirgi bosqich / noma'lum holat).
 *
 * Ikki joyda kerak — haydovchi bosqichni Telegram tugmasi bilan ham
 * (api/telegram.js), saytdan ham (api/order.js) sura oladi. Qoida bitta
 * joyda tursin, aks holda ikki yo'l bir kun har xil ishlab qoladi.
 */
export const nextStatus = (status) => {
  const i = STATUS_FLOW.indexOf(status);
  return i === -1 || i === STATUS_FLOW.length - 1 ? null : STATUS_FLOW[i + 1];
};

/** Haydovchi bosqichni surganda bosadigan tugma yozuvi. */
export const NEXT_STATUS_BUTTON = {
  DRIVER_FOUND: 'Yuklashga ketdim',
  PICKING_UP: 'Yukladim',
  LOADED: "Yo'lga chiqdim",
  ON_THE_WAY: 'Yetkazdim',
};

/**
 * Xaritadagi nuqtaga havola. Google Maps tanlandi, chunki u
 * O'zbekistonda deyarli har telefonda bor va havola brauzerdan ham
 * ochiladi — hech qanday ilova talab qilmaydi.
 */
export const mapLink = (point, label) => {
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) {
    return null;
  }
  const url = `https://maps.google.com/?q=${point.lat},${point.lng}`;
  return `🗺 [${escapeMd(label)}](${url})`;
};

/** Joy sonining o'lchov birligi. */
export const QUANTITY_UNIT_LABELS = {
  JOY: 'joy', PALLET: 'pallet', QOP: 'qop', QUTI: 'quti', RULON: 'rulon',
};

/** Telegram MarkdownV2 requires escaping a long list of characters. */
export const escapeMd = (s) => String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);

export const formatNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** The part of the Telegram message that never changes once posted. */
export const buildOrderHeader = (order) => {
  const cargo = CARGO[order.cargoType] || CARGO.OTHER;
  const cargoLabel = order.cargoType === 'OTHER' && order.customCargoLabel ? order.customCargoLabel : cargo.label;
  return [
    `🚚 *YANGI YUK* \\| \`${escapeMd(order.code)}\``,
    '',
    `📍 *${escapeMd(order.fromCity)}* → *${escapeMd(order.toCity)}*`,
    // Aniq manzil va nuqta — haydovchi shahar nomini emas, qayerga
    // borishni bilishi kerak. Ikkalasi ham ixtiyoriy, yo'q bo'lsa
    // qator ham chiqmaydi.
    order.fromAddress ? `↗️ ${escapeMd(order.fromAddress)}` : null,
    order.toAddress ? `↘️ ${escapeMd(order.toAddress)}` : null,
    mapLink(order.fromPoint, 'Olib ketish nuqtasi'),
    mapLink(order.toPoint, 'Yetkazish nuqtasi'),
    `📏 ${escapeMd(formatNum(order.distanceKm))} km`,
    `⚖️ ${escapeMd(formatNum(order.weightKg))} kg`,
    // Hajm va joy soni ixtiyoriy — kiritilmagan bo'lsa qator ham
    // chiqmaydi. Haydovchi uchun bular og'irlikdan kam ahamiyatli emas:
    // bir tonna paxta bilan bir tonna sement bir xil joy egallamaydi.
    order.volumeM3 ? `📦 ${escapeMd(String(order.volumeM3))} m³` : null,
    order.quantity
      ? `🔢 ${escapeMd(formatNum(order.quantity))} ${escapeMd(QUANTITY_UNIT_LABELS[order.quantityUnit] || 'joy')}`
      : null,
    `${cargo.emoji} ${escapeMd(cargoLabel)}`,
    order.truckType ? `🚛 ${escapeMd(TRUCK_LABELS[order.truckType] || order.truckType)}` : null,
    order.pickupDate ? `📅 ${escapeMd(order.pickupDate)}` : null,
    '',
    order.isProposed
      ? `💰 *${escapeMd(formatNum(order.amount))} so‘m* \\(yuk beruvchi taklifi, hisoblangan: ${escapeMd(formatNum(order.estimatedAmount))} so‘m\\)`
      : `💰 *${escapeMd(formatNum(order.amount))} so‘m* \\(taxminiy\\)`,
    '',
    `👤 ${escapeMd(order.name)}`,
    order.googleEmail ? `✅ Google: ${escapeMd(order.googleEmail)}` : null,
    order.telegramOwner ? `✅ Telegram: @${escapeMd(order.telegramOwner)}` : null,
    order.note ? `📝 ${escapeMd(order.note)}` : null,
  ].filter(Boolean).join('\n');
};

/** The trailing block that changes as the order moves through its statuses. */
export const buildStatusFooter = (order) => {
  if (!order.status || order.status === 'NEW') {
    return '_Raqam buyurtmani qabul qilgandan keyin ko‘rinadi\\._';
  }

  const lines = ['━━━━━━━━━━━━━━'];
  if (order.status === 'DRIVER_FOUND') lines.push('✅ *OLINDI*');
  else if (order.status === 'PICKING_UP') lines.push('🚚 *YUKLASHGA KETMOQDA*');
  else if (order.status === 'LOADED') lines.push('📦 *YUKLANDI*');
  else if (order.status === 'ON_THE_WAY') lines.push("🛣️ *YO'LDA*");
  else if (order.status === 'DELIVERED') lines.push('✅ *YETKAZILDI*');
  else if (order.status === 'CANCELLED') {
    // Bekor qilingan buyurtmada haydovchi ma'lumoti ortiqcha — guruhda
    // bu yuk endi yo'qligi ko'rinib tursin, xolos.
    lines.push('🚫 *BEKOR QILINDI*');
    if (order.cancelReason) lines.push(`_${escapeMd(order.cancelReason)}_`);
    return lines.join('\n');
  }

  if (order.driver) {
    const link = order.driver.telegramUsername
      ? `@${escapeMd(order.driver.telegramUsername)}`
      : `[${escapeMd(order.driver.name)}](tg://user?id=${order.driver.telegramId})`;
    lines.push(`🚚 Haydovchi: ${link}${order.driver.verified ? ' ✓ Tasdiqlangan' : ''}`);
  }
  if (order.phone) lines.push(`📞 Mijoz: \`${escapeMd(order.phone)}\``);

  return lines.join('\n');
};

export const buildOrderMessage = (order) => [buildOrderHeader(order), '', buildStatusFooter(order)].join('\n');
