import { moment, notices, TFile, TFolder } from './obsidian-mock';
import KanbanCalendarPlugin from '../../src/main';
import { MonthView } from '../../src/views/MonthView';
import { MiniView } from '../../src/views/MiniView';
declare const BOARD: string;
declare const POSTS: Record<string, Record<string, string>>;

// Сегодня = 6 октября 2026, как у пользователя.
const realNow = Date.now; const fixed = new Date('2026-10-06T12:00:00').getTime();
Date.now = () => fixed;

const BOARD_PATH = 'Блог/Доска.md';
const files: Record<string, string> = { [BOARD_PATH]: BOARD, 'Ежедневник/2026.10.05.md': '', 'Ежедневник/2026.10.06.md': '' };
const fm: Record<string, any> = { [BOARD_PATH]: { 'kanban-plugin': 'board' }, ...POSTS };
for (const p of Object.keys(POSTS)) files[p] = '';
const tfile = (p: string) => new TFile(p);
const log: string[] = [];
(window as any).moment = moment;
(window as any).app = undefined; // выставим ниже, после объявления app

const app: any = {
  vault: {
    getMarkdownFiles: () => Object.keys(files).map(tfile),
    getFiles: () => Object.keys(files).map(tfile),
    cachedRead: async (f: TFile) => files[f.path],
    getAbstractFileByPath: (p: string) =>
      p === 'Ежедневник'
        ? new TFolder(p, Object.keys(files).filter((x) => x.startsWith('Ежедневник/')).map(tfile))
        : p in files ? tfile(p) : null,
    process: async (f: TFile, fn: (t: string) => string) => { files[f.path] = fn(files[f.path]); log.push('board'); },
    on: () => ({}),
    getConfig: () => undefined,
  },
  metadataCache: {
    getFileCache: (f: TFile) => ({ frontmatter: fm[f.path] }),
    getFirstLinkpathDest: (link: string) => { const p = Object.keys(files).find((x) => x.endsWith(`/${link}.md`)); return p ? tfile(p) : null; },
    on: () => ({}),
  },
  fileManager: { processFrontMatter: async (f: TFile, fn: (o: any) => void) => { fn(fm[f.path]); log.push('fm'); } },
  workspace: { on: () => ({}), trigger: () => {}, requestSaveLayout: () => {}, getLeaf: () => ({ openFile: async (f: TFile) => log.push('open ' + f.path) }) },
  internalPlugins: {
    plugins: { 'daily-notes': { enabled: true } },
    getPluginById: () => ({ enabled: true, instance: { options: { format: 'YYYY.MM.DD', folder: 'Ежедневник' } } }),
  },
  plugins: { getPlugin: () => null, plugins: {} },
};

(window as any).app = app;

(async () => {
  const plugin = new KanbanCalendarPlugin(app, {});
  await plugin.loadSettings();
  const { TaskIndex } = await import('../../src/index');
  plugin.index = new TaskIndex(app, plugin);
  await plugin.index.rebuild();

  const month = new MonthView({ app }, plugin);
  document.getElementById('month')!.appendChild(month.contentEl);
  await month.setState({ month: '2026-10' }, {} as any);
  await month.onOpen();

  const mini = new MiniView({ app }, plugin);
  document.getElementById('mini')!.appendChild(mini.contentEl);
  await mini.onOpen();

  (window as any).__h = { plugin, files, fm, log, notices, month, mini, BOARD_PATH };
  document.body.dataset.ready = '1';
})();
