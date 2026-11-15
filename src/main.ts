import './styles/main.css';
import { resolveDataSource } from './config/data-source';
import { loadDataSet } from './data/loader';
import { $ } from './ui/dom';
import { renderContractErrors, renderFatal } from './ui/errors';
import { Preloader } from './ui/preloader';

/**
 * Boot order (nothing in the app runs before the preloader is completely gone):
 *  1. preloader shows immediately (this entry chunk is tiny);
 *  2. in parallel: load + validate the data set, download the 3D engine chunk (not started);
 *  3. preloader exit animation plays to completion and removes itself;
 *  4. only then is the app constructed (globe, story, observers, camera flights).
 */
async function boot(): Promise<void> {
  const source = resolveDataSource();
  const preloader = new Preloader($('#preloader'), 2);
  const app = $('#app');
  // Let the preloader paint before the heavy engine chunk is fetched and parsed.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const [result, appModule] = await Promise.all([
    loadDataSet(source)
      .catch((err: unknown) => ({
        ok: false as const,
        errors: [{ file: '(app)', path: '$', message: err instanceof Error ? err.message : String(err) }],
      }))
      .finally(() => preloader.step('data')),
    import('./app/app')
      .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
      .finally(() => preloader.step('engine')),
  ]);

  await preloader.finish();
  app.removeAttribute('inert');
  app.removeAttribute('aria-hidden');
  document.body.classList.remove('is-loading');

  if (appModule instanceof Error) {
    renderFatal(app, 'The 3D engine could not be loaded', appModule.message);
    return;
  }
  if (!result.ok) {
    renderContractErrors(app, source, result.errors);
    return;
  }
  new appModule.App(result.data);
}

void boot();
