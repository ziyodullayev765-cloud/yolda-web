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

export const STATUS_LABELS = {
  NEW: 'Yangi',
  DRIVER_FOUND: 'Haydovchi topildi',
  ON_THE_WAY: "Yo'lda",
  DELIVERED: 'Yetkazildi',
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
    `📏 ${escapeMd(formatNum(order.distanceKm))} km`,
    `⚖️ ${escapeMd(formatNum(order.weightKg))} kg`,
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
  else if (order.status === 'ON_THE_WAY') lines.push("🛣️ *YO'LDA*");
  else if (order.status === 'DELIVERED') lines.push('✅ *YETKAZILDI*');

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
