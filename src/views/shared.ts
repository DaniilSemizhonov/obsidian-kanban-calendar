import { View } from 'obsidian';
import { moment, Moment } from '../moment';
import { moveEvent, openEvent } from '../actions';
import { CalEvent, CARD_KEY } from '../events';
import type KanbanCalendarPlugin from '../main';

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const iso = (m: Moment) => m.format('YYYY-MM-DD');
export const todayIso = () => iso(moment());

/** «13 октября» или «вторник, 13 октября». Не зависит от языка Obsidian. */
export function formatDayRu(day: string, withWeekday = false): string {
  const m = moment(day, 'YYYY-MM-DD');
  const text = `${m.date()} ${MONTHS_GEN[m.month()]}`;
  return withWeekday ? `${WEEKDAYS_FULL[(m.day() + 6) % 7]}, ${text}` : text;
}

export interface GridDay {
  iso: string;
  day: number;
  inMonth: boolean;
  weekend: boolean;
}

/** 6 недель, начиная с понедельника, — как у Calendar. */
export function monthGrid(month: string): GridDay[] {
  const first = moment(`${month}-01`, 'YYYY-MM-DD');
  const start = first.clone().subtract((first.day() + 6) % 7, 'days');
  return Array.from({ length: 42 }, (_, i) => {
    const d = start.clone().add(i, 'days');
    return { iso: iso(d), day: d.date(), inMonth: d.month() === first.month(), weekend: d.day() === 0 || d.day() === 6 };
  });
}

export const shiftMonth = (month: string, delta: number) =>
  moment(`${month}-01`, 'YYYY-MM-DD').add(delta, 'months').format('YYYY-MM');

export function monthTitle(month: string): string {
  const m = moment(`${month}-01`, 'YYYY-MM-DD');
  return `${MONTHS[m.month()]} ${m.year()}`;
}

/** Шапка: ‹ Октябрь 2026 › Сегодня. */
export function renderNav(el: HTMLElement, month: string, go: (month: string) => void) {
  const nav = el.createDiv('kc-nav');
  nav.createDiv({ cls: 'kc-nav-title', text: monthTitle(month) });
  const buttons = nav.createDiv('kc-nav-buttons');
  const btn = (icon: string, label: string, to: string) => {
    const b = buttons.createEl('button', { cls: 'clickable-icon kc-nav-btn', attr: { 'aria-label': label } });
    b.setText(icon);
    b.onclick = () => go(to);
  };
  btn('‹', 'Предыдущий месяц', shiftMonth(month, -1));
  const today = buttons.createEl('button', { cls: 'kc-nav-today', text: 'Сегодня' });
  today.onclick = () => go(moment().format('YYYY-MM'));
  btn('›', 'Следующий месяц', shiftMonth(month, 1));
}

// Событие, которое сейчас перетаскивают. dataTransfer недоступен в dragover, поэтому храним здесь.
let dragging: CalEvent | null = null;

export function renderChip(
  parent: HTMLElement,
  ev: CalEvent,
  plugin: KanbanCalendarPlugin,
  view: View,
  opts: { showLane: boolean }
): HTMLElement {
  const type = plugin.index.type(ev.key);
  const chip = parent.createDiv({ cls: 'kc-chip' });
  chip.toggleClass('is-done', ev.done);
  chip.style.setProperty('--kc-color', type?.color ?? 'var(--interactive-accent)');

  if (type?.label && ev.key !== CARD_KEY) chip.createSpan({ cls: 'kc-chip-label', text: type.label });
  chip.createSpan({ cls: 'kc-chip-title', text: ev.title });
  if (opts.showLane && ev.lane) chip.createDiv({ cls: 'kc-chip-lane', text: ev.lane });

  chip.setAttr('aria-label', [`${type?.label ?? ''} ${ev.title}`.trim(), ev.lane && `Этап: ${ev.lane}`].filter(Boolean).join('\n'));
  chip.setAttr('aria-label-position', 'top');

  chip.addEventListener('click', (evt) => {
    evt.stopPropagation();
    openEvent(plugin.app, ev, evt);
  });
  chip.addEventListener('mouseover', (evt) => {
    plugin.app.workspace.trigger('hover-link', {
      event: evt,
      source: view.getViewType(),
      hoverParent: view,
      targetEl: chip,
      linktext: ev.notePath ?? ev.boardPath,
      sourcePath: '',
    });
  });

  chip.draggable = true;
  chip.addEventListener('dragstart', (evt) => {
    dragging = ev;
    evt.dataTransfer?.setData('text/plain', ev.title);
    if (evt.dataTransfer) evt.dataTransfer.effectAllowed = 'move';
    chip.addClass('is-dragging');
  });
  chip.addEventListener('dragend', () => {
    dragging = null;
    chip.removeClass('is-dragging');
  });
  return chip;
}

/** Клетка дня принимает перетаскиваемые события. */
export function makeDropTarget(cell: HTMLElement, day: string, plugin: KanbanCalendarPlugin) {
  cell.addEventListener('dragover', (evt) => {
    if (!dragging) return;
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
    cell.addClass('is-drop-target');
  });
  cell.addEventListener('dragleave', (evt) => {
    if (!cell.contains(evt.relatedTarget as Node)) cell.removeClass('is-drop-target');
  });
  cell.addEventListener('drop', (evt) => {
    cell.removeClass('is-drop-target');
    const ev = dragging;
    dragging = null;
    if (!ev) return;
    evt.preventDefault();
    moveEvent(plugin, ev, day);
  });
}

export function renderLegend(el: HTMLElement, plugin: KanbanCalendarPlugin) {
  const types = plugin.index.types;
  if (!types.length) return;
  const legend = el.createDiv('kc-legend');
  for (const t of types) {
    const item = legend.createDiv('kc-legend-item');
    item.style.setProperty('--kc-color', t.color);
    item.createSpan('kc-legend-swatch');
    // «📅» без пояснения непонятен — добавляем имя ключа, если подпись без букв.
    item.createSpan({ text: /\p{L}/u.test(t.label) ? t.label : `${t.label} ${t.key}` });
  }
}
