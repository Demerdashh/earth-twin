import './styles/main.css';
import { App } from './app/app';
import { resolveDataSource } from './config/data-source';
import { loadDataSet } from './data/loader';
import { $ } from './ui/dom';
import { renderContractErrors } from './ui/errors';

async function boot(): Promise<void> {
  const source = resolveDataSource();
  const boot = $('#boot');
  boot.querySelector('.boot-msg')!.textContent = `Loading ${source} data set…`;
  try {
    const result = await loadDataSet(source);
    if (!result.ok) {
      renderContractErrors($('#app'), source, result.errors);
      return;
    }
    new App(result.data);
  } catch (err) {
    renderContractErrors($('#app'), source, [
      { file: '(app)', path: '$', message: err instanceof Error ? err.message : String(err) },
    ]);
  } finally {
    boot.hidden = true;
  }
}

void boot();
