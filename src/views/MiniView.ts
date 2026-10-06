import { ItemView, WorkspaceLeaf } from 'obsidian';
import { moment } from '../moment';
import { getDateFromFile } from 'obsidian-daily-notes-interface';
import { dailyNoteFor, dailyNotesLookup, openDailyNote } from '../actions';
import type KanbanCalendarPlugin from '../main';
import { formatDayRu, makeDropTarget, monthGrid, renderChip, renderNav, todayIso, WEEKDAYS } from './shared';

export const MINI_VIEW = 'kanban-calendar-mini';
const MAX_DOTS = 4;

/** Компактный календарь в боковой панели, как у плагина Calendar, + список задач выбранного дня. */
export class MiniView extends ItemView {
  private month = moment().format('YYYY-MM');
  private selected = todayIso();

  constructor(leaf: WorkspaceLeaf, private plugin: KanbanCalendarPlugin) {
    super(leaf);
  }

  getViewType() {
    return MINI_VIEW;
  }
  getDisplayText() {
    return 'Мини-календарь';
  }
  getIcon() {
    return 'calendar';
  }

  async onOpen() {
    this.registerEvent(this.plugin.index.on('updated', () => this.render()));
    this.registerEvent(this.app.vault.on('create', () => this.render()));
    this.registerEvent(this.app.vault.on('delete', () => this.render()));
    // Открыли заметку дня — выделить её дату, как это делает Calendar.
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file) return;
        const day = getDateFromFile(file, 'day');
        if (day && dailyNoteFor(day.format('YYYY-MM-DD'))?.path === file.path) {
          this.selected = day.format('YYYY-MM-DD');
          this.month = day.format('YYYY-MM');
          this.render();
        }
      })
    );
    // Новый день — подсветка «сегодня» должна переехать.
    this.registerInterval(window.setInterval(() => this.render(), 60 * 60 * 1000));
    this.render();
  }

  private select(iso: string, evt: MouseEvent) {
    this.selected = iso;
    this.render();
    // Как в Calendar: клик открывает заметку дня. Но создавать её без спроса не будем —
    // для пустого дня кнопка «Создать» есть в списке ниже.
    if (dailyNoteFor(iso)) openDailyNote(this.plugin, iso, evt);
  }

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass('kc-mini');

    renderNav(el, this.month, (m) => {
      this.month = m;
      this.render();
    });

    const grid = el.createDiv('kc-mini-grid');
    for (const d of WEEKDAYS) grid.createDiv({ cls: 'kc-weekday', text: d });

    const today = todayIso();
    const noteFor = dailyNotesLookup();
    for (const day of monthGrid(this.month)) {
      const cell = grid.createDiv('kc-mini-cell');
      cell.toggleClass('is-other-month', !day.inMonth);
      cell.toggleClass('is-weekend', day.weekend);
      cell.toggleClass('is-today', day.iso === today);
      cell.toggleClass('is-selected', day.iso === this.selected);
      cell.toggleClass('has-note', !!noteFor(day.iso));
      cell.createDiv({ cls: 'kc-mini-num', text: String(day.day) });

      const events = this.plugin.index.days.get(day.iso) ?? [];
      const dots = cell.createDiv('kc-dots');
      for (const ev of events.slice(0, MAX_DOTS)) {
        const dot = dots.createSpan('kc-dot');
        dot.toggleClass('is-done', ev.done);
        dot.style.setProperty('--kc-color', this.plugin.index.type(ev.key)?.color ?? 'var(--interactive-accent)');
      }
      if (events.length) cell.setAttr('aria-label', events.map((e) => `${this.plugin.index.type(e.key)?.label ?? ''} ${e.title}`.trim()).join('\n'));

      cell.onclick = (evt) => this.select(day.iso, evt);
      makeDropTarget(cell, day.iso, this.plugin);
    }

    this.renderAgenda(el);
  }

  private renderAgenda(el: HTMLElement) {
    const agenda = el.createDiv('kc-agenda');
    const head = agenda.createDiv('kc-agenda-head');
    head.createDiv({ cls: 'kc-agenda-title', text: formatDayRu(this.selected, true) });
    const hasNote = !!dailyNoteFor(this.selected);
    const noteBtn = head.createEl('button', { cls: 'kc-agenda-note', text: hasNote ? 'Заметка дня' : 'Создать заметку дня' });
    noteBtn.onclick = (evt) => openDailyNote(this.plugin, this.selected, evt);

    const events = this.plugin.index.days.get(this.selected) ?? [];
    if (!events.length) {
      agenda.createDiv({ cls: 'kc-agenda-empty', text: 'Задач нет' });
      return;
    }
    const list = agenda.createDiv('kc-agenda-list');
    for (const ev of events) renderChip(list, ev, this.plugin, this, { showLane: true });
  }
}
