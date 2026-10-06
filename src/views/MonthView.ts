import { ItemView, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { moment } from '../moment';
import { dailyNotesLookup, openDailyNote } from '../actions';
import type KanbanCalendarPlugin from '../main';
import { makeDropTarget, monthGrid, renderChip, renderLegend, renderNav, todayIso, WEEKDAYS } from './shared';

export const MONTH_VIEW = 'kanban-calendar-month';

/** Большой календарь-месяц во вкладке: задачи прямо в клетках. */
export class MonthView extends ItemView {
  private month = moment().format('YYYY-MM');

  constructor(leaf: WorkspaceLeaf, private plugin: KanbanCalendarPlugin) {
    super(leaf);
  }

  getViewType() {
    return MONTH_VIEW;
  }
  getDisplayText() {
    return 'Канбан-календарь';
  }
  getIcon() {
    return 'calendar-days';
  }

  getState() {
    return { ...super.getState(), month: this.month };
  }

  async setState(state: unknown, result: ViewStateResult) {
    const month = (state as { month?: string })?.month;
    if (month && /^\d{4}-\d{2}$/.test(month)) this.month = month;
    await super.setState(state, result);
    this.render();
  }

  async onOpen() {
    this.registerEvent(this.plugin.index.on('updated', () => this.render()));
    // Появилась или пропала заметка дня — обновить отметки.
    this.registerEvent(this.app.vault.on('create', () => this.render()));
    this.registerEvent(this.app.vault.on('delete', () => this.render()));
    this.render();
  }

  private go(month: string) {
    this.month = month;
    this.app.workspace.requestSaveLayout();
    this.render();
  }

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass('kc-month');

    const header = el.createDiv('kc-header');
    renderNav(header, this.month, (m) => this.go(m));
    renderLegend(header, this.plugin);

    const grid = el.createDiv('kc-grid');
    for (const d of WEEKDAYS) grid.createDiv({ cls: 'kc-weekday', text: d });

    const today = todayIso();
    const noteFor = dailyNotesLookup();
    for (const day of monthGrid(this.month)) {
      const cell = grid.createDiv('kc-cell');
      cell.toggleClass('is-other-month', !day.inMonth);
      cell.toggleClass('is-weekend', day.weekend);
      cell.toggleClass('is-today', day.iso === today);

      const head = cell.createDiv('kc-cell-head');
      const num = head.createEl('button', { cls: 'kc-day-num', text: String(day.day) });
      const hasNote = !!noteFor(day.iso);
      num.toggleClass('has-note', hasNote);
      num.setAttr('aria-label', hasNote ? 'Открыть заметку дня' : 'Создать заметку дня');
      num.onclick = (evt) => openDailyNote(this.plugin, day.iso, evt);

      const list = cell.createDiv('kc-cell-events');
      for (const ev of this.plugin.index.days.get(day.iso) ?? []) {
        renderChip(list, ev, this.plugin, this, { showLane: true });
      }
      makeDropTarget(cell, day.iso, this.plugin);
    }
  }
}
