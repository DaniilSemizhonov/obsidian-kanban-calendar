// Разбор markdown-файла Kanban-доски. Чистые функции: без Obsidian API, чтобы их можно было тестировать.

export interface MetadataKey {
  key: string;
  label: string;
}

export interface BoardSettings {
  dateFormat: string;
  dateTrigger: string;
  linkDateToDailyNote: boolean;
  metadataKeys: MetadataKey[];
}

export interface Card {
  /** Строка, с которой начинается карточка (0-based). */
  line: number;
  /** Строка, в которой найдена дата, и сам токен даты в том виде, как он записан в файле. */
  dateLine: number;
  dateToken: string | null;
  /** Дата карточки в ISO (YYYY-MM-DD) или null. */
  date: string | null;
  title: string;
  /** Цель первой [[ссылки]] в карточке, без #заголовка и |подписи. */
  link: string | null;
  checked: boolean;
  lane: string;
  laneComplete: boolean;
}

export interface Board {
  settings: BoardSettings;
  cards: Card[];
}

/** Перевод даты между форматом доски и ISO. В плагине — moment из obsidian, в тестах — moment из npm. */
export interface DateCodec {
  parse(value: string, format: string): string | null;
  format(iso: string, format: string): string;
}

export const DEFAULT_SETTINGS: BoardSettings = {
  dateFormat: 'YYYY-MM-DD',
  dateTrigger: '@',
  linkDateToDailyNote: false,
  metadataKeys: [],
};

const SETTINGS_RE = /%% kanban:settings\s*```\s*([\s\S]*?)\s*```\s*%%/;
const CARD_RE = /^(\s*)[-*+] \[(.)\] ?(.*)$/;
const LINK_RE = /\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseSettings(text: string, defaults: Partial<BoardSettings> = {}): BoardSettings {
  const base: BoardSettings = { ...DEFAULT_SETTINGS, ...defaults };
  const m = SETTINGS_RE.exec(text);
  if (!m) return base;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return base;
  }
  const keys = Array.isArray(raw['metadata-keys']) ? (raw['metadata-keys'] as Record<string, unknown>[]) : null;
  return {
    dateFormat: typeof raw['date-format'] === 'string' ? (raw['date-format'] as string) : base.dateFormat,
    dateTrigger: typeof raw['date-trigger'] === 'string' ? (raw['date-trigger'] as string) : base.dateTrigger,
    linkDateToDailyNote:
      typeof raw['link-date-to-daily-note'] === 'boolean'
        ? (raw['link-date-to-daily-note'] as boolean)
        : base.linkDateToDailyNote,
    metadataKeys: keys
      ? keys
          .filter((k) => typeof k.metadataKey === 'string' && k.metadataKey)
          .map((k) => ({ key: k.metadataKey as string, label: typeof k.label === 'string' ? k.label : '' }))
      : base.metadataKeys,
  };
}

/** Регулярка для токена даты: @{...} или @[[...]] (если даты связаны с ежедневными заметками). */
function dateTokenRe(trigger: string): RegExp {
  const t = escapeRe(trigger);
  // (?<!@) — чтобы не принять время @@{12:00} за дату.
  return new RegExp(`(?<!${t})${t}(?:\\{([^}]+)\\}|\\[\\[([^\\]]+)\\]\\])`);
}

function cardTitle(text: string, trigger: string): { title: string; link: string | null } {
  const t = escapeRe(trigger);
  const clean = text
    .replace(new RegExp(`${t}${t}\\{[^}]*\\}`, 'g'), '') // время
    .replace(new RegExp(`${t}(?:\\{[^}]*\\}|\\[\\[[^\\]]*\\]\\])`, 'g'), '') // дата
    .trim();
  const m = LINK_RE.exec(clean);
  if (!m) return { title: clean, link: null };
  const target = m[1].trim();
  const alias = m[2]?.trim();
  const base = target.split('/').pop() || target;
  // Если вся карточка — одна ссылка, показываем её подпись или имя файла; иначе — текст карточки без скобок.
  const onlyLink = clean.replace(LINK_RE, '').trim() === '';
  const title = onlyLink ? alias || base : clean.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1');
  return { title, link: target || null };
}

export function parseBoard(text: string, codec: DateCodec, defaults: Partial<BoardSettings> = {}): Board {
  const settings = parseSettings(text, defaults);
  const lines = text.split('\n');
  const cards: Card[] = [];
  const dateRe = dateTokenRe(settings.dateTrigger);

  let lane = '';
  let laneComplete = false;
  let current: { card: Card; text: string[]; lines: number[] } | null = null;

  const flush = () => {
    if (!current) return;
    const { card } = current;
    for (let i = 0; i < current.text.length; i++) {
      const m = dateRe.exec(current.text[i]);
      if (!m) continue;
      card.dateToken = m[0];
      card.dateLine = current.lines[i];
      card.date = codec.parse((m[1] ?? m[2]).trim(), settings.dateFormat);
      break;
    }
    // Название — по первой строке: продолжение карточки обычно заметки, а не заголовок.
    Object.assign(card, cardTitle(current.text[0], settings.dateTrigger));
    cards.push(card);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Архив (после ***) и блок настроек в календарь не попадают.
    if (/^\*\*\*\s*$/.test(line) || line.startsWith('%% kanban:settings')) break;

    const heading = /^## (.*)$/.exec(line);
    if (heading) {
      flush();
      lane = heading[1].trim();
      laneComplete = false;
      continue;
    }
    if (line.trim() === '**Complete**') {
      flush();
      laneComplete = true;
      continue;
    }

    const cm = CARD_RE.exec(line);
    if (cm && cm[1] === '') {
      flush();
      current = {
        card: {
          line: i,
          dateLine: -1,
          dateToken: null,
          date: null,
          title: '',
          link: null,
          checked: cm[2] !== ' ',
          lane,
          laneComplete,
        },
        text: [cm[3]],
        lines: [i],
      };
      continue;
    }
    // Продолжение многострочной карточки — строки с отступом.
    if (current && /^\s+\S/.test(line)) {
      current.text.push(line.trim());
      current.lines.push(i);
      continue;
    }
    flush();
  }
  flush();

  return { settings, cards };
}

/**
 * Меняет дату карточки в тексте доски. Бросает ошибку, если строка уже не та, что при разборе
 * (доску успели изменить) — тогда в файл ничего не пишется.
 */
export function setCardDate(text: string, card: Card, newIso: string, settings: BoardSettings, codec: DateCodec): string {
  if (!card.dateToken || card.dateLine < 0) throw new Error('у карточки нет даты');
  const lines = text.split('\n');
  const line = lines[card.dateLine];
  if (line === undefined || !line.includes(card.dateToken)) {
    throw new Error('доска изменилась, обновите календарь и попробуйте снова');
  }
  const value = codec.format(newIso, settings.dateFormat);
  const t = settings.dateTrigger;
  const token = card.dateToken.startsWith(`${t}[[`) ? `${t}[[${value}]]` : `${t}{${value}}`;
  lines[card.dateLine] = line.replace(card.dateToken, token);
  return lines.join('\n');
}
